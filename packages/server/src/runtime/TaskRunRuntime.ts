import { randomUUID, createHash } from "crypto";
import path from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import {
  MemoryStore,
  TaskRunRecord,
  TaskRunStatus,
  TaskStepRecord,
} from "../memory/MemoryStore";
import {
  getActiveWorkspaceRoot,
  resolveScopedPath,
} from "../projects/workspacePaths";

export interface RuntimeEvents {
  onQueueState?: (payload: {
    queued: number;
    running: number;
    workerSlots: Array<{
      id: string;
      status: string;
      currentTaskRunId?: string | null;
    }>;
  }) => void;
  onRunState?: (payload: {
    run: TaskRunRecord;
    steps?: TaskStepRecord[];
  }) => void;
}

export interface RuntimeConfig {
  poolSize: number;
  maxIterations: number;
}

export interface CreateTaskRunInput {
  title: string;
  projectId: string;
  requestedBy: string;
  brief?: string;
  acceptanceCriteria?: string[];
  context?: Record<string, unknown>;
  parentTaskRunId?: string;
  skillProfileId?: string;
  maxIterations?: number;
}

const MAJOR_ACTION_HINTS =
  /\b(deploy|publish|launch|fire|hire|pricing|delete\s+prod|production)\b/i;

export class TaskRunRuntime {
  private loopTimer?: NodeJS.Timeout;
  private isLoopActive = false;

  constructor(
    private readonly store: MemoryStore,
    private readonly events: RuntimeEvents,
    private readonly config: RuntimeConfig,
  ) {}

  async initialize(): Promise<void> {
    await this.store.ensureWorkerSlots(this.config.poolSize);
    await this.store.upsertSkillProfile({
      id: "skill-generalist",
      slug: "generalist",
      displayName: "Generalist Worker",
      description: "Default worker profile for planning and execution.",
      capabilities: ["planning", "artifact_generation", "delegation"],
    });
    await this.emitQueueState();
  }

  start() {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      this.tick().catch((error) => {
        console.error("[TaskRunRuntime] tick failed", error);
      });
    }, 750);
  }

  stop() {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = undefined;
  }

  async createTaskRun(input: CreateTaskRunInput): Promise<TaskRunRecord> {
    const criteria = Array.isArray(input.acceptanceCriteria)
      ? input.acceptanceCriteria
      : [];
    const brief =
      typeof input.brief === "string" && input.brief.trim()
        ? input.brief.trim()
        : await this.loadProjectBrief(input.projectId);
    const fallbackCriteria =
      criteria.length > 0
        ? criteria
        : await this.loadProjectAcceptanceCriteria(input.projectId);
    const runId = `run_${randomUUID()}`;
    const queuePosition =
      (await this.store.listTaskRuns({ status: "queued", limit: 1000 }))
        .length + 1;
    const record: TaskRunRecord = {
      id: runId,
      projectId: input.projectId,
      title: input.title,
      brief,
      acceptanceCriteria: fallbackCriteria,
      status: "queued",
      queuePosition,
      requestedBy: input.requestedBy || "api",
      assignedWorkerSlotId: null,
      parentTaskRunId: input.parentTaskRunId || null,
      skillProfileId: input.skillProfileId || "skill-generalist",
      maxIterations: Math.max(
        1,
        Math.min(input.maxIterations || this.config.maxIterations, 32),
      ),
      iterationCount: 0,
      contextJson: input.context || null,
      errorMessage: null,
    };
    await this.store.createTaskRun(record);
    const created = await this.store.getTaskRun(runId);
    if (!created) {
      throw new Error("Failed to persist task run.");
    }
    this.events.onRunState?.({ run: created });
    await this.emitQueueState();
    return created;
  }

  async listRuns(filter?: {
    projectId?: string;
    status?: TaskRunStatus;
    limit?: number;
  }): Promise<TaskRunRecord[]> {
    return this.store.listTaskRuns({
      projectId: filter?.projectId,
      status: filter?.status,
      limit: filter?.limit || 200,
    });
  }

  async cancelRun(runId: string): Promise<TaskRunRecord | null> {
    const run = await this.store.getTaskRun(runId);
    if (!run) return null;
    if (["done", "failed", "cancelled"].includes(run.status)) return run;
    await this.store.updateTaskRun(runId, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
      errorMessage: "Cancelled by user.",
    });
    const updated = await this.store.getTaskRun(runId);
    if (updated)
      this.events.onRunState?.({
        run: updated,
        steps: await this.store.listTaskSteps(runId),
      });
    await this.emitQueueState();
    return updated;
  }

  async tick(): Promise<void> {
    if (this.isLoopActive) return;
    this.isLoopActive = true;
    try {
      const slots = await this.store.listWorkerSlots();
      const idleSlots = slots.filter((slot) => slot.status === "idle");
      if (idleSlots.length === 0) return;
      for (const slot of idleSlots) {
        const next = await this.store.findNextQueuedTaskRun();
        if (!next) break;
        await this.processRun(slot.id, next);
      }
    } finally {
      this.isLoopActive = false;
    }
  }

  private async processRun(
    workerSlotId: string,
    run: TaskRunRecord,
  ): Promise<void> {
    await this.store.updateWorkerSlot(workerSlotId, {
      status: "busy",
      currentTaskRunId: run.id,
      heartbeatAt: new Date().toISOString(),
    });
    await this.store.updateTaskRun(run.id, {
      status: "running",
      queuePosition: null,
      assignedWorkerSlotId: workerSlotId,
      startedAt: new Date().toISOString(),
    });

    try {
      const plan = this.buildPlan(run);
      const steps: TaskStepRecord[] = [];
      for (let i = 0; i < plan.length; i++) {
        const stepId = `step_${randomUUID()}`;
        const step: TaskStepRecord = {
          id: stepId,
          taskRunId: run.id,
          ordinal: i + 1,
          title: plan[i].title,
          status: "queued",
          instruction: plan[i].instruction,
        };
        await this.store.createTaskStep(step);
        steps.push(step);
      }
      this.events.onRunState?.({
        run: (await this.store.getTaskRun(run.id)) || run,
        steps: await this.store.listTaskSteps(run.id),
      });

      for (let i = 0; i < steps.length; i++) {
        const refreshed = await this.store.getTaskRun(run.id);
        if (!refreshed)
          throw new Error("Task run disappeared during execution.");
        if (refreshed.status === "cancelled") break;
        if (refreshed.iterationCount >= refreshed.maxIterations) {
          await this.store.updateTaskRun(run.id, {
            status: "failed",
            errorMessage: `Max iterations exceeded (${refreshed.maxIterations}).`,
            completedAt: new Date().toISOString(),
          });
          break;
        }

        const step = steps[i];
        const attemptNo = 1;
        await this.store.updateTaskStep(step.id, { status: "running" });
        await this.store.createStepAttempt({
          id: `attempt_${randomUUID()}`,
          taskStepId: step.id,
          attemptNumber: attemptNo,
          status: "running",
          workerSlotId,
          inputJson: { instruction: step.instruction },
          createdAt: new Date().toISOString(),
        });

        const output = await this.executeStep(run, step, i);
        await this.store.updateTaskStep(step.id, {
          status: output.status,
          output: output.output,
          artifactPath: output.artifactPath || null,
          delegatedTaskRunId: output.delegatedTaskRunId || null,
          completedAt: ["done", "failed", "blocked", "review"].includes(
            output.status,
          )
            ? new Date().toISOString()
            : null,
        });

        await this.store.updateTaskRun(run.id, {
          iterationCount:
            (await this.store.getTaskRun(run.id))?.iterationCount || i + 1,
        });

        if (output.status === "failed") {
          await this.store.updateTaskRun(run.id, {
            status: "failed",
            errorMessage: output.output,
            completedAt: new Date().toISOString(),
          });
          break;
        }

        if (output.status === "review") {
          await this.store.updateTaskRun(run.id, { status: "review" });
        }

        if (output.status === "blocked") {
          await this.store.updateTaskRun(run.id, {
            status: "blocked",
            errorMessage: output.output,
          });
          break;
        }

        await this.store.updateTaskRun(run.id, {
          iterationCount: i + 1,
          status: i === steps.length - 1 ? "done" : "running",
          completedAt: i === steps.length - 1 ? new Date().toISOString() : null,
        });

        this.events.onRunState?.({
          run: (await this.store.getTaskRun(run.id)) || run,
          steps: await this.store.listTaskSteps(run.id),
        });
      }
    } catch (error: any) {
      await this.store.updateTaskRun(run.id, {
        status: "failed",
        errorMessage: error?.message || "Runtime failed unexpectedly.",
        completedAt: new Date().toISOString(),
      });
    } finally {
      await this.store.updateWorkerSlot(workerSlotId, {
        status: "idle",
        currentTaskRunId: null,
        heartbeatAt: new Date().toISOString(),
      });
      const finalRun = await this.store.getTaskRun(run.id);
      if (finalRun)
        this.events.onRunState?.({
          run: finalRun,
          steps: await this.store.listTaskSteps(run.id),
        });
      await this.emitQueueState();
    }
  }

  private buildPlan(
    run: TaskRunRecord,
  ): Array<{ title: string; instruction: string }> {
    const criteriaPreview =
      run.acceptanceCriteria.slice(0, 3).join(" | ") ||
      "No explicit criteria supplied.";
    return [
      {
        title: "Load runtime context",
        instruction: `Read project brief and acceptance criteria for ${run.projectId}. Criteria: ${criteriaPreview}`,
      },
      {
        title: "Generate execution plan",
        instruction: `Create a concise stepwise plan for task: ${run.title}`,
      },
      {
        title: "Produce artifact summary",
        instruction: `Persist a markdown artifact with plan + status for task run ${run.id}`,
      },
      ...(run.title.toLowerCase().includes("delegate") ||
      run.title.toLowerCase().includes("spawn_agent")
        ? [
            {
              title: "Delegate sub-task",
              instruction:
                "Use spawn_agent delegation for a child task run and link it to this step.",
            },
          ]
        : []),
    ];
  }

  private async executeStep(
    run: TaskRunRecord,
    step: TaskStepRecord,
    index: number,
  ): Promise<{
    status: TaskRunStatus;
    output: string;
    artifactPath?: string;
    delegatedTaskRunId?: string;
  }> {
    if (MAJOR_ACTION_HINTS.test(run.title) && index === 1) {
      return {
        status: "review",
        output:
          "Major action detected. Waiting for approval before irreversible operations.",
      };
    }

    if (
      /delegate sub-task/i.test(step.title) ||
      /spawn_agent/i.test(step.instruction)
    ) {
      const child = await this.createTaskRun({
        title: `[Delegated] ${run.title}`,
        projectId: run.projectId,
        requestedBy: `spawn_agent:${run.id}`,
        brief: run.brief,
        acceptanceCriteria: run.acceptanceCriteria,
        parentTaskRunId: run.id,
      });
      await this.store.createDelegationRecord({
        id: `deleg_${randomUUID()}`,
        parentTaskRunId: run.id,
        parentTaskStepId: step.id,
        childTaskRunId: child.id,
        reason: "spawn_agent delegation",
        status: "spawned",
      });
      return {
        status: "done",
        output: `Delegated to child task run ${child.id}.`,
        delegatedTaskRunId: child.id,
      };
    }

    if (/Produce artifact summary/i.test(step.title)) {
      const artifactPath = await this.persistRunArtifact(run);
      return {
        status: "done",
        output: `Artifact persisted at ${artifactPath}`,
        artifactPath,
      };
    }

    return {
      status: "done",
      output: `${step.title} completed for run ${run.id}.`,
    };
  }

  private async persistRunArtifact(run: TaskRunRecord): Promise<string> {
    const workspaceRoot = getActiveWorkspaceRoot();
    const relativePath = path.posix.join(
      "projects",
      run.projectId,
      "artifacts",
      `task-run-${run.id}.md`,
    );
    const absolutePath = resolveScopedPath(workspaceRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    const steps = await this.store.listTaskSteps(run.id);
    const body = [
      `# Task Run ${run.id}`,
      "",
      `- Title: ${run.title}`,
      `- Project: ${run.projectId}`,
      `- Status: ${run.status}`,
      `- Brief hash: ${createHash("sha1")
        .update(run.brief || "")
        .digest("hex")
        .slice(0, 12)}`,
      "",
      "## Acceptance Criteria",
      ...(run.acceptanceCriteria.length > 0
        ? run.acceptanceCriteria.map((item) => `- ${item}`)
        : ["- (none supplied)"]),
      "",
      "## Steps",
      ...(steps.length > 0
        ? steps.map((s) => `- [${s.status}] ${s.ordinal}. ${s.title}`)
        : ["- (none yet)"]),
      "",
      `Generated at ${new Date().toISOString()}`,
      "",
    ].join("\n");
    await writeFile(absolutePath, body, "utf-8");

    const stats = await readFile(absolutePath, "utf-8");
    await this.store.upsertArtifact({
      id: `artifact_${randomUUID()}`,
      projectId: run.projectId,
      taskId: run.id,
      agentId: run.assignedWorkerSlotId || "runtime-worker",
      relativePath,
      mimeType: "text/markdown",
      sizeBytes: Buffer.byteLength(stats, "utf-8"),
      status: "validated",
      checksum: createHash("sha256").update(stats).digest("hex"),
      existsOnDisk: true,
    });

    return relativePath;
  }

  private async emitQueueState(): Promise<void> {
    const [queued, running, workerSlots] = await Promise.all([
      this.store.listTaskRuns({ status: "queued", limit: 1000 }),
      this.store.listTaskRuns({ status: "running", limit: 1000 }),
      this.store.listWorkerSlots(),
    ]);
    this.events.onQueueState?.({
      queued: queued.length,
      running: running.length,
      workerSlots: workerSlots.map((slot) => ({
        id: slot.id,
        status: slot.status,
        currentTaskRunId: slot.currentTaskRunId || null,
      })),
    });
  }

  private async loadProjectBrief(projectId: string): Promise<string> {
    try {
      const fullPath = resolveScopedPath(
        getActiveWorkspaceRoot(),
        path.posix.join("projects", projectId, "project-brief.md"),
      );
      return (await readFile(fullPath, "utf-8")).trim();
    } catch {
      return "";
    }
  }

  private async loadProjectAcceptanceCriteria(
    projectId: string,
  ): Promise<string[]> {
    try {
      const fullPath = resolveScopedPath(
        getActiveWorkspaceRoot(),
        path.posix.join("projects", projectId, "acceptance-criteria.md"),
      );
      const text = (await readFile(fullPath, "utf-8")).trim();
      return text
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 20);
    } catch {
      return [];
    }
  }
}

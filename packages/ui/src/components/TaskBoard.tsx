import React, { useMemo, useState, useEffect } from "react";
import { getColyseusRoom } from "../game/Game";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { Panel } from "./ui/Panel";
import { SectionHeader } from "./ui/SectionHeader";
import { Toolbar } from "./ui/Toolbar";
import { controlRoomStyles, tokens } from "../theme/tokens";
import { eventBus } from "../events";

type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "retrying"
  | "blocked"
  | "review"
  | "done"
  | "failed"
  | "cancelled"
  | "backlog"
  | "in_progress";

const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "cancelled"],
  running: [
    "waiting",
    "retrying",
    "blocked",
    "review",
    "done",
    "failed",
    "cancelled",
  ],
  waiting: ["running", "cancelled"],
  retrying: ["running", "failed", "cancelled"],
  backlog: ["in_progress", "blocked"],
  in_progress: ["blocked", "review", "done"],
  blocked: ["backlog", "in_progress"],
  review: ["in_progress", "done", "blocked"],
  done: [],
  failed: [],
  cancelled: [],
};

const LEGACY_TASK_STATUS_MAP: Record<string, TaskStatus> = {
  pending: "backlog",
  completed: "done",
};

const toCanonicalTaskStatus = (value: unknown): TaskStatus => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "backlog" ||
    normalized === "in_progress" ||
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "waiting" ||
    normalized === "retrying" ||
    normalized === "blocked" ||
    normalized === "review" ||
    normalized === "done" ||
    normalized === "failed" ||
    normalized === "cancelled"
  )
    return normalized;
  return LEGACY_TASK_STATUS_MAP[normalized] || "backlog";
};

type TaskPriority = "low" | "medium" | "high";

interface TaskItem {
  id: string;
  title: string;
  assigned_to: string;
  status: TaskStatus;
  priority?: TaskPriority;
  requires_approval?: boolean;
  status_reason?: string | null;
}

interface AgentRosterEntry {
  id: string;
  name: string;
}

export function TaskBoard() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [newTask, setNewTask] = useState("");
  const [targetAgent, setTargetAgent] = useState("auto");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [runtimeQueue, setRuntimeQueue] = useState<{
    queued: number;
    running: number;
    workerSlots: Array<{
      id: string;
      status: string;
      currentTaskRunId?: string | null;
    }>;
  }>({ queued: 0, running: 0, workerSlots: [] });

  useEffect(() => {
    const onTaskUpdate = (event: Event) => {
      const data = ((event as CustomEvent).detail || {}) as any;
      if (!data?.task) return;
      setTasks((prev) => {
        const existing = prev.find(
          (t) =>
            t.id === data.id ||
            (t.title === data.task && t.assigned_to === data.agentId),
        );
        if (existing) {
          return prev.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  id: data.id || t.id,
                  status: toCanonicalTaskStatus(data.status || t.status),
                  assigned_to: data.agentId ?? t.assigned_to,
                  status_reason: data.statusReason ?? t.status_reason,
                  priority: data.priority || t.priority,
                  requires_approval:
                    data.requiresApproval ?? t.requires_approval,
                }
              : t,
          );
        }
        return [
          ...prev,
          {
            id: String(data.id || `${Date.now()}-${Math.random()}`),
            title: data.task,
            assigned_to: data.agentId || "",
            status: toCanonicalTaskStatus(data.status),
            status_reason: data.statusReason || null,
            priority: data.priority || "medium",
            requires_approval: Boolean(data.requiresApproval),
          },
        ];
      });
    };

    const onTasksSync = (event: Event) => {
      const serverTasks = (event as CustomEvent).detail;
      if (!Array.isArray(serverTasks)) return;
      setTasks(
        serverTasks.map((t: any) => ({
          id: String(t.id),
          title: t.title,
          assigned_to: t.assigned_to || "",
          status: toCanonicalTaskStatus(t.status),
          status_reason: t.status_reason || null,
          priority: t.priority || "medium",
          requires_approval: Boolean(t.requires_approval),
        })),
      );
    };

    const onRosterSync = (event: Event) => {
      const entries = (event as CustomEvent).detail;
      if (!Array.isArray(entries)) return;
      setRoster(
        entries.map((entry: any) => ({
          id: String(entry.id),
          name: String(entry.name || entry.id),
        })),
      );
    };

    const onRuntimeQueueState = (event: Event) => {
      const payload = (event as CustomEvent).detail || {};
      setRuntimeQueue({
        queued: Number(payload.queued || 0),
        running: Number(payload.running || 0),
        workerSlots: Array.isArray(payload.workerSlots)
          ? payload.workerSlots
          : [],
      });
    };

    const onRuntimeRunState = (event: Event) => {
      const payload = (event as CustomEvent).detail || {};
      const run = payload.run;
      if (!run?.id || !run?.title) return;
      setTasks((prev) => {
        const existing = prev.find((task) => task.id === run.id);
        const next: TaskItem = {
          id: String(run.id),
          title: String(run.title),
          assigned_to: String(run.assignedWorkerSlotId || ""),
          status: toCanonicalTaskStatus(run.status),
          status_reason:
            typeof run.errorMessage === "string" ? run.errorMessage : null,
          priority: "medium",
          requires_approval: Boolean(run.status === "review"),
        };
        if (existing)
          return prev.map((task) =>
            task.id === run.id ? { ...task, ...next } : task,
          );
        return [...prev, next];
      });
    };

    eventBus.addEventListener("task-update", onTaskUpdate);
    eventBus.addEventListener("tasks-sync", onTasksSync);
    eventBus.addEventListener("agent-roster-sync", onRosterSync);
    eventBus.addEventListener("runtime:queue-state", onRuntimeQueueState);
    eventBus.addEventListener("runtime:run-state", onRuntimeRunState);
    return () => {
      eventBus.removeEventListener("task-update", onTaskUpdate);
      eventBus.removeEventListener("tasks-sync", onTasksSync);
      eventBus.removeEventListener("agent-roster-sync", onRosterSync);
      eventBus.removeEventListener("runtime:queue-state", onRuntimeQueueState);
      eventBus.removeEventListener("runtime:run-state", onRuntimeRunState);
    };
  }, []);

  const rosterMap = useMemo(
    () => new Map(roster.map((entry) => [entry.id, entry.name])),
    [roster],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    const room = getColyseusRoom();
    if (room) {
      room.send("assign-task", {
        title: newTask.trim(),
        agentId: targetAgent === "auto" ? undefined : targetAgent,
        priority,
        requiresApproval,
      });
      fetch("/api/task-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTask.trim(),
          projectId: "xylon",
          requestedBy: "ui",
        }),
      }).catch(() => {});
      setNewTask("");
      setPriority("medium");
      setRequiresApproval(false);
    }
  };

  const taskTone = (s: string): "success" | "warning" | "default" => {
    if (s === "done") return "success";
    if (
      s === "in_progress" ||
      s === "running" ||
      s === "queued" ||
      s === "waiting" ||
      s === "retrying"
    )
      return "warning";
    return "default";
  };

  const statusIcon = (s: TaskStatus) => {
    if (s === "done") return "✅";
    if (s === "review") return "🕵️";
    if (s === "failed") return "❌";
    if (s === "cancelled") return "🛑";
    if (s === "queued") return "📥";
    if (s === "running") return "⚙️";
    if (s === "waiting") return "⏸️";
    if (s === "retrying") return "🔁";
    if (s === "blocked") return "⛔";
    if (s === "in_progress") return "🔄";
    return "🧾";
  };

  return (
    <Panel
      style={{
        position: "absolute",
        left: 20,
        top: 20,
        width: 300,
        maxHeight: "52vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SectionHeader
        title="📋 Task Board"
        subtitle="Assign, route, and monitor execution"
      />
      <div
        style={{
          fontSize: tokens.typography.micro,
          color: tokens.color.textMuted,
          marginBottom: tokens.spacing.sm,
        }}
      >
        Runtime queue: {runtimeQueue.queued} queued • {runtimeQueue.running}{" "}
        running • workers: {runtimeQueue.workerSlots.length}
      </div>

      <form onSubmit={handleSubmit} style={{ marginBottom: tokens.spacing.sm }}>
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder="Assign a task..."
          style={{
            ...controlRoomStyles.input,
            marginBottom: tokens.spacing.xs,
          }}
        />
        <Toolbar>
          <select
            value={targetAgent}
            onChange={(e) => setTargetAgent(e.target.value)}
            style={{
              ...controlRoomStyles.input,
              flex: 1,
              padding: 6,
              color: tokens.color.textSecondary,
            }}
          >
            <option value="auto">🤖 Auto-assign</option>
            {roster.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <Button type="submit" tone="primary">
            Assign
          </Button>
        </Toolbar>
      </form>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          fontSize: tokens.typography.caption,
          ...controlRoomStyles.scroll,
        }}
      >
        {tasks.length === 0 && (
          <p
            style={{
              color: tokens.color.textMuted,
              fontStyle: "italic",
              margin: 0,
              fontSize: tokens.typography.micro,
            }}
          >
            No tasks yet. Type above to assign work to agents.
          </p>
        )}
        {tasks.map((task) => (
          <div
            key={task.id}
            style={{
              ...controlRoomStyles.panelMuted,
              padding: `${tokens.spacing.xs}px ${tokens.spacing.sm}px`,
              marginBottom: tokens.spacing.xs,
            }}
          >
            <Toolbar>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: tokens.typography.caption,
                  flex: 1,
                }}
              >
                {statusIcon(task.status)} {task.title}
              </div>
              {/(\bmajor\b|\bdeploy\b|\blaunch\b|\bpublish\b|\bhire\b|\bfire\b|\bpricing\b)/i.test(
                task.title,
              ) && <Chip tone="danger">🛂 CEO</Chip>}
            </Toolbar>
            <Toolbar style={{ marginTop: 3 }}>
              <Chip tone={taskTone(task.status)}>
                {task.status.replace("_", " ")}
              </Chip>
              <div
                style={{
                  fontSize: tokens.typography.micro,
                  color: tokens.color.textMuted,
                }}
              >
                next:{" "}
                {(TASK_STATUS_TRANSITIONS[task.status] || []).join(", ") ||
                  "none"}
              </div>
              <div
                style={{
                  fontSize: tokens.typography.micro,
                  color: tokens.color.textSecondary,
                }}
              >
                → {task.assigned_to || "Unassigned"}
              </div>
            </Toolbar>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: tokens.spacing.sm,
          fontSize: tokens.typography.micro,
          color: tokens.color.textMuted,
          borderTop: `1px solid ${tokens.color.borderSoft}`,
          paddingTop: 6,
        }}
      >
        🤖 Engine: Ollama Local • 💾 SQLite Persistence
      </div>
    </Panel>
  );
}

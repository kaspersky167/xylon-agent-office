import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { MemoryEntry } from "@agent-office/core";
import { createHash, randomUUID } from "crypto";

export type SharedFileStatus =
  | "draft"
  | "shared"
  | "needs_review"
  | "approved"
  | "rejected";

export interface ToolAuditRecord {
  actorId: string;
  actorRole: string;
  toolName: string;
  paramsHash: string;
  result: string;
  approvalId?: string | null;
  createdAt?: string;
}

export interface TaskEvidenceRecord {
  id: string;
  taskId: string;
  agentId: string;
  evidenceType: "artifact" | "tool_execution" | "validator";
  artifactId?: string | null;
  artifactPath?: string | null;
  toolAuditLogId?: number | null;
  validatorDecision?: "approved" | "rejected" | "pending" | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface SharedFileRecord {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdBy: string;
  sharedWith: string[];
  status: SharedFileStatus;
  createdAt?: string;
  updatedAt?: string;
  approvalRequestId?: string | null;
}

export type ArtifactStatus = "draft" | "submitted" | "validated" | "rejected";

export interface ArtifactRecord {
  id: string;
  projectId: string;
  taskId?: string | null;
  agentId?: string | null;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  status: ArtifactStatus;
  checksum?: string | null;
  existsOnDisk?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done';

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

export class MemoryStore {
  private db?: Database;
  private ollamaUrl: string;

  constructor(ollamaUrl: string = "http://localhost:11434") {
    this.ollamaUrl = ollamaUrl;
  }

  async initialize(dbPath: string = "./data/office-memory.db") {
    const { mkdir } = await import("fs/promises");
    const path = await import("path");
    await mkdir(path.dirname(dbPath), { recursive: true });

    this.db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    await this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                content TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                embedding TEXT,
                session_id TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
            CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                assigned_to TEXT,
                status TEXT DEFAULT 'backlog',
                priority TEXT NOT NULL DEFAULT 'medium',
                requires_approval INTEGER NOT NULL DEFAULT 0,
                created_by TEXT NOT NULL DEFAULT 'system',
                status_reason TEXT,
                progress REAL NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                completed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_assignment ON tasks(assigned_to, status, updated_at DESC);

            CREATE TABLE IF NOT EXISTS task_evidence (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                evidence_type TEXT NOT NULL,
                artifact_id TEXT,
                artifact_path TEXT,
                tool_audit_log_id INTEGER,
                validator_decision TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_task_evidence_task ON task_evidence(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_evidence_agent ON task_evidence(agent_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS office_layout (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                layout_json TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT 'default',
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS approvals (
                id TEXT PRIMARY KEY,
                requested_by TEXT NOT NULL,
                requested_by_name TEXT NOT NULL,
                requested_action TEXT NOT NULL,
                rationale TEXT,
                is_major INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'pending',
                pending_tool TEXT,
                pending_params TEXT,
                file_id TEXT,
                file_path TEXT,
                file_name TEXT,
                file_shared_by_agent_id TEXT,
                file_shared_by_agent_name TEXT,
                file_summary_note TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shared_files (
                id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                mime_type TEXT,
                size_bytes INTEGER DEFAULT 0,
                shared_by_agent_id TEXT NOT NULL,
                shared_by_agent_name TEXT NOT NULL,
                shared_with TEXT,
                summary_note TEXT,
                status TEXT NOT NULL DEFAULT 'shared',
                approval_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS share_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                details TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS tool_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_id TEXT NOT NULL,
                actor_role TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                params_hash TEXT NOT NULL,
                result TEXT NOT NULL,
                approval_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_actor ON tool_audit_logs(actor_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_tool ON tool_audit_logs(tool_name, created_at DESC);

            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                task_id TEXT,
                agent_id TEXT,
                relative_path TEXT NOT NULL UNIQUE,
                mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'draft',
                checksum TEXT,
                exists_on_disk INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status, updated_at DESC);
        `);

    try {
      await this.db.exec("ALTER TABLE memories ADD COLUMN embedding TEXT");
    } catch {}
    try {
      await this.db.exec("ALTER TABLE approvals ADD COLUMN file_id TEXT");
    } catch {}
    try {
      await this.db.exec("ALTER TABLE approvals ADD COLUMN file_path TEXT");
    } catch {}
    try {
      await this.db.exec("ALTER TABLE approvals ADD COLUMN file_name TEXT");
    } catch {}
    try {
      await this.db.exec(
        "ALTER TABLE approvals ADD COLUMN file_shared_by_agent_id TEXT",
      );
    } catch {}
    try {
      await this.db.exec(
        "ALTER TABLE approvals ADD COLUMN file_shared_by_agent_name TEXT",
      );
    } catch {}
    try {
      await this.db.exec(
        "ALTER TABLE approvals ADD COLUMN file_summary_note TEXT",
      );
    } catch {}
    try {
      await this.db.exec("ALTER TABLE shared_files ADD COLUMN mime_type TEXT");
    } catch {}
    try {
      await this.db.exec(
        "ALTER TABLE shared_files ADD COLUMN size_bytes INTEGER DEFAULT 0",
      );
    } catch {}
    try {
      await this.db.exec(
        "ALTER TABLE shared_files ADD COLUMN shared_with TEXT",
      );
    } catch {}
    try {
      await this.db.exec(
        "ALTER TABLE shared_files ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
      );
    } catch {}
    try {
      await this.db.exec(
        "ALTER TABLE tasks ADD COLUMN progress REAL NOT NULL DEFAULT 0",
      );
    } catch {}

    console.log("[MemoryStore] SQLite initialized at", dbPath);
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama3.2:latest", prompt: text }),
      });
      const data = await res.json();
      return data.embedding || null;
    } catch {
      return null;
    }
  }

  async saveMemory(
    agentId: string,
    entry: MemoryEntry,
    sessionId?: string,
  ): Promise<void> {
    if (!this.db) return;
    let embeddingStr: string | null = null;
    if (entry.importance >= 0.5) {
      const embedding = await this.generateEmbedding(entry.content);
      if (embedding) embeddingStr = JSON.stringify(embedding);
    }
    await this.db.run(
      "INSERT INTO memories (agent_id, content, type, timestamp, importance, embedding, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        agentId,
        entry.content,
        entry.type,
        entry.timestamp,
        entry.importance,
        embeddingStr,
        sessionId || null,
      ],
    );
  }

  async saveMemories(
    agentId: string,
    entries: MemoryEntry[],
    sessionId?: string,
  ): Promise<void> {
    for (const entry of entries) {
      await this.saveMemory(agentId, entry, sessionId);
    }
  }

  async loadMemories(
    agentId: string,
    limit: number = 20,
  ): Promise<MemoryEntry[]> {
    if (!this.db) return [];
    const rows = await this.db.all(
      "SELECT content, type, timestamp, importance FROM memories WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?",
      [agentId, limit],
    );
    return rows.map((r: any) => ({
      content: r.content,
      type: r.type,
      timestamp: r.timestamp,
      importance: r.importance,
    }));
  }

  async semanticSearch(
    agentId: string,
    query: string,
    topK: number = 5,
  ): Promise<MemoryEntry[]> {
    if (!this.db) return [];
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) return this.loadMemories(agentId, topK);

    const rows = await this.db.all(
      "SELECT content, type, timestamp, importance, embedding FROM memories WHERE agent_id = ? AND embedding IS NOT NULL",
      [agentId],
    );

    const scored = rows
      .map((r: any) => {
        const emb = JSON.parse(r.embedding);
        const score = cosineSimilarity(queryEmbedding, emb);
        return {
          content: r.content,
          type: r.type,
          timestamp: r.timestamp,
          importance: r.importance,
          score,
        };
      })
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map((s) => ({
      content: s.content,
      type: s.type,
      timestamp: s.timestamp,
      importance: s.importance,
    }));
  }

  async createTask(title: string, assignedTo?: string): Promise<string> {
    if (!this.db) return "";
    const id = `task_${randomUUID()}`;
    const result = await this.db.run(
      "INSERT INTO tasks (id, title, assigned_to, status, status_reason, progress) VALUES (?, ?, ?, 'in_progress', 'pending_evidence', 0)",
      [id, title, assignedTo || null],
    );
    if (!result?.changes) return "";
    return id;
  }

  async getTasks(): Promise<any[]> {
    if (!this.db) return [];
    return this.db.all("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50");
  }

  async assignTask(taskId: number, agentId: string): Promise<void> {
    if (!this.db) return;
    await this.db.run(
      "UPDATE tasks SET assigned_to = ?, status = ? WHERE id = ?",
      [agentId, "in_progress", taskId],
    );
  }

  async completeTask(taskId: string): Promise<void> {
    if (!this.db) return;
    await this.db.run(
      "UPDATE tasks SET status = 'done', status_reason = 'validated', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [taskId],
    );
  }

  async updateTaskStatus(input: {
    taskId: string;
    status: TaskStatus;
    statusReason?: string | null;
    progress?: number;
    completed?: boolean;
  }): Promise<void> {
    if (!this.db) return;
    const progress = Number.isFinite(input.progress)
      ? Math.max(0, Math.min(1, Number(input.progress)))
      : null;
    await this.db.run(
      `UPDATE tasks
       SET status = ?,
           status_reason = ?,
           progress = COALESCE(?, progress),
           completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE completed_at END,
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        input.status,
        input.statusReason || null,
        progress,
        input.completed ? 1 : 0,
        input.taskId,
      ],
    );
  }

  async findActiveTask(assignedTo: string, title: string): Promise<any | null> {
    if (!this.db) return null;
    return this.db.get(
      `SELECT *
       FROM tasks
       WHERE assigned_to = ?
         AND title = ?
         AND status != 'done'
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`,
      [assignedTo, title],
    );
  }

  async addTaskEvidence(input: TaskEvidenceRecord): Promise<void> {
    if (!this.db) return;
    await this.db.run(
      `INSERT INTO task_evidence
       (id, task_id, agent_id, evidence_type, artifact_id, artifact_path, tool_audit_log_id, validator_decision, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.taskId,
        input.agentId,
        input.evidenceType,
        input.artifactId || null,
        input.artifactPath || null,
        input.toolAuditLogId ?? null,
        input.validatorDecision || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.createdAt || new Date().toISOString(),
      ],
    );
  }

  async getTaskEvidence(taskId: string): Promise<TaskEvidenceRecord[]> {
    if (!this.db) return [];
    const rows = await this.db.all(
      "SELECT * FROM task_evidence WHERE task_id = ? ORDER BY datetime(created_at) DESC",
      [taskId],
    );
    return rows.map((row: any) => ({
      id: row.id,
      taskId: row.task_id,
      agentId: row.agent_id,
      evidenceType: row.evidence_type,
      artifactId: row.artifact_id || null,
      artifactPath: row.artifact_path || null,
      toolAuditLogId:
        typeof row.tool_audit_log_id === "number" ? row.tool_audit_log_id : null,
      validatorDecision: row.validator_decision || null,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
    }));
  }

  hashToolParams(params: any): string {
    try {
      return createHash("sha256")
        .update(JSON.stringify(params ?? {}))
        .digest("hex");
    } catch {
      return createHash("sha256").update(String(params)).digest("hex");
    }
  }

  async saveLayout(name: string, layoutJson: string): Promise<void> {
    if (!this.db) return;
    const existing = await this.db.get(
      "SELECT id FROM office_layout WHERE name = ?",
      [name],
    );
    if (existing) {
      await this.db.run(
        "UPDATE office_layout SET layout_json = ?, updated_at = datetime('now') WHERE name = ?",
        [layoutJson, name],
      );
    } else {
      await this.db.run(
        "INSERT INTO office_layout (name, layout_json) VALUES (?, ?)",
        [name, layoutJson],
      );
    }
  }

  async loadLayout(name: string = "default"): Promise<any | null> {
    if (!this.db) return null;
    const row = await this.db.get(
      "SELECT layout_json FROM office_layout WHERE name = ?",
      [name],
    );
    return row ? JSON.parse(row.layout_json) : null;
  }

  async saveApproval(a: {
    id: string;
    requestedBy: string;
    requestedByName: string;
    requestedAction: string;
    rationale: string;
    isMajor: boolean;
    status: "pending" | "approved" | "rejected";
    pending?: { toolName: string; params: any } | null;
    fileContext?: {
      fileId: string;
      filePath: string;
      fileName: string;
      sharedByAgentId: string;
      sharedByAgentName: string;
      summaryNote: string;
    } | null;
    createdAt: string;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.run(
      `INSERT OR REPLACE INTO approvals
             (id, requested_by, requested_by_name, requested_action, rationale, is_major, status, pending_tool, pending_params, file_id, file_path, file_name, file_shared_by_agent_id, file_shared_by_agent_name, file_summary_note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        a.id,
        a.requestedBy,
        a.requestedByName,
        a.requestedAction,
        a.rationale,
        a.isMajor ? 1 : 0,
        a.status,
        a.pending?.toolName || null,
        a.pending ? JSON.stringify(a.pending.params ?? {}) : null,
        a.fileContext?.fileId || null,
        a.fileContext?.filePath || null,
        a.fileContext?.fileName || null,
        a.fileContext?.sharedByAgentId || null,
        a.fileContext?.sharedByAgentName || null,
        a.fileContext?.summaryNote || null,
        a.createdAt,
      ],
    );
  }

  async updateApprovalStatus(
    id: string,
    status: "approved" | "rejected",
  ): Promise<void> {
    if (!this.db) return;
    await this.db.run("UPDATE approvals SET status = ? WHERE id = ?", [
      status,
      id,
    ]);
  }

  async deleteApproval(id: string): Promise<void> {
    if (!this.db) return;
    await this.db.run("DELETE FROM approvals WHERE id = ?", [id]);
  }

  async loadApprovals(): Promise<any[]> {
    if (!this.db) return [];
    const rows = await this.db.all(
      "SELECT * FROM approvals ORDER BY created_at ASC",
    );
    return rows.map((r: any) => ({
      id: r.id,
      requestedBy: r.requested_by,
      requestedByName: r.requested_by_name,
      requestedAction: r.requested_action,
      rationale: r.rationale || "",
      isMajor: r.is_major === 1,
      status: r.status,
      createdAt: r.created_at,
      pending: r.pending_tool
        ? {
            toolName: r.pending_tool,
            params: r.pending_params ? JSON.parse(r.pending_params) : {},
          }
        : null,
      fileContext: r.file_id
        ? {
            fileId: r.file_id,
            filePath: r.file_path || "",
            fileName: r.file_name || "",
            sharedByAgentId: r.file_shared_by_agent_id || "",
            sharedByAgentName: r.file_shared_by_agent_name || "",
            summaryNote: r.file_summary_note || "",
          }
        : null,
    }));
  }

  async upsertSharedFile(
    file: Partial<SharedFileRecord> & {
      id: string;
      filePath?: string;
      fileName?: string;
      sharedByAgentId?: string;
      sharedByAgentName?: string;
      summaryNote?: string;
      approvalId?: string | null;
      updatedAt?: string;
    },
  ): Promise<void> {
    if (!this.db) return;

    const path = file.path || file.filePath || "";
    const name = file.name || file.fileName || "";
    const createdBy = file.createdBy || file.sharedByAgentId || "unknown";
    const sharedByName = file.sharedByAgentName || file.createdBy || "Unknown";
    const status = file.status || "shared";
    const updatedAt = file.updatedAt || new Date().toISOString();
    const createdAt = file.createdAt || updatedAt;
    const mimeType = file.mimeType || "application/octet-stream";
    const sharedWith = Array.isArray(file.sharedWith) ? file.sharedWith : [];

    await this.db.run(
      `INSERT OR REPLACE INTO shared_files
             (id, file_path, file_name, mime_type, size_bytes, shared_by_agent_id, shared_by_agent_name, shared_with, summary_note, status, approval_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        file.id,
        path,
        name,
        mimeType,
        Number(file.sizeBytes || 0),
        createdBy,
        sharedByName,
        JSON.stringify(sharedWith),
        file.summaryNote || null,
        status,
        file.approvalRequestId || file.approvalId || null,
        createdAt,
        updatedAt,
      ],
    );
  }

  async listSharedFiles(filter?: {
    status?: SharedFileStatus;
    createdBy?: string;
    sharedWith?: string;
  }): Promise<SharedFileRecord[]> {
    if (!this.db) return [];
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter?.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.createdBy) {
      clauses.push("shared_by_agent_id = ?");
      params.push(filter.createdBy);
    }
    if (filter?.sharedWith) {
      clauses.push("shared_with LIKE ?");
      params.push(`%${filter.sharedWith}%`);
    }
    const sql = `SELECT * FROM shared_files ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC`;
    const rows = await this.db.all(sql, params);
    return rows.map((row: any) => ({
      id: row.id,
      path: row.file_path,
      name: row.file_name,
      mimeType: row.mime_type || "application/octet-stream",
      sizeBytes: Number(row.size_bytes || 0),
      createdBy: row.shared_by_agent_id,
      sharedWith: row.shared_with ? JSON.parse(row.shared_with) : [],
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvalRequestId: row.approval_id || null,
    }));
  }

  async getSharedFile(id: string): Promise<SharedFileRecord | null> {
    if (!this.db) return null;
    const row = await this.db.get("SELECT * FROM shared_files WHERE id = ?", [
      id,
    ]);
    if (!row) return null;
    return {
      id: row.id,
      path: row.file_path,
      name: row.file_name,
      mimeType: row.mime_type || "application/octet-stream",
      sizeBytes: Number(row.size_bytes || 0),
      createdBy: row.shared_by_agent_id,
      sharedWith: row.shared_with ? JSON.parse(row.shared_with) : [],
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvalRequestId: row.approval_id || null,
    };
  }

  async updateSharedFileStatus(
    fileId: string,
    status: SharedFileStatus,
    approvalId?: string | null,
  ): Promise<void> {
    if (!this.db) return;
    await this.db.run(
      "UPDATE shared_files SET status = ?, approval_id = ?, updated_at = datetime('now') WHERE id = ?",
      [status, approvalId || null, fileId],
    );
  }

  async logShareAction(input: {
    fileId: string;
    action: string;
    actor: string;
    details?: string;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.run(
      "INSERT INTO share_actions (file_id, action, actor, details) VALUES (?, ?, ?, ?)",
      [input.fileId, input.action, input.actor, input.details || null],
    );
  }

  async logToolAudit(input: ToolAuditRecord): Promise<number | null> {
    if (!this.db) return null;
    const result = await this.db.run(
      `INSERT INTO tool_audit_logs
             (actor_id, actor_role, tool_name, params_hash, result, approval_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.actorId,
        input.actorRole,
        input.toolName,
        input.paramsHash,
        input.result,
        input.approvalId || null,
      ],
    );
    return typeof result?.lastID === "number" ? result.lastID : null;
  }

  async upsertArtifact(
    artifact: Omit<ArtifactRecord, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<void> {
    if (!this.db) return;
    const now = new Date().toISOString();
    const createdAt = artifact.createdAt || now;
    const updatedAt = artifact.updatedAt || now;
    await this.db.run(
      `INSERT INTO artifacts
             (id, project_id, task_id, agent_id, relative_path, mime_type, size_bytes, status, checksum, exists_on_disk, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(relative_path) DO UPDATE SET
               id = excluded.id,
               project_id = excluded.project_id,
               task_id = excluded.task_id,
               agent_id = excluded.agent_id,
               mime_type = excluded.mime_type,
               size_bytes = excluded.size_bytes,
               status = excluded.status,
               checksum = excluded.checksum,
               exists_on_disk = excluded.exists_on_disk,
               updated_at = excluded.updated_at`,
      [
        artifact.id,
        artifact.projectId,
        artifact.taskId || null,
        artifact.agentId || null,
        artifact.relativePath,
        artifact.mimeType,
        Number(artifact.sizeBytes || 0),
        artifact.status,
        artifact.checksum || null,
        artifact.existsOnDisk ? 1 : 0,
        createdAt,
        updatedAt,
      ],
    );
  }

  async listArtifacts(filter?: {
    projectId?: string;
    taskId?: string;
    agentId?: string;
    status?: ArtifactStatus;
    existsOnDisk?: boolean;
    limit?: number;
  }): Promise<ArtifactRecord[]> {
    if (!this.db) return [];
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter?.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter?.taskId) {
      clauses.push("task_id = ?");
      params.push(filter.taskId);
    }
    if (filter?.agentId) {
      clauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    if (filter?.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (typeof filter?.existsOnDisk === "boolean") {
      clauses.push("exists_on_disk = ?");
      params.push(filter.existsOnDisk ? 1 : 0);
    }
    const safeLimit = Math.min(Math.max(Number(filter?.limit || 200), 1), 1000);
    const sql = `SELECT * FROM artifacts ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`;
    const rows = await this.db.all(sql, [...params, safeLimit]);
    return rows.map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id || null,
      agentId: row.agent_id || null,
      relativePath: row.relative_path,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes || 0),
      status: row.status,
      checksum: row.checksum || null,
      existsOnDisk: row.exists_on_disk === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async close(): Promise<void> {
    if (this.db) await this.db.close();
  }
}

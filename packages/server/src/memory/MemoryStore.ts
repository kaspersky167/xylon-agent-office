import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { MemoryEntry } from '@agent-office/core';

export type SharedFileStatus = 'draft' | 'shared' | 'needs_review' | 'approved';

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

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

export class MemoryStore {
    private db?: Database;
    private ollamaUrl: string;

    constructor(ollamaUrl: string = 'http://localhost:11434') {
        this.ollamaUrl = ollamaUrl;
    }

    async initialize(dbPath: string = './data/office-memory.db') {
        // Ensure data directory exists
        const { mkdir } = await import('fs/promises');
        const path = await import('path');
        await mkdir(path.dirname(dbPath), { recursive: true });

        this.db = await open({
            filename: dbPath,
            driver: sqlite3.Database
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
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                assigned_to TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT (datetime('now')),
                completed_at TEXT
            );

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
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shared_files (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_by TEXT NOT NULL,
                shared_with TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'shared', 'needs_review', 'approved')),
                approval_request_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_shared_files_status ON shared_files(status);
            CREATE INDEX IF NOT EXISTS idx_shared_files_created_by ON shared_files(created_by);

            CREATE TABLE IF NOT EXISTS shared_file_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT,
                details TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_shared_file_actions_file_id ON shared_file_actions(file_id);
        `);

        // Migration: add embedding column to existing databases
        try {
            await this.db.exec('ALTER TABLE memories ADD COLUMN embedding TEXT');
        } catch {
            // Column already exists — ignore
        }

        console.log('[MemoryStore] SQLite initialized at', dbPath);
    }

    // --- Embedding Generation ---

    private async generateEmbedding(text: string): Promise<number[] | null> {
        try {
            const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'llama3.2:latest', prompt: text })
            });
            const data = await res.json();
            return data.embedding || null;
        } catch {
            return null;
        }
    }

    // --- Memory Operations ---

    async saveMemory(agentId: string, entry: MemoryEntry, sessionId?: string): Promise<void> {
        if (!this.db) return;
        // Generate embedding for semantic search (async, non-blocking)
        let embeddingStr: string | null = null;
        if (entry.importance >= 0.5) {
            const embedding = await this.generateEmbedding(entry.content);
            if (embedding) embeddingStr = JSON.stringify(embedding);
        }
        await this.db.run(
            'INSERT INTO memories (agent_id, content, type, timestamp, importance, embedding, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [agentId, entry.content, entry.type, entry.timestamp, entry.importance, embeddingStr, sessionId || null]
        );
    }

    async saveMemories(agentId: string, entries: MemoryEntry[], sessionId?: string): Promise<void> {
        for (const entry of entries) {
            await this.saveMemory(agentId, entry, sessionId);
        }
    }

    async loadMemories(agentId: string, limit: number = 20): Promise<MemoryEntry[]> {
        if (!this.db) return [];
        const rows = await this.db.all(
            'SELECT content, type, timestamp, importance FROM memories WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?',
            [agentId, limit]
        );
        return rows.map((r: any) => ({
            content: r.content,
            type: r.type,
            timestamp: r.timestamp,
            importance: r.importance
        }));
    }

    async semanticSearch(agentId: string, query: string, topK: number = 5): Promise<MemoryEntry[]> {
        if (!this.db) return [];
        const queryEmbedding = await this.generateEmbedding(query);
        if (!queryEmbedding) return this.loadMemories(agentId, topK); // Fallback to recency

        const rows = await this.db.all(
            'SELECT content, type, timestamp, importance, embedding FROM memories WHERE agent_id = ? AND embedding IS NOT NULL',
            [agentId]
        );

        const scored = rows.map((r: any) => {
            const emb = JSON.parse(r.embedding);
            const score = cosineSimilarity(queryEmbedding, emb);
            return { content: r.content, type: r.type, timestamp: r.timestamp, importance: r.importance, score };
        }).sort((a, b) => b.score - a.score);

        return scored.slice(0, topK).map(s => ({
            content: s.content,
            type: s.type,
            timestamp: s.timestamp,
            importance: s.importance
        }));
    }

    // --- Task Operations ---

    async createTask(title: string, assignedTo?: string): Promise<number> {
        if (!this.db) return -1;
        const result = await this.db.run(
            'INSERT INTO tasks (title, assigned_to) VALUES (?, ?)',
            [title, assignedTo || null]
        );
        return result.lastID || -1;
    }

    async getTasks(): Promise<any[]> {
        if (!this.db) return [];
        return this.db.all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50');
    }

    async assignTask(taskId: number, agentId: string): Promise<void> {
        if (!this.db) return;
        await this.db.run('UPDATE tasks SET assigned_to = ?, status = ? WHERE id = ?', [agentId, 'in_progress', taskId]);
    }

    async completeTask(taskId: number): Promise<void> {
        if (!this.db) return;
        await this.db.run("UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [taskId]);
    }

    // --- Layout Operations ---

    async saveLayout(name: string, layoutJson: string): Promise<void> {
        if (!this.db) return;
        const existing = await this.db.get('SELECT id FROM office_layout WHERE name = ?', [name]);
        if (existing) {
            await this.db.run("UPDATE office_layout SET layout_json = ?, updated_at = datetime('now') WHERE name = ?", [layoutJson, name]);
        } else {
            await this.db.run('INSERT INTO office_layout (name, layout_json) VALUES (?, ?)', [name, layoutJson]);
        }
    }

    async loadLayout(name: string = 'default'): Promise<any | null> {
        if (!this.db) return null;
        const row = await this.db.get('SELECT layout_json FROM office_layout WHERE name = ?', [name]);
        return row ? JSON.parse(row.layout_json) : null;
    }

    // --- Approval Operations ---

    async saveApproval(a: {
        id: string;
        requestedBy: string;
        requestedByName: string;
        requestedAction: string;
        rationale: string;
        isMajor: boolean;
        status: 'pending' | 'approved' | 'rejected';
        pending?: { toolName: string; params: any } | null;
        createdAt: string;
    }): Promise<void> {
        if (!this.db) return;
        await this.db.run(
            `INSERT OR REPLACE INTO approvals
             (id, requested_by, requested_by_name, requested_action, rationale, is_major, status, pending_tool, pending_params, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                a.id, a.requestedBy, a.requestedByName, a.requestedAction, a.rationale,
                a.isMajor ? 1 : 0, a.status,
                a.pending?.toolName || null,
                a.pending ? JSON.stringify(a.pending.params ?? {}) : null,
                a.createdAt,
            ]
        );
    }

    async updateApprovalStatus(id: string, status: 'approved' | 'rejected'): Promise<void> {
        if (!this.db) return;
        await this.db.run('UPDATE approvals SET status = ? WHERE id = ?', [status, id]);
    }

    async deleteApproval(id: string): Promise<void> {
        if (!this.db) return;
        await this.db.run('DELETE FROM approvals WHERE id = ?', [id]);
    }

    async loadApprovals(): Promise<any[]> {
        if (!this.db) return [];
        const rows = await this.db.all('SELECT * FROM approvals ORDER BY created_at ASC');
        return rows.map((r: any) => ({
            id: r.id,
            requestedBy: r.requested_by,
            requestedByName: r.requested_by_name,
            requestedAction: r.requested_action,
            rationale: r.rationale || '',
            isMajor: r.is_major === 1,
            status: r.status,
            createdAt: r.created_at,
            pending: r.pending_tool
                ? { toolName: r.pending_tool, params: r.pending_params ? JSON.parse(r.pending_params) : {} }
                : null,
        }));
    }

    // --- Shared File Operations ---

    async upsertSharedFile(file: SharedFileRecord): Promise<void> {
        if (!this.db) return;
        await this.db.run(
            `INSERT INTO shared_files
             (id, path, name, mime_type, size_bytes, created_by, shared_with, status, approval_request_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                path = excluded.path,
                name = excluded.name,
                mime_type = excluded.mime_type,
                size_bytes = excluded.size_bytes,
                created_by = excluded.created_by,
                shared_with = excluded.shared_with,
                status = excluded.status,
                approval_request_id = excluded.approval_request_id,
                updated_at = datetime('now')`,
            [
                file.id,
                file.path,
                file.name,
                file.mimeType,
                file.sizeBytes,
                file.createdBy,
                JSON.stringify(file.sharedWith || []),
                file.status,
                file.approvalRequestId || null,
                file.createdAt || null,
            ]
        );
    }

    async listSharedFiles(opts?: {
        createdBy?: string;
        sharedWith?: string;
        status?: SharedFileStatus;
    }): Promise<SharedFileRecord[]> {
        if (!this.db) return [];
        const conditions: string[] = [];
        const params: any[] = [];

        if (opts?.createdBy) {
            conditions.push('created_by = ?');
            params.push(opts.createdBy);
        }
        if (opts?.status) {
            conditions.push('status = ?');
            params.push(opts.status);
        }
        if (opts?.sharedWith) {
            conditions.push('shared_with LIKE ?');
            params.push(`%\"${opts.sharedWith}\"%`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await this.db.all(
            `SELECT * FROM shared_files ${where} ORDER BY updated_at DESC`,
            params
        );
        return rows.map((r: any) => ({
            id: r.id,
            path: r.path,
            name: r.name,
            mimeType: r.mime_type,
            sizeBytes: Number(r.size_bytes) || 0,
            createdBy: r.created_by,
            sharedWith: r.shared_with ? JSON.parse(r.shared_with) : [],
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            approvalRequestId: r.approval_request_id || null,
        }));
    }

    async getSharedFile(id: string): Promise<SharedFileRecord | null> {
        if (!this.db) return null;
        const r = await this.db.get('SELECT * FROM shared_files WHERE id = ?', [id]);
        if (!r) return null;
        return {
            id: r.id,
            path: r.path,
            name: r.name,
            mimeType: r.mime_type,
            sizeBytes: Number(r.size_bytes) || 0,
            createdBy: r.created_by,
            sharedWith: r.shared_with ? JSON.parse(r.shared_with) : [],
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            approvalRequestId: r.approval_request_id || null,
        };
    }

    async updateSharedFileStatus(id: string, status: SharedFileStatus, approvalRequestId?: string | null): Promise<void> {
        if (!this.db) return;
        await this.db.run(
            `UPDATE shared_files
             SET status = ?, approval_request_id = COALESCE(?, approval_request_id), updated_at = datetime('now')
             WHERE id = ?`,
            [status, approvalRequestId || null, id]
        );
    }

    async logShareAction(input: { fileId: string; action: string; actor?: string; details?: string }): Promise<void> {
        if (!this.db) return;
        await this.db.run(
            'INSERT INTO shared_file_actions (file_id, action, actor, details) VALUES (?, ?, ?, ?)',
            [input.fileId, input.action, input.actor || null, input.details || null]
        );
    }

    async close(): Promise<void> {
        if (this.db) await this.db.close();
    }
}

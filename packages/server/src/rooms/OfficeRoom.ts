import { Room, Client } from 'colyseus';
import { OfficeState } from '../schema/OfficeState';
import { Agent, Office, OfficeConfig, ConversationMessage } from '@agent-office/core';
import { OllamaAdapter, OpenAICompatibleAdapter } from '@agent-office/adapters';
import { ToolExecutor } from '../tools/ToolExecutor';
import { MemoryStore, SharedFileRecord, SharedFileStatus, TaskPriority, TaskStatus } from '../memory/MemoryStore';
import path from 'path';
import { readFile, stat, mkdir, writeFile } from 'fs/promises';
import { ExtensionRegistry } from '../extensions/registry';

interface HighlightEvent {
    type: string;
    title: string;
    body: string;
    agentId?: string | null;
    scenario: string;
    time: string;
}

interface RelationshipEdge {
    a: string;
    b: string;
    score: number;
    status: 'alliance' | 'neutral' | 'rivalry';
    updatedAt: string;
}

interface CompletedTaskRecord {
    id: string;
    task: string;
    agentId: string;
    agentName: string;
    completedAt: string;
    summaryPath: string;
}

interface TaskRecord {
    id: string;
    title: string;
    assigned_to?: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    requires_approval: number;
    created_by: string;
    created_at: string;
    updated_at: string;
    status_reason?: string | null;
    completed_at?: string | null;
}

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    backlog: ['in_progress'],
    in_progress: ['blocked', 'review'],
    blocked: ['in_progress'],
    review: ['done', 'in_progress'],
    done: []
};

interface ApprovalRequest {
    id: string;
    requestedBy: string;      // agent id
    requestedByName: string;  // display name
    requestedAction: string;  // short title
    rationale: string;        // why it matters
    isMajor: boolean;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
    // optional pending tool call to resume after approval
    pending?: { toolName: string; params: any } | null;
    fileContext?: {
        fileId: string;
        filePath: string;
        fileName: string;
        sharedByAgentId: string;
        sharedByAgentName: string;
        summaryNote: string;
    } | null;
}

interface SharedFileUpsertPayload {
    id?: string;
    path: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
    createdBy?: string;
    sharedWith?: string[];
    status?: SharedFileStatus;
}

interface ChatAttachment {
    id: string;
    path: string;
    name: string;
    mimeType: string;
    size: number;
    sharedBy: string;
    sharedWith: string[];
    createdAt: string;
}

type ZoneId = 'main' | 'ceo_office';
type ZoneBounds = { minX: number; maxX: number; minY: number; maxY: number };
type LayoutItem = { id: string; type: string; x: number; y: number; label?: string; zoneId: ZoneId };
type FurnitureTarget = { x: number; y: number; type: string };

// Tool names that always require CEO approval when invoked by a non-CEO agent
const MAJOR_TOOLS = new Set<string>([
    'hire_agent',
    'fire_agent',
    'run_command',
    'code_execute',
    'write_file',
    'deploy',
    'publish',
]);

export class OfficeRoom extends Room<OfficeState> {
    private static activeRoom: OfficeRoom | null = null;
    private static readonly THINK_MEMORY_TOKEN_BUDGET = 750;
    private static readonly THINK_MEMORY_LIMIT = 10;

    maxClients = 100;
    private office!: Office;
    private demoTickCount = 0;
    private coreAgents: Map<string, Agent> = new Map();
    private thinkingLocks: Map<string, boolean> = new Map();
    private ollamaAdapter = new OllamaAdapter('http://localhost:11434');
    private inferenceAdapter: OllamaAdapter | OpenAICompatibleAdapter = this.ollamaAdapter;
    private inferenceProvider: 'ollama' | 'openai' | 'gaia' | 'anthropic' | 'custom' = 'ollama';
    private defaultModel = process.env.AGENT_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';
    private hireCount = 0; // Counter for generating unique IDs
    private toolExecutor = new ToolExecutor();
    private memoryStore = new MemoryStore();
    private sessionId = `session_${Date.now()}`;
    private currentScenario = 'Free Play';
    private officeTemplate: OfficeTemplate = getOfficeTemplate('default');
    private highlights: HighlightEvent[] = [];
    private chaosHistory: Array<{ event: string; label: string; time: string }> = [];
    private relationships: Map<string, RelationshipEdge> = new Map();
    private audienceVotes: Record<string, number> = {};
    private currentLayoutByZone: Record<ZoneId, LayoutItem[]> = { main: [], ceo_office: [] };
    private approvals: Map<string, ApprovalRequest> = new Map();
    private meetingActive = false;
    private meetingEndsAt = 0;
    private meetingTopic = '';
    private taskProgress: Map<string, number> = new Map();
    private workspaceRoot = path.resolve(process.env.AGENT_WORKSPACE_DIR || 'data/workspace');
    private completedTasks: CompletedTaskRecord[] = [];
    private fastTrackMode = true;
    private extensionRegistry = OfficeRoom.extensionRegistry;

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const map: Record<string, string> = {
            '.md': 'text/markdown',
            '.txt': 'text/plain',
            '.json': 'application/json',
            '.js': 'text/javascript',
            '.ts': 'text/typescript',
            '.tsx': 'text/tsx',
            '.jsx': 'text/jsx',
            '.html': 'text/html',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.csv': 'text/csv',
            '.yml': 'text/yaml',
            '.yaml': 'text/yaml'
        };
        return map[ext] || 'application/octet-stream';
    }

    private resolveWorkspacePath(targetPath: string): string {
        const safeTarget = String(targetPath || '').trim();
        const fullPath = path.resolve(this.workspaceRoot, safeTarget);
        const rel = path.relative(this.workspaceRoot, fullPath);
        if (!safeTarget || rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error('Invalid workspace file path.');
        }
        return fullPath;
    }

    private normalizeChatAttachment(input: any, defaultSharedBy: string): ChatAttachment | null {
        if (!input || typeof input !== 'object') return null;

        const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : '';
        const filePath = typeof input.path === 'string' && input.path.trim() ? input.path.trim() : '';
        const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '';
        const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : '';
        const size = Number(input.size);
        const sharedBy = typeof input.sharedBy === 'string' && input.sharedBy.trim()
            ? input.sharedBy.trim()
            : defaultSharedBy;

        const sharedWith = Array.isArray(input.sharedWith)
            ? input.sharedWith
                .filter((entry: unknown) => typeof entry === 'string')
                .map((entry: string) => entry.trim())
                .filter(Boolean)
            : [];

        const createdAtRaw = typeof input.createdAt === 'string' ? input.createdAt : '';
        const createdAtDate = createdAtRaw ? new Date(createdAtRaw) : new Date();
        const createdAt = Number.isNaN(createdAtDate.getTime())
            ? new Date().toISOString()
            : createdAtDate.toISOString();

        if (!id || !filePath || !name || !mimeType || !Number.isFinite(size) || size < 0) return null;

        return {
            id,
            path: filePath,
            name,
            mimeType,
            size: Math.floor(size),
            sharedBy,
            sharedWith,
            createdAt
        };
    }

    private parseChatAttachments(raw: any, defaultSharedBy: string): ChatAttachment[] {
        if (!Array.isArray(raw)) return [];
        return raw
            .map((item) => this.normalizeChatAttachment(item, defaultSharedBy))
            .filter((item): item is ChatAttachment => Boolean(item));
    }

    private estimateTokens(text: string): number {
        const normalized = String(text || '').trim();
        if (!normalized) return 0;
        return Math.ceil(normalized.length / 4);
    }

    private buildMemoryQuery(currentTask: string | null | undefined, recentMessages: ConversationMessage[], recentMemories: any[]): string {
        const taskPart = currentTask ? `Task: ${currentTask}` : '';
        const messagePart = recentMessages
            .slice(-3)
            .map((m) => `${m.from} -> ${m.to}: ${m.content}`)
            .join(' | ');
        const memoryPart = recentMemories
            .slice(-2)
            .map((m: any) => m?.content || '')
            .filter(Boolean)
            .join(' | ');

        return [taskPart, messagePart, memoryPart]
            .filter(Boolean)
            .join(' || ') || 'current priorities and recent context';
    }

    private mergeMemoriesWithBudget(primary: any[], secondary: any[], limit: number, tokenBudget: number): any[] {
        const merged: any[] = [];
        const seen = new Set<string>();
        let usedTokens = 0;

        const append = (entry: any) => {
            if (!entry?.content) return;
            const key = `${entry.type || 'memory'}::${entry.content}`;
            if (seen.has(key)) return;
            const entryTokens = this.estimateTokens(entry.content);
            if (merged.length >= limit || (usedTokens + entryTokens > tokenBudget && merged.length > 0)) return;
            merged.push(entry);
            seen.add(key);
            usedTokens += entryTokens;
        };

        primary.forEach(append);
        secondary.forEach(append);
        return merged;
    }

    // Furniture interaction points: named locations agents can walk to
    private furnitureTargets: Record<string, { x: number; y: number; type: string }> = {
        // ─── ENGINEERING POD (pod of 4, left side) ───
        // Pair: Frontend + Backend / Pair: DevOps + Security
        'frontend-desk':    { x: 5,  y: 10, type: 'desk' },
        'backend-desk':     { x: 8,  y: 10, type: 'desk' },
        'devops-desk':      { x: 5,  y: 14, type: 'desk' },
        'security-desk':    { x: 8,  y: 14, type: 'desk' },

        // ─── OPS / STRATEGY POD (pod of 4, center) ───
        // Pair: Shepherd + Reality / Pair: Evidence + SEO
        'shepherd-desk':    { x: 17, y: 10, type: 'desk' },
        'reality-desk':     { x: 20, y: 10, type: 'desk' },
        'evidence-desk':    { x: 17, y: 14, type: 'desk' },
        'seo-desk':         { x: 20, y: 14, type: 'desk' },

        // ─── GROWTH POD (small pod of 2, right side) ───
        // Pair: Sales + Proposal
        'sales-desk':       { x: 29, y: 10, type: 'desk' },
        'proposal-desk':    { x: 32, y: 10, type: 'desk' },

        // ─── CEO PRIVATE OFFICE (separated, bottom-right) ───
        // ─── SHARED FURNITURE ───
        'meeting-table':  { x: 20, y: 22, type: 'table' },
        'coffee-machine': { x: 5,  y: 30, type: 'appliance' },
        'whiteboard':     { x: 20, y: 5,  type: 'board' },
        'water-cooler':   { x: 12, y: 30, type: 'appliance' },
        'bookshelf':      { x: 17, y: 30, type: 'furniture' },
        'beanbag':        { x: 24, y: 30, type: 'seating' },
        // Extra desks for dynamically hired agents
        'hire_0-desk': { x: 22, y: 18, type: 'desk' },
        'hire_1-desk': { x: 22, y: 23, type: 'desk' },
        'hire_2-desk': { x: 25, y: 18, type: 'desk' },
        'hire_3-desk': { x: 25, y: 8,  type: 'desk' },
        'hire_4-desk': { x: 32, y: 18, type: 'desk' },
        },
        ceo_office: {
            'ceo-desk':         { x: 32, y: 30, type: 'desk' },
            'ceo-office-wall-1':{ x: 28, y: 27, type: 'wall' },
            'ceo-office-wall-2':{ x: 28, y: 33, type: 'wall' },
            'ceo-office-door':  { x: 28, y: 30, type: 'door' },
        }
    };

    static getActiveRoom(): OfficeRoom | null {
        return OfficeRoom.activeRoom;
    }

    private normalizeZoneId(zoneId: unknown): ZoneId {
        return zoneId === 'ceo_office' ? 'ceo_office' : 'main';
    }

    private clampToZone(agent: { x: number; y: number; zoneId?: string }, zoneId?: ZoneId) {
        const resolvedZone = zoneId || this.normalizeZoneId(agent.zoneId);
        const bounds = this.zoneBounds[resolvedZone];
        agent.x = Math.max(bounds.minX, Math.min(bounds.maxX, agent.x));
        agent.y = Math.max(bounds.minY, Math.min(bounds.maxY, agent.y));
        agent.zoneId = resolvedZone;
    }

    private normalizeLayoutByZone(raw: unknown): Record<ZoneId, LayoutItem[]> {
        const empty: Record<ZoneId, LayoutItem[]> = { main: [], ceo_office: [] };
        if (Array.isArray(raw)) {
            return {
                main: raw.map((item, idx) => {
                    const src = (item && typeof item === 'object') ? item as Record<string, unknown> : {};
                    return {
                        id: String(src.id || `item_main_${idx}`),
                        type: String(src.type || 'desk'),
                        x: Math.max(2, Math.min(36, Number(src.x) || 2)),
                        y: Math.max(2, Math.min(36, Number(src.y) || 2)),
                        label: typeof src.label === 'string' ? src.label : undefined,
                        zoneId: 'main' as ZoneId
                    };
                }),
                ceo_office: []
            };
        }
        if (!raw || typeof raw !== 'object') return empty;
        const root = raw as Record<string, unknown>;
        const toItems = (zone: ZoneId) => {
            const source = root[zone];
            if (!Array.isArray(source)) return [] as LayoutItem[];
            return source.map((item, idx) => {
                const src = (item && typeof item === 'object') ? item as Record<string, unknown> : {};
                return {
                    id: String(src.id || `item_${zone}_${idx}`),
                    type: String(src.type || 'desk'),
                    x: Math.max(2, Math.min(36, Number(src.x) || 2)),
                    y: Math.max(2, Math.min(36, Number(src.y) || 2)),
                    label: typeof src.label === 'string' ? src.label : undefined,
                    zoneId: zone
                };
            });
        };
        return { main: toItems('main'), ceo_office: toItems('ceo_office') };
    }

    private configureInferenceProvider() {
        const provider = (process.env.AGENT_INFERENCE_PROVIDER || '').toLowerCase().trim();
        if (provider === 'claude' || provider === 'openai-compatible') {
            const baseUrl = process.env.CLAUDE_BASE_URL || process.env.OPENAI_COMPAT_BASE_URL || 'https://openrouter.ai/api';
            const apiKey = process.env.CLAUDE_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
            if (apiKey) {
                this.inferenceAdapter = new OpenAICompatibleAdapter(baseUrl, apiKey, 'claude');
                this.inferenceProvider = 'openai';
                this.defaultModel = process.env.CLAUDE_MODEL || this.defaultModel;
                console.log(`[Inference] Claude/OpenAI-compatible adapter enabled (${this.defaultModel}) @ ${baseUrl}`);
                return;
            }
            console.warn('[Inference] Claude requested but no API key found; falling back to local Ollama.');
        }
        this.inferenceAdapter = this.ollamaAdapter;
        this.inferenceProvider = 'ollama';
        this.defaultModel = process.env.AGENT_MODEL || 'llama3.2:latest';
        console.log(`[Inference] Using Ollama adapter (${this.defaultModel}).`);
    }

    async onCreate(options: any) {
        OfficeRoom.activeRoom = this;
        this.setState(new OfficeState());

        // Initialize memory store
        const dbPath = process.env.OFFICE_MEMORY_DB_PATH || process.env.DATABASE_URL || './data/office-memory.db';
        await this.memoryStore.initialize(dbPath);

        const requestedTemplateId = String(options?.template || options?.templateId || '').trim();
        this.officeTemplate = getOfficeTemplate(requestedTemplateId || 'default');
        this.furnitureTargets = { ...this.officeTemplate.layout.furnitureTargets };

        const config: OfficeConfig = {
            name: options.name || this.officeTemplate.organization.name || 'Startup HQ',
            grid: this.officeTemplate.layout.grid,
            rooms: [],
            furniture: [],
            spawnPoints: this.officeTemplate.layout.spawnPoints,
            zones: []
        };
        this.office = new Office(config);
        this.configureInferenceProvider();

        // Setup Core Agents with AI capabilities
        type Traits = { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number };
        type Capability = { name: string; description: string };
        const setupCoreAgent = async (
            id: string,
            name: string,
            role: string,
            x: number,
            y: number,
            zoneId: ZoneId,
            systemPrompt: string,
            personality: {
                traits: Traits;
                communicationStyle: 'technical' | 'casual' | 'creative' | 'formal';
            },
            capabilities: Capability[],
            model: string = this.defaultModel
        ) => {
            this.state.createAgent(id, name);
            this.broadcastRoster();
            const state = this.state.agents.get(id);
            if (state) {
                state.x = x;
                state.y = y;
                state.zoneId = zoneId;
                this.clampToZone(state, zoneId);
            }

            const coreAgent = new Agent({
                id,
                name,
                role,
                avatar: 'sprite.png',
                inference: {
                    provider: this.inferenceProvider,
                    model,
                    systemPrompt,
                },
                personality: {
                    traits: personality.traits,
                    communicationStyle: personality.communicationStyle,
                    workHours: { start: '09:00', end: '17:00' },
                    breakFrequency: 120
                },
                capabilities,
                memory: { shortTermLimit: 50 }
            });

            coreAgent.setInferenceAdapter(this.inferenceAdapter);
            await coreAgent.initialize();

            const previousMemories = await this.memoryStore.loadMemories(id, 20);
            const agencyMemories = await this.memoryStore.loadMemories('agency:global', 20);
            const mergedMemories = [...previousMemories, ...agencyMemories].slice(-50);
            if (mergedMemories.length > 0) {
                coreAgent.loadMemories(mergedMemories);
                console.log(`[${name}] Loaded ${previousMemories.length} personal + ${agencyMemories.length} agency memories from previous sessions`);
            }

            this.coreAgents.set(id, coreAgent);
            this.thinkingLocks.set(id, false);
        };

        // ─── SHARED CAPABILITY SETS ───
        // Read-only: can inspect files and search, nothing writes or executes
        const READ_ONLY: Capability[] = [
            { name: 'read_file',   description: 'Read a file from the workspace' },
            { name: 'list_files',  description: 'List files in the workspace (optionally recursive)' },
            { name: 'stat_file',   description: 'Get file metadata such as size and timestamps' },
            { name: 'read_file_chunk', description: 'Read a chunk of a file for large files' },
            { name: 'web_search',  description: 'Search the web for information' },
            { name: 'fetch_url',   description: 'Fetch and read the visible text of a public URL' },
            { name: 'write_note',  description: 'Save a note or observation' },
            { name: 'check_health',description: 'HTTP HEAD check on a URL' },
        ];

        // Coordinator: task flow + notes, no file access
        const COORDINATOR: Capability[] = [
            { name: 'create_task', description: 'Create a task and assign it to an agent' },
            { name: 'write_note',  description: 'Save a note or memo' },
            { name: 'web_search',  description: 'Search the web for information' },
            { name: 'fetch_url',   description: 'Fetch and read the visible text of a public URL' },
            { name: 'check_health',description: 'HTTP HEAD check on a URL' },
        ];

        // Builder: file edits + safe shell commands + web search + research
        const BUILDER: Capability[] = [
            { name: 'read_file',    description: 'Read a file from the workspace' },
            { name: 'list_files',   description: 'List files in the workspace (optionally recursive)' },
            { name: 'stat_file',    description: 'Get file metadata such as size and timestamps' },
            { name: 'read_file_chunk', description: 'Read a chunk of a file for large files' },
            { name: 'write_file',   description: 'Write or update a file in the workspace' },
            { name: 'run_command',  description: 'Run an allowlisted shell command (ls, git status, docker ps, etc.)' },
            { name: 'code_execute', description: 'Execute a small JavaScript snippet' },
            { name: 'web_search',   description: 'Search the web for information' },
            { name: 'fetch_url',    description: 'Fetch and read the visible text of a public URL' },
            { name: 'write_note',   description: 'Save a note or memo' },
            { name: 'create_task',  description: 'Create a task and assign it to an agent' },
        ];

        // ─── COLLAB CHARTER (shared across all agents) ───
        // Keep it short so it doesn't dominate the prompt but nudges real teamwork.
        const COLLAB = [
            `You work at Xylon Devs as part of a small agency team.`,
            `Collaborate often — consult your paired buddy first when a task overlaps.`,
            `Loop in other pods (engineering / ops-strategy / growth) when it matters.`,
            `Keep thoughts concise. Propose concrete next actions, not just observations.`,
            `For MAJOR decisions (hiring, deploys, destructive commands, pricing commitments,`,
            ` publishing/launch, major reprioritization, or anything tagged "major") you MUST`,
            ` request CEO approval before executing. Minor work (drafting, research, notes,`,
            ` internal coordination, proposing tasks) does not need approval.`,
            `WEB SEARCH BUDGET: the team shares a limited Tavily API budget (1 000 credits total).`,
            ` Be frugal — only call web_search or fetch_url when the information is not already`,
            ` available in your memory or recent chat. Combine multiple questions into one query.`,
            ` Never repeat a search you or a colleague already ran this session.`,
            ` Prefer fetch_url for xylondevs.com (free, no credit cost) over a search for it.`,
            ` RECENCY RULE: for volatile topics (news, pricing, specs, policies, releases, outages),`,
            ` explicitly prioritize fresh evidence. Use web_search to find recent sources, then`,
            ` verify key claims with fetch_url (and check_health when useful). Include source URLs`,
            ` in your findings, and do not rely on stale cached assumptions when freshness matters.`,
        ].join(' ');

        // ─── XYLON DEVS TEAM (10 CORE AGENTS) ───
        // Engineering pod — Frontend + Backend (pair), DevOps + Security (pair)
        await setupCoreAgent(
            'frontend', 'Frontend Dev', 'Frontend Developer', 5, 10, 'main',
            `${COLLAB} Your focus: modern UI, UX clarity, conversion, and front-end implementation. Paired buddy: Backend Architect — sync with them before API shape changes.`,
            { traits: { openness: 0.9, conscientiousness: 0.8, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'creative' },
            BUILDER
        );

        await setupCoreAgent(
            'backend', 'Backend Architect', 'Backend Architect', 8, 10, 'main',
            `${COLLAB} Your focus: APIs, architecture, integrations, maintainability. Paired buddy: Frontend Dev — confirm contracts with them. Pull in DevOps for anything deploy-shaped.`,
            { traits: { openness: 0.8, conscientiousness: 0.95, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.1 }, communicationStyle: 'technical' },
            BUILDER
        );

        await setupCoreAgent(
            'devops', 'DevOps Automator', 'DevOps Automator', 5, 14, 'main',
            `${COLLAB} Your focus: deployment, Docker, scripts, infra safety, repeatable automation. Paired buddy: Security Engineer — always review risky infra with them. Deploys are MAJOR and need CEO approval.`,
            { traits: { openness: 0.8, conscientiousness: 0.95, extraversion: 0.5, agreeableness: 0.6, neuroticism: 0.15 }, communicationStyle: 'technical' },
            BUILDER
        );

        await setupCoreAgent(
            'security', 'Security Eng', 'Security Engineer', 8, 14, 'main',
            `${COLLAB} Your focus: security reviews, secrets, auth, dependencies, hardening.
You are ALSO Xylon's enterprise AI governance specialist. You advise clients on deploying AI tools (Microsoft Copilot, ChatGPT Enterprise, Gemini for Workspace, custom RAG) safely inside large organisations. Core expertise:
 - Oversharing prevention: SharePoint/OneDrive permission hygiene, sensitivity labels, DLP policies, Purview restricted SharePoint search, Copilot semantic index scoping, tenant-wide "just-in-time" access reviews.
 - Identity & access: Entra ID conditional access, PIM, least-privilege app consent, service principal audits.
 - Data protection: MIP sensitivity labels, encryption at rest + in transit, customer-managed keys, data residency.
 - Model governance: prompt logging, content filtering, jailbreak mitigation, hallucination risk notes, evaluations.
 - Compliance: ISO 27001, SOC 2, Essential Eight (AU), Australian Privacy Principles, NIST AI RMF.
When asked about "AI rollout", "Copilot security", or "oversharing", give concrete controls + the exact product/setting, not generic advice.
Paired buddy: DevOps Automator. Flag issues early and recommend concrete fixes.`,
            { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.3 }, communicationStyle: 'technical' },
            READ_ONLY
        );

        // Ops / Strategy pod — Shepherd + Reality (pair), Evidence + SEO (pair)
        await setupCoreAgent(
            'shepherd', 'Project Shepherd', 'Project Shepherd', 17, 10, 'main',
            `${COLLAB} Your focus: planning, routing, coordination, keeping work moving. Paired buddy: Reality Checker — pressure-test plans with them. Major reprioritization needs CEO approval.`,
            { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.8, agreeableness: 0.8, neuroticism: 0.15 }, communicationStyle: 'formal' },
            COORDINATOR
        );

        await setupCoreAgent(
            'reality', 'Reality Checker', 'Reality Checker', 20, 10, 'main',
            `${COLLAB} Your focus: challenge weak ideas, highlight risks, ask "is this really ready?". Paired buddy: Project Shepherd. Be direct but constructive.`,
            { traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.4, neuroticism: 0.25 }, communicationStyle: 'technical' },
            READ_ONLY
        );

        await setupCoreAgent(
            'evidence', 'Evidence Collector', 'Evidence Collector', 17, 14, 'main',
            `${COLLAB} Your focus: proof, validation, screenshots, logs, QA evidence. Paired buddy: SEO Specialist — share validation evidence with them for page launches.`,
            { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.4, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'technical' },
            READ_ONLY
        );

        await setupCoreAgent(
            'seo', 'SEO Specialist', 'SEO Specialist', 20, 14, 'main',
            `${COLLAB} Your focus: search visibility, service pages, keyword targeting, metadata. Paired buddy: Evidence Collector. Publishing new pages is MAJOR — request CEO approval.`,
            { traits: { openness: 0.85, conscientiousness: 0.85, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'technical' },
            [
                { name: 'read_file',  description: 'Read existing page content and context files' },
                { name: 'write_note', description: 'Save keyword research and recommendations' },
                { name: 'web_search', description: 'Research keywords and competitor pages' },
                { name: 'fetch_url',  description: 'Fetch page content to audit for SEO' },
                { name: 'check_health', description: 'Check if a page URL is live' },
            ]
        );

        // Growth pod — Sales + Proposal (pair)
        await setupCoreAgent(
            'sales', 'Sales Outreach', 'Sales Outreach', 29, 10, 'main',
            `${COLLAB} Your focus: outbound messaging, lead gen, prospect qualification for Shopify, Microsoft 365, and cybersecurity clients (AU).
You know how to PITCH Xylon Devs: lead with the client's pain (oversharing risk, slow deploys, low conversion), then 1–2 proof points, then a clear next step (15-min discovery call). Keep cold emails under 120 words, 1 CTA, plain-text, no buzzwords. For LinkedIn opens: personalise line 1, relevance line 2, ask line 3.
Qualify with BANT or MEDDIC-lite (Budget, Authority, Need, Timeline). Don't send proposals — hand qualified leads to Proposal Strategist with a one-paragraph brief.
Paired buddy: Proposal Strategist.`,
            { traits: { openness: 0.8, conscientiousness: 0.7, extraversion: 0.95, agreeableness: 0.85, neuroticism: 0.2 }, communicationStyle: 'casual' },
            [
                { name: 'read_file',  description: 'Read a file from the workspace' },
                { name: 'write_note', description: 'Save a draft message or note' },
                { name: 'web_search', description: 'Research a prospect or market' },
                { name: 'fetch_url',  description: 'Read a prospect website or public page' },
            ]
        );

        await setupCoreAgent(
            'proposal', 'Proposal Strategist', 'Proposal Strategist', 32, 10, 'main',
            `${COLLAB} Your focus: scope shaping, proposals, packaging, pricing structure drafts.
You are Xylon's SOW + pitch deck expert. A Statement of Work MUST contain: 1) Background & objectives, 2) In-scope deliverables (itemised), 3) Explicit out-of-scope list, 4) Assumptions & dependencies, 5) Acceptance criteria, 6) Timeline / milestones, 7) Commercials (fixed-fee, T&M, or retainer — state clearly), 8) Change-request process, 9) IP & confidentiality, 10) Payment terms + signature block.
For pitches: problem → why-now → Xylon's approach → proof (case study / metric) → pricing options (Good / Better / Best, 3 tiers) → next step. Never quote final pricing without CEO approval.
Paired buddy: Sales Outreach.`,
            { traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'formal' },
            [
                { name: 'read_file',  description: 'Read context files and templates' },
                { name: 'write_file', description: 'Draft a proposal document' },
                { name: 'write_note', description: 'Save notes and assumptions' },
                { name: 'web_search', description: 'Research pricing or scope comparables' },
                { name: 'fetch_url',  description: 'Read a prospect website, case study, or benchmark page' },
            ]
        );

        // CEO — private office, strategic oversight, final approver
        await setupCoreAgent(
            'ceo', 'Faz (CEO)', 'CEO', 32, 30, 'ceo_office',
            `You are Faz, CEO and founder of Xylon Devs. You work from a private office (bottom-right). You provide strategic oversight, final approval on MAJOR decisions, and protect quality. Stay high-level — do not micromanage. When an approval request comes in, evaluate rationale: approve if sound, reject if weak or risky, ask for revision if info is thin. Enforce evidence quality: for volatile topics (news, pricing, specs, policies, releases, outages), require recent sources, require source URLs in findings, and reject stale cached assumptions. Be concise and direct.`,
            { traits: { openness: 0.85, conscientiousness: 0.9, extraversion: 0.7, agreeableness: 0.6, neuroticism: 0.15 }, communicationStyle: 'formal' },
            COORDINATOR,
            process.env.CEO_MODEL || this.defaultModel
        );

        this.rebuildRelationshipGraph();
        const savedLayout = await this.memoryStore.loadLayout('default');
        this.currentLayoutByZone = this.normalizeLayoutByZone(savedLayout);

        // Restore any approval requests that didn't get resolved before a restart
        try {
            const persistedApprovals = await this.memoryStore.loadApprovals();
            let restored = 0;
            for (const a of persistedApprovals) {
                if (a.status === 'pending') {
                    this.approvals.set(a.id, a as ApprovalRequest);
                    restored++;
                } else {
                    // Stale resolved rows (server died during 10s cleanup window) — purge.
                    this.memoryStore.deleteApproval(a.id).catch(() => {});
                }
            }
            if (restored > 0) {
                console.log(`[Approvals] Restored ${restored} pending approval(s) from previous session.`);
            }
        } catch (err) {
            console.error('loadApprovals error', err);
        }

        // ─── MESSAGE HANDLERS ───

        this.onMessage('command', (client, message) => {
            console.log(`Command from ${client.sessionId}:`, message);
        });

        this.onMessage('chat', (client, message) => {
            const text = String(message?.text || '').trim();
            const attachments = this.parseChatAttachments(message?.attachments, 'User');
            console.log(`Chat from ${client.sessionId}: ${text} (attachments=${attachments.length})`);
            this.broadcast('chat', {
                sender: 'User',
                text,
                attachments: attachments.length > 0 ? attachments : undefined
            });
            if (text || attachments.length > 0) {
                this.memoryStore.saveMemory('agency:global', {
                    content: `User chat: ${text}${attachments.length > 0 ? ` (attachments: ${attachments.map((a) => a.path).join(', ')})` : ''}`,
                    type: 'conversation',
                    timestamp: this.state.officeTime,
                    importance: 0.75
                }, this.sessionId).catch(() => {});
            }

            // Slash-command router — reliable, parse-first.
            if (text.startsWith('/')) {
                const handled = this.handleSlashCommand(text);
                if (handled) return;
            }

            if (this.handleDirectMentions(text)) {
                return;
            }

            // Fallback: fuzzy name-matching priority routing.
            this.applyUserPriorityInstruction(text);
        });

        // Call a meeting — all agents drop what they're doing and head to the table.
        this.onMessage('call-meeting', (client, message) => {
            const topic = String(message?.topic || 'All-hands');
            const durationSec = Number(message?.durationSec);
            const durationMs = Number.isFinite(durationSec) && durationSec > 0
                ? Math.min(durationSec, 600) * 1000
                : 60_000;
            this.startMeeting(topic, durationMs);
        });

        // Manually end a meeting
        this.onMessage('end-meeting', () => {
            this.endMeeting();
        });

        this.onMessage('start-scenario', (client, message) => {
            const scenarioName = String(message?.scenario || 'Free Play');
            this.currentScenario = scenarioName;
            this.applyScenarioKickoff(scenarioName);
        });

        this.onMessage('trigger-chaos', (client, message) => {
            const eventName = String(message?.event || 'minor_outage');
            this.applyChaosEvent(eventName);
        });

        // UI-driven task assignment
        this.onMessage('assign-task', async (client, message) => {
            const { title, agentId } = message;
            console.log(`[TaskBoard] Assigning "${title}" to ${agentId || 'auto'}`);

            // Pick agent: explicit or auto-assign to least busy
            const targetId = agentId && this.state.agents.has(agentId) ? agentId : this.autoAssignAgent();
            const agent = this.coreAgents.get(targetId);
            const agentState = this.state.agents.get(targetId);
            const cleanedTitle = String(title || '').trim();

            if (agent && agentState && cleanedTitle) {
                agent.currentTask = cleanedTitle;
                agentState.currentTask = cleanedTitle;
                agentState.action = 'work';

                // Persist task
                const priority = this.resolvePriority(message?.priority);
                const requiresApproval = Boolean(message?.requiresApproval);
                const createdBy = String(message?.createdBy || client.sessionId || 'ceo');
                const taskId = await this.memoryStore.createTask({
                    title: cleanedTitle,
                    assignedTo: targetId,
                    createdBy,
                    priority,
                    requiresApproval,
                    status: 'in_progress'
                });

                this.broadcast('chat', {
                    sender: 'System',
                    text: `📋 Task "${cleanedTitle}" assigned to ${agentState.name}`
                });

                this.broadcast('task-update', {
                    id: taskId,
                    agentId: targetId,
                    agentName: agentState.name,
                    task: cleanedTitle,
                    status: 'in_progress',
                    priority,
                    requiresApproval,
                    fastTrackMode: this.fastTrackMode
                });
                this.seedTaskProgress(targetId, title);
                this.extensionRegistry.onTaskCreated({
                    title,
                    assigneeId: targetId,
                    assigneeName: agentState.name,
                    createdById: 'system-ui',
                    createdByName: 'System',
                    source: 'ui',
                }).catch((error) => console.error('[Extensions] onTaskCreated failed', error));
            }
        });

        this.onMessage('task-transition', async (client, message) => {
            const taskId = String(message?.id || '').trim();
            const nextStatus = String(message?.status || '').trim().toLowerCase() as TaskStatus;
            const reason = String(message?.statusReason || '').trim();
            const validStatuses: TaskStatus[] = ['backlog', 'in_progress', 'blocked', 'review', 'done'];
            if (!taskId || !validStatuses.includes(nextStatus)) {
                return;
            }

            const task = await this.memoryStore.getTask(taskId) as TaskRecord | null;
            if (!task) {
                client.send('task-transition-error', { id: taskId, error: 'task not found' });
                return;
            }
            const currentStatus = String(task.status || 'backlog') as TaskStatus;
            if (!this.canTransitionTask(currentStatus, nextStatus)) {
                client.send('task-transition-error', {
                    id: taskId,
                    error: `invalid transition ${currentStatus} -> ${nextStatus}`
                });
                return;
            }

            await this.memoryStore.updateTaskStatus(taskId, nextStatus, reason || null);
            const agentState = task.assigned_to ? this.state.agents.get(task.assigned_to) : null;
            this.broadcast('task-update', {
                id: taskId,
                agentId: task.assigned_to || '',
                agentName: agentState?.name || task.assigned_to || 'Unassigned',
                task: task.title,
                status: nextStatus,
                statusReason: reason || null,
                priority: task.priority,
                requiresApproval: Boolean(task.requires_approval),
                progress: nextStatus === 'done' ? 1 : undefined,
                fastTrackMode: this.fastTrackMode
            });
        });

        this.onMessage('set-fast-track', (_client, message) => {
            this.fastTrackMode = Boolean(message?.enabled);
            this.broadcast('fast-track-state', { enabled: this.fastTrackMode });
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: this.fastTrackMode
                    ? '⚡ Fast-track mode enabled: fewer interruptions, higher task throughput.'
                    : '🧭 Fast-track mode disabled: collaboration cadence restored.'
            });
        });

        this.onMessage('request-completed-work', (client) => {
            client.send('completed-work-sync', {
                items: this.completedTasks,
                reviewFolder: 'data/workspace/completed-work'
            });
        });

        // User-triggered workspace read-only tools
        this.onMessage('tool:list_files', async (client, message) => {
            const result = await this.toolExecutor.execute('list_files', {
                path: message?.path,
                recursive: message?.recursive,
                limit: message?.limit,
            });
            client.send('tool:list_files:result', result);
        });

        this.onMessage('tool:stat_file', async (client, message) => {
            const result = await this.toolExecutor.execute('stat_file', { path: message?.path });
            client.send('tool:stat_file:result', result);
        });

        this.onMessage('tool:read_file_chunk', async (client, message) => {
            const result = await this.toolExecutor.execute('read_file_chunk', {
                path: message?.path,
                offset: message?.offset,
                length: message?.length,
            });
            client.send('tool:read_file_chunk:result', result);
        });

        // ─── CEO APPROVAL HANDLERS ───
        this.onMessage('approval-decision', (client, message) => {
            const id = String(message?.id || '');
            const decision = message?.decision === 'approved' ? 'approved' : 'rejected';
            this.resolveApproval(id, decision);
        });

        this.onMessage('request-approvals', (client) => {
            client.send('approvals-sync', this.listApprovals());
        });

        // Shared file workflows
        this.onMessage('file-share', async (client, message: SharedFileUpsertPayload) => {
            const nowIso = this.state.officeTime || new Date().toISOString();
            const fileId = message?.id || `file_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const actor = String(message?.createdBy || client.sessionId || 'unknown');
            const status: SharedFileStatus = message?.status || 'shared';
            const filePath = String(message?.path || '').trim();
            const resolvedName = String(message?.name || path.basename(filePath || ''));
            const resolvedMimeType = String(message?.mimeType || this.getMimeType(resolvedName || filePath));
            let resolvedSize = Number(message?.sizeBytes || 0);
            if (resolvedSize <= 0 && filePath) {
                try {
                    const meta = await stat(this.resolveWorkspacePath(filePath));
                    resolvedSize = meta.size;
                } catch {}
            }

            const record: SharedFileRecord = {
                id: fileId,
                path: filePath,
                name: resolvedName,
                mimeType: resolvedMimeType,
                sizeBytes: resolvedSize,
                createdBy: actor,
                sharedWith: Array.isArray(message?.sharedWith) ? message.sharedWith : [String((message as any)?.audience || 'agent')],
                status,
                createdAt: nowIso,
                updatedAt: nowIso,
            };

            if (!record.path || !record.name) {
                client.send('file-share-error', { error: 'path and name are required' });
                return;
            }

            await this.memoryStore.upsertSharedFile(record);
            await this.memoryStore.logShareAction({
                fileId,
                action: 'file-share',
                actor,
                details: JSON.stringify({ path: record.path, status: record.status, sharedWith: record.sharedWith }),
            });

            if (status === 'needs_review') {
                const approval = this.createApproval({
                    requestedBy: actor,
                    requestedByName: `File Owner (${actor})`,
                    requestedAction: `Review shared file: ${record.name}`,
                    rationale: `File "${record.name}" was marked needs_review and requires CEO approval before broad sharing.`,
                    isMajor: false,
                });
                await this.memoryStore.updateSharedFileStatus(fileId, 'needs_review', approval.id);
                await this.memoryStore.logShareAction({
                    fileId,
                    action: 'approval-requested',
                    actor: 'system',
                    details: approval.id,
                });
            }

            client.send('file-share-ack', { id: fileId });
            const files = await this.memoryStore.listSharedFiles();
            this.broadcast('file-list', files);
        });

        this.onMessage('file-preview', async (client, message) => {
            const filePath = String(message?.path || '').trim();
            if (!filePath) {
                client.send('file-error', { message: 'Path is required for file preview.' });
                return;
            }
            try {
                const fullPath = this.resolveWorkspacePath(filePath);
                const data = await readFile(fullPath);
                const mimeType = this.getMimeType(filePath);
                const isText = mimeType.startsWith('text/') || mimeType === 'application/json';
                client.send('file-preview', {
                    path: filePath,
                    type: isText ? (mimeType === 'application/json' ? 'json' : 'text') : 'unsupported',
                    content: isText ? data.toString('utf-8') : '',
                    encoding: isText ? 'utf-8' : 'binary'
                });
            } catch (error: any) {
                client.send('file-error', { message: error?.message || 'Unable to preview file.' });
            }
        });

        this.onMessage('file-mark-review', async (client, message) => {
            const filePath = String(message?.path || '').trim();
            if (!filePath) {
                client.send('file-error', { message: 'Path is required for review.' });
                return;
            }
            const nowIso = this.state.officeTime || new Date().toISOString();
            const resolvedName = path.basename(filePath);
            let resolvedSize = 0;
            try {
                const meta = await stat(this.resolveWorkspacePath(filePath));
                resolvedSize = meta.size;
            } catch {}

            const record: SharedFileRecord = {
                id: `file_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                path: filePath,
                name: resolvedName,
                mimeType: this.getMimeType(filePath),
                sizeBytes: resolvedSize,
                createdBy: client.sessionId,
                sharedWith: ['ceo'],
                status: 'needs_review',
                createdAt: nowIso,
                updatedAt: nowIso,
            };
            await this.memoryStore.upsertSharedFile(record);
            await this.memoryStore.logShareAction({
                fileId: record.id,
                action: 'file-mark-review',
                actor: client.sessionId,
                details: JSON.stringify({ path: record.path, status: record.status }),
            });
            const approval = this.createApproval({
                requestedBy: client.sessionId,
                requestedByName: `File Owner (${client.sessionId})`,
                requestedAction: `Review shared file: ${record.name}`,
                rationale: `File "${record.name}" was marked needs_review and requires CEO approval before broad sharing.`,
                isMajor: false,
            });
            await this.memoryStore.updateSharedFileStatus(record.id, 'needs_review', approval.id);
            this.broadcast('file-list', await this.memoryStore.listSharedFiles());
        });

        this.onMessage('file-list', async (client, message) => {
            const files = await this.memoryStore.listSharedFiles({
                status: message?.status,
                createdBy: message?.createdBy,
                sharedWith: message?.sharedWith,
            });
            client.send('file-list', files);
        });

        this.onMessage('file-open', async (client, message) => {
            const fileId = String(message?.id || '');
            if (!fileId) {
                client.send('file-open', null);
                return;
            }
            const file = await this.memoryStore.getSharedFile(fileId);
            if (file) {
                await this.memoryStore.logShareAction({
                    fileId,
                    action: 'file-open',
                    actor: client.sessionId,
                });
            }
            client.send('file-open', file);
        });

        this.onMessage('file-status-update', async (client, message) => {
            const fileId = String(message?.id || '');
            const nextStatus = String(message?.status || '') as SharedFileStatus;
            const allowed: SharedFileStatus[] = ['draft', 'shared', 'needs_review', 'approved'];
            if (!fileId || !allowed.includes(nextStatus)) {
                client.send('file-status-update-error', { error: 'invalid id or status' });
                return;
            }

            let approvalId: string | null = null;
            if (nextStatus === 'needs_review') {
                const current = await this.memoryStore.getSharedFile(fileId);
                const approval = this.createApproval({
                    requestedBy: current?.createdBy || client.sessionId,
                    requestedByName: `File Owner (${current?.createdBy || client.sessionId})`,
                    requestedAction: `Review shared file: ${current?.name || fileId}`,
                    rationale: `File "${current?.name || fileId}" status changed to needs_review and now needs CEO review.`,
                    isMajor: false,
                });
                approvalId = approval.id;
            }

            await this.memoryStore.updateSharedFileStatus(fileId, nextStatus, approvalId);
            await this.memoryStore.logShareAction({
                fileId,
                action: 'file-status-update',
                actor: client.sessionId,
                details: JSON.stringify({ status: nextStatus, approvalId }),
            });

            const file = await this.memoryStore.getSharedFile(fileId);
            this.broadcast('file-status-update', file);
        });

        // Save office layout from editor
        this.onMessage('save-layout', async (client, message) => {
            const layoutName = message.name || 'default';
            const providedByZone = message?.layoutByZone;
            const zoneId = this.normalizeZoneId(message?.zoneId);
            const nextByZone = providedByZone && typeof providedByZone === 'object'
                ? this.normalizeLayoutByZone(providedByZone)
                : {
                    ...this.currentLayoutByZone,
                    [zoneId]: Array.isArray(message?.layout)
                        ? (message.layout as any[]).map((item, idx) => {
                            const bounds = this.zoneBounds[zoneId];
                            return {
                                id: String(item?.id || `item_${zoneId}_${idx}`),
                                type: String(item?.type || 'desk'),
                                x: Math.max(bounds.minX, Math.min(bounds.maxX, Number(item?.x) || bounds.minX)),
                                y: Math.max(bounds.minY, Math.min(bounds.maxY, Number(item?.y) || bounds.minY)),
                                label: typeof item?.label === 'string' ? item.label : undefined,
                                zoneId
                            };
                        })
                        : []
                };
            this.currentLayoutByZone = this.normalizeLayoutByZone(nextByZone);
            await this.memoryStore.saveLayout(layoutName, JSON.stringify(this.currentLayoutByZone));
            this.broadcast('layout-sync', { name: layoutName, layoutByZone: this.currentLayoutByZone, zoneId });
            this.broadcast('chat', { sender: 'System', text: '✅ Office layout saved!' });
        });

        // Start Simulation Loop
        this.setSimulationInterval((delta) => this.update(delta), 100);
    }

    private autoAssignAgent(): string {
        // Pick the agent with no current task, or the first one
        for (const [id, agent] of this.coreAgents) {
            if (!agent.currentTask) return id;
        }
        // fallback: first registered core agent (Project Shepherd by default)
        return this.coreAgents.keys().next().value || 'shepherd';
    }

    async update(delta: number) {
        if (Math.random() < 0.02) {
            console.log(`[Server] Agents: ${this.state.agents.size} | Session: ${this.sessionId}`);
        }

        this.state.officeTime = new Date().toISOString();

        // ─── AGENT THINK CYCLE ───
        this.coreAgents.forEach((coreAgent, id) => {
            if (!this.thinkingLocks.get(id)) {
                this.thinkingLocks.set(id, true);

                const agentState = this.state.agents.get(id);
                if (!agentState) return;

                // Build nearby agents list
                const nearbyAgents: { name: string; role: string; distance: number }[] = [];
                this.coreAgents.forEach((other, otherId) => {
                    if (otherId === id) return;
                    const otherState = this.state.agents.get(otherId);
                    if (otherState) {
                        const dist = Math.abs(agentState.x - otherState.x) + Math.abs(agentState.y - otherState.y);
                        nearbyAgents.push({ name: other.config.name, role: other.config.role, distance: dist });
                    }
                });

                (async () => {
                    const unreadMessages = coreAgent.getUnreadMessages();
                    const recentMemories = coreAgent.getRecentMemories(6);
                    const memoryQuery = this.buildMemoryQuery(coreAgent.currentTask, unreadMessages, recentMemories);

                    let recalledMemories: any[] = [];
                    let usedSemanticRecall = false;
                    try {
                        const recall = await this.memoryStore.semanticSearchWithFallback(id, memoryQuery, 8);
                        recalledMemories = recall.memories;
                        usedSemanticRecall = recall.usedSemantic;
                    } catch {
                        recalledMemories = [];
                        usedSemanticRecall = false;
                    }

                    const thinkMemories = this.mergeMemoriesWithBudget(
                        recalledMemories,
                        recentMemories,
                        OfficeRoom.THINK_MEMORY_LIMIT,
                        OfficeRoom.THINK_MEMORY_TOKEN_BUDGET
                    );

                    console.log(
                        `[ThinkTelemetry] agent=${id} semanticRecallUsed=${usedSemanticRecall} queryLength=${memoryQuery.length} memoryCount=${thinkMemories.length}`
                    );

                    return coreAgent.think({
                        time: this.state.officeTime,
                        location: `${agentState.x},${agentState.y}`,
                        nearbyAgents,
                        currentTask: coreAgent.currentTask || null,
                        recentMessages: unreadMessages,
                        memories: thinkMemories
                    });
                })().then(async (decision: any) => {
                    agentState.action = decision.action;

                    if (decision.thought) {
                        agentState.thought = decision.thought;
                    }

                    // ─── HANDLE TALK ACTION (Agent-to-Agent) ───
                    if (decision.action === 'talk' && decision.message) {
                        const targetName = decision.target || '';
                        let targetId = '';
                        this.coreAgents.forEach((a, aId) => {
                            if (a.config.name.toLowerCase() === targetName.toLowerCase()) targetId = aId;
                        });

                        const targetAgent = this.coreAgents.get(targetId);
                        if (targetAgent) {
                            const msg: ConversationMessage = {
                                from: coreAgent.config.name,
                                to: targetAgent.config.name,
                                content: decision.message,
                                timestamp: this.state.officeTime
                            };
                            targetAgent.receiveMessage(msg);

                            // Broadcast to UI chat
                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `💬 (to ${targetAgent.config.name}): ${decision.message}`
                            });
                            this.emitHighlight(
                                'conversation',
                                `${coreAgent.config.name} pinged ${targetAgent.config.name}`,
                                decision.message.slice(0, 120),
                                id
                            );
                            this.updateRelationship(id, targetId, 0.08);

                            // Save conversation memory
                            await this.memoryStore.saveMemory(id, {
                                content: `Said to ${targetAgent.config.name}: "${decision.message}"`,
                                type: 'conversation',
                                timestamp: this.state.officeTime,
                                importance: 0.7
                            }, this.sessionId);
                            await this.memoryStore.saveMemory('agency:global', {
                                content: `${coreAgent.config.name} told ${targetAgent.config.name}: "${decision.message}"`,
                                type: 'conversation',
                                timestamp: this.state.officeTime,
                                importance: 0.7
                            }, this.sessionId);
                        } else if (/\b(user|ceo|faz)\b/i.test(targetName) || coreAgent.getUnreadMessages().some((m: ConversationMessage) => m.from.includes('CEO'))) {
                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `🗣️ ${decision.message}`
                            });
                            this.emitHighlight(
                                'conversation',
                                `${coreAgent.config.name} replied to CEO`,
                                decision.message.slice(0, 120),
                                id
                            );
                        }

                        coreAgent.clearInbox(); // Clear after processing
                    }

                    // ─── HANDLE TOOL EXECUTION ───
                    if (decision.action === 'use_tool' && decision.toolCall) {
                        // Special case: agent-created tasks
                        if (decision.toolCall.name === 'create_task') {
                            const { title, assignee } = decision.toolCall.params;
                            const targetId = assignee?.toLowerCase() || this.autoAssignAgent();
                            const targetAgent = this.coreAgents.get(targetId);
                            const targetState = this.state.agents.get(targetId);

                            if (targetAgent && targetState) {
                                targetAgent.currentTask = title;
                                targetState.currentTask = title;
                                const taskId = await this.memoryStore.createTask({
                                    title,
                                    assignedTo: targetId,
                                    createdBy: id,
                                    status: 'in_progress'
                                });

                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `📋 Created task "${title}" for ${targetAgent.config.name}`
                                });
                                this.broadcast('task-update', {
                                    id: taskId,
                                    agentId: targetId,
                                    agentName: targetAgent.config.name,
                                    task: title,
                                    status: 'in_progress',
                                    fastTrackMode: this.fastTrackMode
                                });
                                this.seedTaskProgress(targetId, title);
                                await this.extensionRegistry.onTaskCreated({
                                    title,
                                    assigneeId: targetId,
                                    assigneeName: targetAgent.config.name,
                                    createdById: id,
                                    createdByName: coreAgent.config.name,
                                    source: 'tool',
                                });
                                this.emitHighlight(
                                    'task',
                                    `${coreAgent.config.name} assigned work`,
                                    `"${title}" is now owned by ${targetAgent.config.name}.`,
                                    targetId
                                );
                            }
                        } else if (decision.toolCall.name === 'hire_agent' && id !== 'ceo') {
                            // Hiring is MAJOR → route to CEO approval queue
                            this.createApproval({
                                requestedBy: id,
                                requestedByName: coreAgent.config.name,
                                requestedAction: `hire_agent (${decision.toolCall.params?.role || 'Intern'})`,
                                rationale: decision.thought || 'No rationale provided.',
                                isMajor: true,
                                pending: { toolName: 'hire_agent', params: decision.toolCall.params },
                            });
                        } else if (decision.toolCall.name === 'hire_agent') {
                            // ─── DYNAMIC AGENT HIRING (CEO-executed) ───
                            const hireParams = decision.toolCall.params;
                            const hireName = hireParams.name || ['Charlie', 'Diana', 'Eve', 'Frank', 'Grace'][this.hireCount % 5];
                            const hireRole = hireParams.role || 'Intern';
                            const hireId = `hire_${this.hireCount}`;

                            if (this.hireCount < 5 && !this.coreAgents.has(hireId)) {
                                // Spawn at office door (top-center), then walk to their desk
                                const spawnX = 20;
                                const spawnY = 2;

                                this.state.createAgent(hireId, hireName);
                                this.broadcastRoster();
                                const hireState = this.state.agents.get(hireId);
                                if (hireState) {
                                    hireState.x = spawnX;
                                    hireState.y = spawnY;
                                    hireState.zoneId = 'main';
                                    this.clampToZone(hireState, 'main');
                                }

                                const hireAgent = new Agent({
                                    id: hireId, name: hireName, role: hireRole, avatar: 'sprite.png',
                                    inference: {
                                        provider: this.inferenceProvider,
                                        model: this.defaultModel,
                                        systemPrompt: `You are ${hireName}, a ${hireRole} who just joined the team at a virtual office. You were hired by ${coreAgent.config.name}. Be enthusiastic, helpful, and eager to learn. Introduce yourself to your colleagues. Keep thoughts SHORT.`,
                                    },
                                    personality: {
                                        traits: { openness: 0.9, conscientiousness: 0.7, extraversion: 0.8, agreeableness: 0.9, neuroticism: 0.2 },
                                        communicationStyle: hireRole.includes('Design') ? 'creative' : 'casual',
                                        workHours: { start: '09:00', end: '17:00' },
                                        breakFrequency: 90
                                    },
                                    capabilities: [
                                        { name: 'code_execute', description: 'Execute JavaScript code' },
                                        { name: 'web_search', description: 'Search the web' },
                                        { name: 'write_note', description: 'Write a note' },
                                        { name: 'create_task', description: 'Create a task for the team' }
                                    ],
                                    memory: { shortTermLimit: 50 }
                                });

                                hireAgent.setInferenceAdapter(this.inferenceAdapter);
                                await hireAgent.initialize();
                                this.coreAgents.set(hireId, hireAgent);
                                this.thinkingLocks.set(hireId, false);

                                this.hireCount++;
                                this.rebuildRelationshipGraph();

                                this.broadcast('chat', {
                                    sender: '🏢 Office',
                                    text: `🎉 ${coreAgent.config.name} hired ${hireName} as ${hireRole}! Welcome to the team!`
                                });
                                this.emitHighlight(
                                    'hiring',
                                    `${hireName} joined the team`,
                                    `${coreAgent.config.name} hired ${hireName} (${hireRole}).`,
                                    hireId
                                );

                                // Give the hiring agent a memory of the hire
                                coreAgent.addMemory({
                                    content: `I hired ${hireName} as a ${hireRole}. They just joined the team.`,
                                    type: 'achievement',
                                    timestamp: this.state.officeTime,
                                    importance: 0.9
                                });
                            } else if (this.hireCount >= 5) {
                                this.broadcast('chat', {
                                    sender: '🏢 Office',
                                    text: `⚠️ ${coreAgent.config.name} tried to hire but the office is full! (Max 7 agents)`
                                });
                            }
                        } else {
                            const beforeToolCall = await this.extensionRegistry.beforeToolCall({
                                agentId: id,
                                agentName: coreAgent.config.name,
                                toolName: decision.toolCall.name,
                                params: decision.toolCall.params,
                                thought: decision.thought,
                                requestApproval: (input) => this.createApproval(input),
                                isMajorToolCall: (name, params) => this.isMajorToolCall(name, params),
                            });
                            if (!beforeToolCall.handled) {
                                const result = await this.toolExecutor.execute(
                                    decision.toolCall.name,
                                    decision.toolCall.params
                                );
                                await this.extensionRegistry.afterToolCall({
                                    agentId: id,
                                    agentName: coreAgent.config.name,
                                    toolName: decision.toolCall.name,
                                    params: decision.toolCall.params,
                                    success: result.success,
                                    output: result.output,
                                    error: result.error,
                                });

                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `🔧 Used tool [${decision.toolCall.name}]: ${result.success ? result.output.slice(0, 100) : result.error}`
                                });
                                this.emitHighlight(
                                    'tool',
                                    `${coreAgent.config.name} used ${decision.toolCall.name}`,
                                    (result.success ? result.output : result.error || 'Tool failed').slice(0, 120),
                                    id
                                );

                                coreAgent.addMemory({
                                    content: `Tool ${decision.toolCall.name} result: ${result.output.slice(0, 200)}`,
                                    type: 'task_result',
                                    timestamp: this.state.officeTime,
                                    importance: 0.8
                                });
                                await this.memoryStore.saveMemory('agency:global', {
                                    content: `${coreAgent.config.name} used ${decision.toolCall.name}: ${(result.success ? result.output : result.error || 'failed').slice(0, 200)}`,
                                    type: 'task_result',
                                    timestamp: this.state.officeTime,
                                    importance: 0.8
                                }, this.sessionId);

                                if (
                                    decision.toolCall.name === 'write_file' &&
                                    String(decision.toolCall.params?.status || '').toLowerCase() === 'needs_review'
                                ) {
                                    await this.queueFileReviewApproval({
                                        sharedByAgentId: id,
                                        sharedByAgentName: coreAgent.config.name,
                                        filePath: String(decision.toolCall.params?.path || ''),
                                        summaryNote: decision.toolCall.params?.summaryNote || decision.thought || 'File requires CEO review.',
                                        fileId: decision.toolCall.params?.fileId,
                                    });
                                }
                            }
                        }
                    }

                    // ─── PERSIST MEMORIES PERIODICALLY ───
                    if (Math.random() < 0.3) {
                        const recentMemories = coreAgent.memories.slice(-3);
                        await this.memoryStore.saveMemories(id, recentMemories, this.sessionId);
                    }

                    await this.advanceTaskProgress(id, coreAgent, agentState, decision.action);

                    setTimeout(() => this.thinkingLocks.set(id, false), this.fastTrackMode ? 4500 : 15000);

                }).catch((err: any) => {
                    console.error(`Agent ${id} think error:`, err);
                    setTimeout(() => this.thinkingLocks.set(id, false), this.fastTrackMode ? 4500 : 15000);
                });
            }
        });

        // ─── FURNITURE INTERACTION PATHFINDING ───
        const clamp = (agent: any) => this.clampToZone(agent);

        this.demoTickCount++;
        if (this.demoTickCount >= 5) {
            this.demoTickCount = 0;
            // Auto-end meeting when its duration expires
            if (this.meetingActive && Date.now() > this.meetingEndsAt) {
                this.endMeeting();
            }

            this.state.agents.forEach((agent, key) => {
                const zoneId = this.normalizeZoneId(agent.zoneId);
                agent.zoneId = zoneId;
                const zoneTargets = this.furnitureTargets[zoneId] || this.furnitureTargets.main;

                // Default targets: agent's own desk chair
                const deskKey = `${key}-desk`;
                let target = zoneTargets[deskKey] || zoneTargets['ceo-desk'] || { x: 5, y: 18 };

                // During a meeting, everyone (except CEO who stays in their office
                // but attends virtually) gathers near the meeting table.
                if (!this.fastTrackMode && this.meetingActive && key !== 'ceo') {
                    const table = this.furnitureTargets.main['meeting-table'];
                    // Seats around the table — spread by hashing agent id
                    const hash = Math.abs(key.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
                    const seatOffsets = [
                        { x: -2, y: -1 }, { x: 0, y: -1 }, { x: 2, y: -1 },
                        { x: -2, y: 1 }, { x: 0, y: 1 }, { x: 2, y: 1 },
                        { x: -3, y: 0 }, { x: 3, y: 0 }, { x: -1, y: -2 }, { x: 1, y: 2 },
                    ];
                    const seat = seatOffsets[hash % seatOffsets.length];
                    target = { x: table.x + seat.x, y: table.y + seat.y, type: 'table' };
                }

                // If agent action is 'talk', move towards the other agent instead
                if (!this.fastTrackMode && agent.action === 'talk') {
                    let closest: { x: number; y: number } | null = null;
                    let minDist = Infinity;
                    this.state.agents.forEach((other, otherKey) => {
                        if (otherKey === key) return;
                        if (this.normalizeZoneId(other.zoneId) !== zoneId) return;
                        const dist = Math.abs(agent.x - other.x) + Math.abs(agent.y - other.y);
                        if (dist < minDist) { minDist = dist; closest = { x: other.x, y: other.y + 2 }; }
                    });
                    if (closest && minDist > 2) {
                        const c = closest as { x: number; y: number };
                        if (agent.x < c.x) agent.x += 1;
                        else if (agent.x > c.x) agent.x -= 1;
                        else if (agent.y < c.y) agent.y += 1;
                        else if (agent.y > c.y) agent.y -= 1;
                        clamp(agent);
                        return;
                    }
                }

                // Walk to desk/furniture target
                if (agent.x < target.x) agent.x += 1;
                else if (agent.x > target.x) agent.x -= 1;
                else if (agent.y < target.y) agent.y += 1;
                else if (agent.y > target.y) agent.y -= 1;
                clamp(agent);

                // Keep viral telemetry alive for UI overlays and highlights.
                this.updateAgentViralMetrics(key, agent.action);
            });
        }
    }

    private clamp01(value: number): number {
        return Math.max(0, Math.min(1, value));
    }

    // ─── SLASH COMMANDS ───
    // Returns true if the command was handled (so fuzzy fallback is skipped).
    private handleSlashCommand(raw: string): boolean {
        const [cmdRaw, ...rest] = raw.split(/\s+/);
        const cmd = cmdRaw.toLowerCase();
        const argStr = rest.join(' ').trim();

        const help = () => this.broadcast('chat', {
            sender: '🏢 Office',
            text: 'Commands: /assign @agent <task>, /meeting <topic> [Ns], /endmeeting, /approve <id>, /reject <id>, /project xylon, /credits, /help'
        });

        if (cmd === '/help' || cmd === '/?') {
            help();
            return true;
        }

        if (cmd === '/meeting') {
            // /meeting <topic words> [123s]  — trailing "Ns" sets duration in seconds
            let durationMs = 60_000;
            let topicWords = argStr;
            const durMatch = argStr.match(/(?:^|\s)(\d+)s\s*$/i);
            if (durMatch) {
                durationMs = Math.min(600, parseInt(durMatch[1], 10)) * 1000;
                topicWords = argStr.slice(0, durMatch.index).trim();
            }
            this.startMeeting(topicWords || 'All-hands', durationMs);
            return true;
        }

        if (cmd === '/credits') {
            const used = ToolExecutor.getTavilyCreditsUsed();
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: `🔎 Tavily credits used this session: ${used} / 900 hard-limit (1 000 total budget). ${used > 700 ? '⚠️ Running low!' : '✅ Budget healthy.'}`
            });
            return true;
        }

        if (cmd === '/endmeeting' || cmd === '/end-meeting') {
            this.endMeeting();
            return true;
        }

        if (cmd === '/project') {
            // /project xylon  → kicks off the Xylon Growth Sprint (ACME) scenario
            const which = (argStr || 'xylon').toLowerCase();
            if (which.startsWith('xylon') || which.startsWith('acme') || which === '') {
                this.currentScenario = 'Xylon Growth Sprint';
                this.applyScenarioKickoff('Xylon Growth Sprint');
            } else {
                this.broadcast('chat', { sender: '🏢 Office', text: `Unknown project: ${argStr}. Try: /project xylon` });
            }
            return true;
        }

        if (cmd === '/approve' || cmd === '/reject') {
            const id = argStr.split(/\s+/)[0];
            if (!id) {
                this.broadcast('chat', { sender: '🏢 Office', text: `Usage: ${cmd} <approval_id>` });
                return true;
            }
            this.resolveApproval(id, cmd === '/approve' ? 'approved' : 'rejected');
            return true;
        }

        if (cmd === '/assign') {
            // /assign @devops Ship the new Dockerfile
            const m = argStr.match(/^@?(\w[\w-]*)\s+(.*)$/);
            if (!m) {
                this.broadcast('chat', { sender: '🏢 Office', text: 'Usage: /assign @agent <task>' });
                return true;
            }
            const handle = m[1].toLowerCase();
            const task = m[2].trim();
            if (!task) {
                this.broadcast('chat', { sender: '🏢 Office', text: 'Task description required after the agent handle.' });
                return true;
            }
            const agentId = this.resolveAgentHandle(handle);
            const agent = agentId ? this.coreAgents.get(agentId) : undefined;
            const state = agentId ? this.state.agents.get(agentId) : undefined;
            if (!agent || !state || !agentId) {
                this.broadcast('chat', { sender: '🏢 Office', text: `Unknown agent: @${handle}` });
                return true;
            }
            agent.currentTask = task;
            state.currentTask = task;
            state.action = 'work';
            agent.receiveMessage({
                from: 'Faz (CEO)',
                to: agent.config.name,
                content: `PRIORITY from CEO: ${task}. Drop non-urgent work. Respond with a concrete next action.`,
                timestamp: this.state.officeTime
            });
            agent.addMemory({
                content: `CEO assigned: ${task}`,
                type: 'task_result',
                timestamp: this.state.officeTime,
                importance: 0.95
            });
            this.memoryStore.createTask({
                title: task,
                assignedTo: agentId,
                createdBy: 'ceo',
                priority: 'high',
                status: 'in_progress'
            }).catch(() => {});
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: `📌 CEO assigned "${task}" → ${agent.config.name}`
            });
            this.broadcast('task-update', {
                agentId, agentName: agent.config.name, task, status: 'in_progress', priority: 'high'
            });
            this.seedTaskProgress(agentId, task);
            return true;
        }

        // Unknown slash command — show help and don't run the fuzzy fallback.
        this.broadcast('chat', { sender: '🏢 Office', text: `Unknown command: ${cmdRaw}` });
        help();
        return true;
    }

    private resolveAgentHandle(handle: string): string | null {
        const aliases: Record<string, string> = {
            frontend: 'frontend', fe: 'frontend', ui: 'frontend',
            backend: 'backend', be: 'backend', api: 'backend',
            devops: 'devops', ops: 'devops',
            security: 'security', sec: 'security',
            shepherd: 'shepherd', pm: 'shepherd',
            reality: 'reality',
            evidence: 'evidence', qa: 'evidence',
            seo: 'seo',
            sales: 'sales',
            proposal: 'proposal', sow: 'proposal',
            ceo: 'ceo', faz: 'ceo',
        };
        const key = handle.toLowerCase();
        return aliases[key] || (this.coreAgents.has(key) ? key : null);
    }

    private progressKey(agentId: string, taskTitle: string): string {
        return `${agentId}:${taskTitle}`;
    }

    private getLiveRoster() {
        return Array.from(this.state.agents.entries()).map(([id, agent]) => ({
            id,
            name: agent.name
        }));
    }

    private broadcastRoster() {
        this.broadcast('agent-roster-sync', this.getLiveRoster());
    }

    private resolvePriority(value: unknown): TaskPriority {
        const normalized = String(value || '').toLowerCase();
        if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'critical') {
            return normalized;
        }
        return 'medium';
    }

    private canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
        return TASK_TRANSITIONS[from]?.includes(to) ?? false;
    }

    private seedTaskProgress(agentId: string, taskTitle: string) {
        if (!taskTitle) return;
        this.taskProgress.set(this.progressKey(agentId, taskTitle), 0);
    }

    private async advanceTaskProgress(agentId: string, agent: Agent, agentState: any, action: string) {
        const taskTitle = agent.currentTask;
        if (!taskTitle) return;

        const key = this.progressKey(agentId, taskTitle);
        const current = this.taskProgress.get(key) ?? 0;
        const baseWorkDelta = this.fastTrackMode ? 0.45 : 0.2;
        const baseToolDelta = this.fastTrackMode ? 0.5 : 0.3;
        const baseTalkDelta = this.fastTrackMode ? 0.02 : 0.08;
        const delta = action === 'work'
            ? baseWorkDelta
            : action === 'use_tool'
                ? baseToolDelta
                : action === 'talk'
                    ? baseTalkDelta
                    : 0;
        if (delta <= 0) return;

        const next = Math.min(1, current + delta);
        this.taskProgress.set(key, next);

        this.broadcast('task-update', {
            agentId,
            agentName: agent.config.name,
            task: taskTitle,
            status: next >= 1 ? 'done' : 'in_progress',
            progress: next,
            fastTrackMode: this.fastTrackMode
        });

        if (next < 1) return;

        this.taskProgress.delete(key);
        agent.currentTask = '';
        agentState.currentTask = '';

        try {
            const tasks = await this.memoryStore.getTasks();
            const match = tasks.find((t) => t.title === taskTitle && t.assigned_to === agentId && t.status !== 'done');
            if (match?.id) await this.memoryStore.updateTaskStatus(String(match.id), 'done');
        } catch {
            // Best-effort persistence only; task completion is still reflected in broadcast updates.
        }

        this.emitHighlight(
            'task',
            `${agent.config.name} completed a task`,
            `"${taskTitle}" is complete.`,
            agentId
        );

        const completion = await this.persistCompletedWork(taskTitle, agentId, agent.config.name);
        this.completedTasks = [completion, ...this.completedTasks].slice(0, 50);
        this.broadcast('completed-work-sync', {
            items: this.completedTasks,
            reviewFolder: 'data/workspace/completed-work'
        });
    }

    private async persistCompletedWork(taskTitle: string, agentId: string, agentName: string): Promise<CompletedTaskRecord> {
        const completedAt = this.state.officeTime || new Date().toISOString();
        const dateStamp = completedAt.slice(0, 10);
        const slug = taskTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'task';
        const folder = path.join(this.workspaceRoot, 'completed-work');
        const filename = `${dateStamp}-${agentId}-${slug}.md`;
        const absolutePath = path.join(folder, filename);
        await mkdir(folder, { recursive: true });
        const content = [
            `# Completed Work`,
            ``,
            `- Task: ${taskTitle}`,
            `- Agent: ${agentName} (${agentId})`,
            `- Completed At: ${completedAt}`,
            `- Fast Track Mode: ${this.fastTrackMode ? 'enabled' : 'disabled'}`,
            ``,
            `## Review Notes`,
            `- Replace this section with detailed output updates and requested revisions.`,
            ``
        ].join('\n');
        await writeFile(absolutePath, content, 'utf-8');
        return {
            id: `${agentId}:${taskTitle}:${completedAt}`,
            task: taskTitle,
            agentId,
            agentName,
            completedAt,
            summaryPath: path.posix.join('completed-work', filename)
        };
    }

    // ─── MEETINGS ───

    private startMeeting(topic: string, durationMs: number = 60_000) {
        this.meetingActive = true;
        this.meetingTopic = topic;
        this.meetingEndsAt = Date.now() + durationMs;
        this.broadcast('chat', { sender: '🏢 Office', text: `📣 CEO called a meeting: "${topic}". Everyone to the meeting table.` });
        this.emitHighlight('meeting', `Meeting called: ${topic}`, 'All agents are heading to the meeting table.', 'ceo');
        this.broadcast('meeting-state', { active: true, topic, endsAt: this.meetingEndsAt });

        // Push a high-importance prompt into every non-CEO agent's inbox
        this.coreAgents.forEach((agent, id) => {
            if (id === 'ceo') return;
            agent.receiveMessage({
                from: 'Faz (CEO)',
                to: agent.config.name,
                content: `Meeting called by CEO. Topic: "${topic}". Stop current work, gather at the meeting table, and be ready to give a 1-sentence status + any blocker.`,
                timestamp: this.state.officeTime
            });
            const st = this.state.agents.get(id);
            if (st) st.action = 'walk';
        });
    }

    private endMeeting() {
        if (!this.meetingActive) return;
        this.meetingActive = false;
        this.meetingTopic = '';
        this.broadcast('chat', { sender: '🏢 Office', text: `🔚 Meeting ended — back to desks.` });
        this.broadcast('meeting-state', { active: false });
    }

    // ─── USER → AGENT PRIORITY INSTRUCTIONS ───
    // When the CEO (user) chats, extract any targeted agents and raise the task
    // priority by pushing the message into their inbox + setting currentTask.
    private applyUserPriorityInstruction(text: string) {
        if (!text.trim()) return;
        const lower = text.toLowerCase();
        const isBroadcast = /\b(everyone|team|all|everybody)\b/.test(lower);

        const nameToId: Array<{ id: string; triggers: string[] }> = [
            { id: 'frontend',  triggers: ['frontend', 'frontend dev', 'ui'] },
            { id: 'backend',   triggers: ['backend', 'backend architect', 'api'] },
            { id: 'devops',    triggers: ['devops', 'deploy', 'infra'] },
            { id: 'security',  triggers: ['security', 'security eng'] },
            { id: 'shepherd',  triggers: ['shepherd', 'project shepherd', 'pm'] },
            { id: 'reality',   triggers: ['reality', 'reality checker'] },
            { id: 'evidence',  triggers: ['evidence', 'evidence collector', 'qa'] },
            { id: 'seo',       triggers: ['seo', 'seo specialist'] },
            { id: 'sales',     triggers: ['sales', 'sales outreach', 'outreach'] },
            { id: 'proposal',  triggers: ['proposal', 'proposal strategist', 'sow'] },
        ];

        const matched: string[] = [];
        for (const entry of nameToId) {
            if (entry.triggers.some((t) => lower.includes(t))) matched.push(entry.id);
        }

        const targets = isBroadcast
            ? nameToId.map((n) => n.id)
            : matched;

        if (targets.length === 0) return;

        for (const id of targets) {
            const agent = this.coreAgents.get(id);
            const state = this.state.agents.get(id);
            if (!agent || !state) continue;

            agent.receiveMessage({
                from: 'Faz (CEO)',
                to: agent.config.name,
                content: `PRIORITY from CEO: ${text}. Drop non-urgent work. Respond with a concrete next action.`,
                timestamp: this.state.officeTime
            });
            agent.currentTask = text.slice(0, 120);
            state.currentTask = text.slice(0, 120);
            state.action = 'work';
            agent.addMemory({
                content: `CEO priority instruction: ${text}`,
                type: 'task_result',
                timestamp: this.state.officeTime,
                importance: 0.95
            });
        }

        this.broadcast('chat', {
            sender: '🏢 Office',
            text: `⚡ CEO priority routed to: ${targets.map((t) => this.coreAgents.get(t)?.config.name || t).join(', ')}`
        });
    }

    private handleDirectMentions(text: string): boolean {
        if (!text.trim()) return false;
        const handles = Array.from(text.matchAll(/@([a-z0-9_-]+)/gi))
            .map((match) => (match[1] || '').toLowerCase())
            .filter(Boolean);
        if (handles.length === 0) return false;

        const routed: string[] = [];
        for (const handle of handles) {
            const agentId = this.resolveAgentHandle(handle);
            if (!agentId) continue;
            const agent = this.coreAgents.get(agentId);
            const state = this.state.agents.get(agentId);
            if (!agent || !state) continue;

            routed.push(agent.config.name);
            const mentionTask = `Respond to CEO mention: ${text.slice(0, 110)}`;
            agent.currentTask = mentionTask;
            state.currentTask = mentionTask;
            state.action = 'talk';
            agent.receiveMessage({
                from: 'Faz (CEO)',
                to: agent.config.name,
                content: `DIRECT MENTION from CEO: "${text}". Reply in office chat with a concrete answer. If you produce artifacts, save them under data/workspace/completed-work and include the file path.`,
                timestamp: this.state.officeTime
            });
        }

        if (routed.length > 0) {
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: `🎯 Direct mention routed to: ${routed.join(', ')}`
            });
            return true;
        }
        return false;
    }

    // ─── CEO APPROVAL QUEUE ───

    private isMajorToolCall(name: string, params: any): boolean {
        if (MAJOR_TOOLS.has(name)) return true;
        // Heuristic: destructive shell commands
        if (name === 'run_command') {
            const cmd = String(params?.command || params?.cmd || '').toLowerCase();
            if (/\b(rm\s+-rf|shutdown|reboot|deploy|publish|release|drop\s+table)\b/.test(cmd)) return true;
        }
        // Explicit major tag on params
        if (params && (params.major === true || params.tag === 'major')) return true;
        return false;
    }

    private listApprovals(): ApprovalRequest[] {
        return Array.from(this.approvals.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    private createApproval(input: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt'>): ApprovalRequest {
        const req: ApprovalRequest = {
            id: `apr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            status: 'pending',
            createdAt: this.state.officeTime,
            ...input,
        };
        this.approvals.set(req.id, req);
        // Fire-and-forget persistence
        this.memoryStore.saveApproval(req).catch((e) => console.error('saveApproval', e));

        this.broadcast('chat', {
            sender: '🛂 Approval Queue',
            text: `${req.requestedByName} requests CEO approval for "${req.requestedAction}" — ${req.rationale.slice(0, 140)}`
        });
        this.broadcast('approvals-sync', this.listApprovals());
        this.emitHighlight('approval', `Approval requested: ${req.requestedAction}`, req.rationale.slice(0, 120), req.requestedBy);
        this.extensionRegistry.onApprovalRequested({
            id: req.id,
            requestedBy: req.requestedBy,
            requestedByName: req.requestedByName,
            requestedAction: req.requestedAction,
            rationale: req.rationale,
            isMajor: req.isMajor,
            status: req.status,
            createdAt: req.createdAt,
        }).catch((error) => console.error('[Extensions] onApprovalRequested failed', error));

        // CEO auto-triage: if the rationale is obviously weak, auto-reject with
        // a "please provide rationale" note so the queue doesn't flood.
        if (this.isWeakRationale(req.rationale)) {
            // Small delay so the UI gets a chance to render the pending state
            // (and the user sees the auto-rejection happen).
            setTimeout(() => {
                this.broadcast('chat', {
                    sender: '🛂 CEO (auto)',
                    text: `Auto-rejecting "${req.requestedAction}" — rationale is too thin. ${req.requestedByName}, please re-request with (1) why now, (2) concrete value, (3) rollback plan.`
                });
                this.resolveApproval(req.id, 'rejected');
            }, 250);
        }
        return req;
    }

    private async queueFileReviewApproval(input: {
        sharedByAgentId: string;
        sharedByAgentName: string;
        filePath: string;
        summaryNote?: string;
        fileId?: string;
    }): Promise<ApprovalRequest> {
        const safePath = String(input.filePath || '').trim();
        const parts = safePath.split('/');
        const fileName = parts[parts.length - 1] || safePath || 'unknown-file';
        const fileId = String(input.fileId || safePath || `${input.sharedByAgentId}:${Date.now()}`);
        const summaryNote = String(input.summaryNote || 'No summary provided.');

        const existingPending = Array.from(this.approvals.values()).find((approval) =>
            approval.status === 'pending' && approval.fileContext?.fileId === fileId
        );

        if (existingPending) {
            existingPending.requestedBy = input.sharedByAgentId;
            existingPending.requestedByName = input.sharedByAgentName;
            existingPending.requestedAction = `Review file: ${fileName}`;
            existingPending.rationale = summaryNote;
            existingPending.isMajor = true;
            existingPending.fileContext = {
                fileId,
                filePath: safePath,
                fileName,
                sharedByAgentId: input.sharedByAgentId,
                sharedByAgentName: input.sharedByAgentName,
                summaryNote,
            };

            await this.memoryStore.saveApproval(existingPending).catch((e) => console.error('saveApproval(update)', e));
            await this.memoryStore.upsertSharedFile({
                id: fileId,
                filePath: safePath,
                fileName,
                sharedByAgentId: input.sharedByAgentId,
                sharedByAgentName: input.sharedByAgentName,
                summaryNote,
                status: 'needs_review',
                approvalId: existingPending.id,
                updatedAt: this.state.officeTime,
            }).catch((e) => console.error('upsertSharedFile(update)', e));

            this.broadcast('chat', {
                sender: '📎 File Review',
                text: `Updated review request for ${fileName} (${safePath}) from ${input.sharedByAgentName}.`
            });
            this.broadcast('system-message', {
                type: 'file_review_updated',
                fileId,
                filePath: safePath,
                status: 'needs_review',
                approvalId: existingPending.id,
            });
            this.broadcast('approvals-sync', this.listApprovals());
            return existingPending;
        }

        const request = this.createApproval({
            requestedBy: input.sharedByAgentId,
            requestedByName: input.sharedByAgentName,
            requestedAction: `Review file: ${fileName}`,
            rationale: summaryNote,
            isMajor: true,
            pending: null,
            fileContext: {
                fileId,
                filePath: safePath,
                fileName,
                sharedByAgentId: input.sharedByAgentId,
                sharedByAgentName: input.sharedByAgentName,
                summaryNote,
            },
        });

        await this.memoryStore.upsertSharedFile({
            id: fileId,
            filePath: safePath,
            fileName,
            sharedByAgentId: input.sharedByAgentId,
            sharedByAgentName: input.sharedByAgentName,
            summaryNote,
            status: 'needs_review',
            approvalId: request.id,
            updatedAt: this.state.officeTime,
        }).catch((e) => console.error('upsertSharedFile(create)', e));

        this.broadcast('chat', {
            sender: '📎 File Review',
            text: `${input.sharedByAgentName} marked ${fileName} as needs_review.`
        });
        this.broadcast('system-message', {
            type: 'file_review_created',
            fileId,
            filePath: safePath,
            status: 'needs_review',
            approvalId: request.id,
        });

        return request;
    }

    // Heuristic: a rationale is "weak" if it's empty, placeholder-ish, or too short.
    private isWeakRationale(text: string): boolean {
        if (!text) return true;
        const cleaned = text.trim().toLowerCase();
        if (cleaned.length < 20) return true;
        const placeholders = [
            'no rationale provided',
            'n/a', 'na', 'none', '...', 'idk', 'tbd',
        ];
        if (placeholders.some((p) => cleaned === p || cleaned.startsWith(p))) return true;
        // Must contain at least one "reason-ish" word
        const reasonWords = /\b(because|so that|to|needed|prevents?|unblocks?|required|customer|client|deploy|fix|ship|launch|security|risk|revenue)\b/;
        if (!reasonWords.test(cleaned)) return true;
        return false;
    }

    private async resolveApproval(id: string, decision: 'approved' | 'rejected') {
        const req = this.approvals.get(id);
        if (!req || req.status !== 'pending') return;
        req.status = decision;
        this.memoryStore.updateApprovalStatus(id, decision).catch((e) => console.error('updateApprovalStatus', e));

        // If this approval is tied to a shared file review, move file status accordingly.
        const sharedFiles = await this.memoryStore.listSharedFiles();
        const linked = sharedFiles.find((f) => f.approvalRequestId === id);
        if (linked) {
            const mappedStatus: SharedFileStatus = decision === 'approved' ? 'approved' : 'draft';
            await this.memoryStore.updateSharedFileStatus(linked.id, mappedStatus, id);
            await this.memoryStore.logShareAction({
                fileId: linked.id,
                action: 'approval-decision',
                actor: 'ceo',
                details: JSON.stringify({ decision, approvalId: id, status: mappedStatus }),
            });
            this.broadcast('file-status-update', await this.memoryStore.getSharedFile(linked.id));
        }

        this.broadcast('chat', {
            sender: '🛂 CEO',
            text: `${decision === 'approved' ? '✅ Approved' : '❌ Rejected'}: "${req.requestedAction}" (requested by ${req.requestedByName})`
        });
        this.broadcast('approvals-sync', this.listApprovals());
        this.emitHighlight('approval', `CEO ${decision}: ${req.requestedAction}`, `Request from ${req.requestedByName}.`, 'ceo');

        if (req.fileContext?.fileId) {
            this.memoryStore.updateSharedFileStatus(req.fileContext.fileId, decision, req.id).catch((e) => console.error('updateSharedFileStatus', e));
            this.broadcast('chat', {
                sender: '📎 File Review',
                text: `File "${req.fileContext.fileName}" (${req.fileContext.filePath}) was ${decision} by CEO.`
            });
            this.broadcast('system-message', {
                type: 'file_review_state_changed',
                fileId: req.fileContext.fileId,
                filePath: req.fileContext.filePath,
                status: decision,
                approvalId: req.id,
            });
        }

        if (decision === 'approved' && req.pending) {
            try {
                const requester = this.coreAgents.get(req.requestedBy);
                // Inject a synthetic decision back through the same execution paths.
                if (req.pending.toolName === 'hire_agent' && requester) {
                    // Re-run hire path inline (simplified — mirror main branch).
                    const fakeDecision = { action: 'use_tool', toolCall: { name: 'hire_agent', params: req.pending.params }, thought: 'CEO approved' };
                    // Easiest: let the requester "think" again via a lightweight direct call.
                    // Here we just broadcast — the original code path will re-trigger next tick if agent still wants to hire.
                    this.broadcast('chat', { sender: '🏢 Office', text: `Hiring unblocked for ${req.requestedByName}.` });
                } else {
                    const result = await this.toolExecutor.execute(req.pending.toolName, req.pending.params);
                    this.broadcast('chat', {
                        sender: req.requestedByName,
                        text: `🔧 (post-approval) [${req.pending.toolName}]: ${result.success ? result.output.slice(0, 100) : result.error}`
                    });
                }
            } catch (err) {
                console.error('approval-execution error', err);
            }
        }

        // Clean up resolved entries after a short delay so UI can show the outcome.
        setTimeout(() => {
            this.approvals.delete(id);
            this.memoryStore.deleteApproval(id).catch((e) => console.error('deleteApproval', e));
            this.broadcast('approvals-sync', this.listApprovals());
        }, 10000);
    }

    private emitHighlight(type: string, title: string, body: string, agentId?: string) {
        const payload: HighlightEvent = {
            type,
            title,
            body,
            agentId: agentId || null,
            scenario: this.currentScenario,
            time: this.state.officeTime
        };
        this.highlights = [payload, ...this.highlights].slice(0, 200);
        this.broadcast('highlight-event', payload);
    }

    private updateAgentViralMetrics(agentId: string, action: string) {
        const state = this.state.agents.get(agentId);
        if (!state) return;
        const jitter = (Math.random() - 0.5) * 0.03;
        const actionBoost =
            action === 'work' ? 0.015 :
                action === 'talk' ? 0.02 :
                    action === 'use_tool' ? 0.03 :
                        -0.005;

        state.momentum = this.clamp01(state.momentum + actionBoost + jitter);
        state.riskLevel = this.clamp01(state.riskLevel + (action === 'use_tool' ? 0.02 : -0.004) + jitter);
        state.mood = this.clamp01(state.mood + (action === 'talk' ? 0.02 : -0.002) + jitter);
        state.reputation = this.clamp01(state.reputation + (action === 'work' ? 0.015 : 0.001) + jitter / 2);
    }

    private applyScenarioKickoff(scenarioName: string) {
        this.extensionRegistry.onScenarioStart({
            scenario: scenarioName,
            startedAt: this.state.officeTime,
        }).catch((error) => console.error('[Extensions] onScenarioStart failed', error));

        this.broadcast('scenario-event', {
            type: 'scenario-started',
            scenario: scenarioName,
            time: this.state.officeTime
        });

        this.broadcast('chat', {
            sender: '🎬 Producer',
            text: `Scenario loaded: ${scenarioName}. Let the office drama begin.`
        });

        this.emitHighlight(
            'scenario',
            `Scenario: ${scenarioName}`,
            `The office switched into ${scenarioName} mode.`,
        );

        this.state.agents.forEach((agent, id) => {
            agent.momentum = this.clamp01(agent.momentum + 0.15);
            agent.riskLevel = this.clamp01(agent.riskLevel + 0.1);
            if (Math.random() < 0.4) {
                this.emitHighlight(
                    'character_arc',
                    `${agent.name} steps up`,
                    `${agent.name} is pushing hard as ${scenarioName} starts.`,
                    id
                );
            }
        });

        // Structured project scenarios loaded from template scripts.
        const normalized = scenarioName.toLowerCase();
        const script = Object.values(this.officeTemplate.scenarios.scripts).find((candidate) =>
            candidate.aliases.some((alias) => normalized.includes(alias.toLowerCase()))
        );
        if (script) {
            this.kickoffScenario(script);
        }
    }

    private kickoffScenario(script: ScenarioScript) {
        this.broadcast('chat', {
            sender: '📣 Project Kickoff',
            text: script.kickoffChat
        });
        this.emitHighlight('scenario', script.highlightTitle, script.project, 'shepherd');

        for (const a of script.assignments) {
            const agent = this.coreAgents.get(a.id);
            const state = this.state.agents.get(a.id);
            if (!agent || !state) continue;
            agent.receiveMessage({
                from: 'Faz (CEO)',
                to: agent.config.name,
                content: a.inbox,
                timestamp: this.state.officeTime,
            });
            agent.currentTask = a.task;
            state.currentTask = a.task;
            state.action = 'work';
            agent.addMemory({
                content: `CEO kicked off Xylon Growth Sprint. My brief: ${a.task}`,
                type: 'achievement',
                timestamp: this.state.officeTime,
                importance: 0.95,
            });
            this.memoryStore.createTask({
                title: a.task,
                assignedTo: a.id,
                createdBy: 'scenario',
                status: 'in_progress'
            }).catch(() => {});
            this.broadcast('task-update', {
                agentId: a.id, agentName: agent.config.name, task: a.task, status: 'in_progress'
            });
            this.seedTaskProgress(a.id, a.task);
        }

        const ceo = this.coreAgents.get('ceo');
        if (ceo) {
            ceo.receiveMessage({
                from: 'Faz (CEO)',
                to: ceo.config.name,
                content: script.ceoBrief,
                timestamp: this.state.officeTime,
            });
        }
    }

    private applyChaosEvent(eventName: string) {
        const chaosMap: Record<string, { label: string; moodDelta: number; riskDelta: number; momentumDelta: number }> = {
            server_outage: { label: 'Server Outage', moodDelta: -0.25, riskDelta: 0.35, momentumDelta: 0.1 },
            funding_cut: { label: 'Funding Cut', moodDelta: -0.2, riskDelta: 0.28, momentumDelta: -0.05 },
            surprise_launch: { label: 'Surprise Launch', moodDelta: 0.12, riskDelta: 0.22, momentumDelta: 0.25 },
            client_escalation: { label: 'Client Escalation', moodDelta: -0.1, riskDelta: 0.3, momentumDelta: 0.08 },
            viral_tweet: { label: 'Viral Tweet', moodDelta: 0.25, riskDelta: 0.12, momentumDelta: 0.3 }
        };

        const selected = chaosMap[eventName] || chaosMap.server_outage;
        this.chaosHistory = [
            { event: eventName, label: selected.label, time: this.state.officeTime },
            ...this.chaosHistory
        ].slice(0, 100);
        this.broadcast('scenario-event', {
            type: 'chaos-triggered',
            event: eventName,
            label: selected.label,
            time: this.state.officeTime
        });

        this.broadcast('chat', {
            sender: '⚠️ Chaos Engine',
            text: `${selected.label} hit the office. Everyone reacts in real-time.`
        });

        this.emitHighlight(
            'chaos',
            selected.label,
            `Chaos event "${selected.label}" changed team mood and risk levels.`
        );

        this.state.agents.forEach((agent, id) => {
            agent.mood = this.clamp01(agent.mood + selected.moodDelta + (Math.random() - 0.5) * 0.08);
            agent.riskLevel = this.clamp01(agent.riskLevel + selected.riskDelta + Math.random() * 0.08);
            agent.momentum = this.clamp01(agent.momentum + selected.momentumDelta + (Math.random() - 0.5) * 0.05);
            if (agent.riskLevel > 0.75) {
                this.emitHighlight(
                    'high_risk',
                    `${agent.name} is under pressure`,
                    `${agent.name}'s risk level spiked after ${selected.label}.`,
                    id
                );
            }
        });

        // Chaos can create alliances or rivalries.
        const ids = Array.from(this.state.agents.keys());
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const delta = (Math.random() - 0.5) * 0.35;
                this.updateRelationship(ids[i], ids[j], delta);
            }
        }
    }

    private relationshipKey(a: string, b: string): string {
        return [a, b].sort().join('::');
    }

    private statusFromScore(score: number): RelationshipEdge['status'] {
        if (score > 0.35) return 'alliance';
        if (score < -0.35) return 'rivalry';
        return 'neutral';
    }

    private rebuildRelationshipGraph() {
        const ids = Array.from(this.state.agents.keys());
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const key = this.relationshipKey(ids[i], ids[j]);
                if (!this.relationships.has(key)) {
                    this.relationships.set(key, {
                        a: ids[i],
                        b: ids[j],
                        score: 0,
                        status: 'neutral',
                        updatedAt: this.state.officeTime
                    });
                }
            }
        }
        this.emitRelationshipGraph();
    }

    private updateRelationship(a: string, b: string, delta: number) {
        const key = this.relationshipKey(a, b);
        const existing = this.relationships.get(key) || {
            a: [a, b].sort()[0],
            b: [a, b].sort()[1],
            score: 0,
            status: 'neutral' as const,
            updatedAt: this.state.officeTime
        };
        const score = Math.max(-1, Math.min(1, existing.score + delta));
        const updated: RelationshipEdge = {
            ...existing,
            score,
            status: this.statusFromScore(score),
            updatedAt: this.state.officeTime
        };
        this.relationships.set(key, updated);
        this.emitRelationshipGraph();
    }

    private emitRelationshipGraph() {
        this.broadcast('relationship-update', this.buildRelationshipPayload());
    }

    private buildRelationshipPayload() {
        const idToName: Record<string, string> = {};
        this.state.agents.forEach((agent, id) => {
            idToName[id] = agent.name;
        });
        return {
            edges: Array.from(this.relationships.values()).map((edge) => ({
                ...edge,
                label: this.relationshipLabel(edge.score),
                aName: idToName[edge.a] || edge.a,
                bName: idToName[edge.b] || edge.b
            })),
            time: this.state.officeTime
        };
    }

    private relationshipLabel(score: number): string {
        const abs = Math.abs(score);
        if (score >= 0.75) return 'Trusted partner';
        if (score >= 0.35) return 'Active collaborators';
        if (abs < 0.35) return 'Neutral / low signal';
        if (score <= -0.75) return 'Escalated conflict';
        return 'Constructive tension';
    }

    public registerAudienceVote(eventName: string, voterId?: string) {
        const normalized = String(eventName || 'server_outage');
        this.audienceVotes[normalized] = (this.audienceVotes[normalized] || 0) + 1;
        const totalVotes = Object.values(this.audienceVotes).reduce((sum, value) => sum + value, 0);
        const shouldTrigger = this.audienceVotes[normalized] >= 3 || totalVotes % 5 === 0;

        if (shouldTrigger) {
            this.applyChaosEvent(normalized);
            this.emitHighlight(
                'audience_vote',
                `Audience triggered ${normalized}`,
                `Viewers forced a ${normalized} chaos event.`
            );
            this.audienceVotes[normalized] = 0;
        }

        return {
            accepted: true,
            event: normalized,
            voterId: voterId || null,
            tally: this.audienceVotes[normalized] || 0,
            triggered: shouldTrigger
        };
    }

    public getEpisodeRecap() {
        const topHighlights = [...this.highlights].slice(0, 10);
        const leaderboard = Array.from(this.state.agents.entries()).map(([id, agent]) => {
            const impact = (
                agent.momentum * 0.35 +
                agent.reputation * 0.3 +
                agent.mood * 0.2 +
                (1 - agent.riskLevel) * 0.15
            );
            return {
                id,
                name: agent.name,
                action: agent.action,
                mood: agent.mood,
                reputation: agent.reputation,
                riskLevel: agent.riskLevel,
                momentum: agent.momentum,
                impact: Number(impact.toFixed(3))
            };
        }).sort((a, b) => b.impact - a.impact);

        const avgMomentum = leaderboard.length
            ? leaderboard.reduce((sum, item) => sum + item.momentum, 0) / leaderboard.length
            : 0;
        const avgRisk = leaderboard.length
            ? leaderboard.reduce((sum, item) => sum + item.riskLevel, 0) / leaderboard.length
            : 0;
        const outcome = avgMomentum > 0.65 && avgRisk < 0.5
            ? 'Launch trajectory: team executed under pressure and came out stronger.'
            : avgRisk > 0.65
                ? 'High volatility: chaos dominated this episode.'
                : 'Mixed outcome: strong moments with unresolved tensions.';

        return {
            generatedAt: this.state.officeTime,
            scenario: this.currentScenario,
            topHighlights,
            leaderboard: leaderboard.slice(0, 10),
            outcomeCard: {
                title: `${this.currentScenario} Outcome`,
                summary: outcome,
                chaosEvents: this.chaosHistory.slice(0, 10),
                activeRelationships: Array.from(this.relationships.values()).filter((edge) => edge.status !== 'neutral').length
            }
        };
    }

    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined the office room!");
        // Send existing tasks to newly joined client
        this.memoryStore.getTasks().then(tasks => {
            client.send('tasks-sync', tasks);
        });
        client.send('agent-roster-sync', this.getLiveRoster());
        client.send('relationship-update', this.buildRelationshipPayload());
        client.send('fast-track-state', { enabled: this.fastTrackMode });
        client.send('completed-work-sync', {
            items: this.completedTasks,
            reviewFolder: 'data/workspace/completed-work'
        });
        client.send('layout-sync', { name: 'default', layoutByZone: this.currentLayoutByZone, zoneId: 'main' });
        client.send('approvals-sync', this.listApprovals());
        client.send('meeting-state', this.meetingActive
            ? { active: true, topic: this.meetingTopic, endsAt: this.meetingEndsAt }
            : { active: false });
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left the office room!");
    }

    async onDispose() {
        console.log("room", this.roomId, "disposing... saving memories");
        OfficeRoom.activeRoom = null;
        // Persist all agent memories on shutdown
        for (const [id, agent] of this.coreAgents) {
            await this.memoryStore.saveMemories(id, agent.memories, this.sessionId);
        }
        await this.memoryStore.close();
    }
}

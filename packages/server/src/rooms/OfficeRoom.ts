import { Room, Client } from 'colyseus';
import { OfficeState } from '../schema/OfficeState';
import { Agent, Office, OfficeConfig, ConversationMessage } from '@agent-office/core';
import { OllamaAdapter } from '@agent-office/adapters';
import { ToolExecutor } from '../tools/ToolExecutor';
import { MemoryStore } from '../memory/MemoryStore';

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

    maxClients = 100;
    private office!: Office;
    private demoTickCount = 0;
    private coreAgents: Map<string, Agent> = new Map();
    private thinkingLocks: Map<string, boolean> = new Map();
    private ollamaAdapter = new OllamaAdapter('http://localhost:11434');
    private hireCount = 0; // Counter for generating unique IDs
    private toolExecutor = new ToolExecutor();
    private memoryStore = new MemoryStore();
    private sessionId = `session_${Date.now()}`;
    private currentScenario = 'Free Play';
    private highlights: HighlightEvent[] = [];
    private chaosHistory: Array<{ event: string; label: string; time: string }> = [];
    private relationships: Map<string, RelationshipEdge> = new Map();
    private audienceVotes: Record<string, number> = {};
    private currentLayout: any[] = [];
    private approvals: Map<string, ApprovalRequest> = new Map();
    private meetingActive = false;
    private meetingEndsAt = 0;
    private meetingTopic = '';

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
        'ceo-desk':         { x: 32, y: 30, type: 'desk' },
        'ceo-office-wall-1':{ x: 28, y: 27, type: 'wall' },
        'ceo-office-wall-2':{ x: 28, y: 33, type: 'wall' },
        'ceo-office-door':  { x: 28, y: 30, type: 'door' },

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
    };

    static getActiveRoom(): OfficeRoom | null {
        return OfficeRoom.activeRoom;
    }

    async onCreate(options: any) {
        OfficeRoom.activeRoom = this;
        this.setState(new OfficeState());

        // Initialize memory store
        await this.memoryStore.initialize();

        const config: OfficeConfig = {
            name: options.name || 'Startup HQ',
            grid: { width: 40, height: 40, tileSize: 16 },
            rooms: [],
            furniture: [],
            spawnPoints: [{ x: 10, y: 10 }],
            zones: []
        };
        this.office = new Office(config);

        // Setup Core Agents with AI capabilities
        type Traits = { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number };
        type Capability = { name: string; description: string };
        const setupCoreAgent = async (
            id: string,
            name: string,
            role: string,
            x: number,
            y: number,
            systemPrompt: string,
            personality: {
                traits: Traits;
                communicationStyle: 'technical' | 'casual' | 'creative' | 'formal';
            },
            capabilities: Capability[],
            model: string = 'llama3.2:latest'
        ) => {
            this.state.createAgent(id, name);
            const state = this.state.agents.get(id);
            if (state) { state.x = x; state.y = y; }

            const coreAgent = new Agent({
                id, name, role, avatar: 'sprite.png',
                inference: {
                    provider: 'ollama',
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

            coreAgent.setInferenceAdapter(this.ollamaAdapter);
            await coreAgent.initialize();

            // Load persistent memories from previous sessions
            const previousMemories = await this.memoryStore.loadMemories(id, 20);
            if (previousMemories.length > 0) {
                coreAgent.loadMemories(previousMemories);
                console.log(`[${name}] Loaded ${previousMemories.length} memories from previous sessions`);
            }

            this.coreAgents.set(id, coreAgent);
            this.thinkingLocks.set(id, false);
        };

        // ─── SHARED CAPABILITY SETS ───
        // Read-only: can inspect files and search, nothing writes or executes
        const READ_ONLY: Capability[] = [
            { name: 'read_file',   description: 'Read a file from the workspace' },
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
            'frontend', 'Frontend Dev', 'Frontend Developer', 5, 10,
            `${COLLAB} Your focus: modern UI, UX clarity, conversion, and front-end implementation. Paired buddy: Backend Architect — sync with them before API shape changes.`,
            { traits: { openness: 0.9, conscientiousness: 0.8, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'creative' },
            BUILDER
        );

        await setupCoreAgent(
            'backend', 'Backend Architect', 'Backend Architect', 8, 10,
            `${COLLAB} Your focus: APIs, architecture, integrations, maintainability. Paired buddy: Frontend Dev — confirm contracts with them. Pull in DevOps for anything deploy-shaped.`,
            { traits: { openness: 0.8, conscientiousness: 0.95, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.1 }, communicationStyle: 'technical' },
            BUILDER
        );

        await setupCoreAgent(
            'devops', 'DevOps Automator', 'DevOps Automator', 5, 14,
            `${COLLAB} Your focus: deployment, Docker, scripts, infra safety, repeatable automation. Paired buddy: Security Engineer — always review risky infra with them. Deploys are MAJOR and need CEO approval.`,
            { traits: { openness: 0.8, conscientiousness: 0.95, extraversion: 0.5, agreeableness: 0.6, neuroticism: 0.15 }, communicationStyle: 'technical' },
            BUILDER
        );

        await setupCoreAgent(
            'security', 'Security Eng', 'Security Engineer', 8, 14,
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
            'shepherd', 'Project Shepherd', 'Project Shepherd', 17, 10,
            `${COLLAB} Your focus: planning, routing, coordination, keeping work moving. Paired buddy: Reality Checker — pressure-test plans with them. Major reprioritization needs CEO approval.`,
            { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.8, agreeableness: 0.8, neuroticism: 0.15 }, communicationStyle: 'formal' },
            COORDINATOR
        );

        await setupCoreAgent(
            'reality', 'Reality Checker', 'Reality Checker', 20, 10,
            `${COLLAB} Your focus: challenge weak ideas, highlight risks, ask "is this really ready?". Paired buddy: Project Shepherd. Be direct but constructive.`,
            { traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.4, neuroticism: 0.25 }, communicationStyle: 'technical' },
            READ_ONLY
        );

        await setupCoreAgent(
            'evidence', 'Evidence Collector', 'Evidence Collector', 17, 14,
            `${COLLAB} Your focus: proof, validation, screenshots, logs, QA evidence. Paired buddy: SEO Specialist — share validation evidence with them for page launches.`,
            { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.4, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'technical' },
            READ_ONLY
        );

        await setupCoreAgent(
            'seo', 'SEO Specialist', 'SEO Specialist', 20, 14,
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
            'sales', 'Sales Outreach', 'Sales Outreach', 29, 10,
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
            'proposal', 'Proposal Strategist', 'Proposal Strategist', 32, 10,
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
            'ceo', 'Faz (CEO)', 'CEO', 32, 30,
            `You are Faz, CEO and founder of Xylon Devs. You work from a private office (bottom-right). You provide strategic oversight, final approval on MAJOR decisions, and protect quality. Stay high-level — do not micromanage. When an approval request comes in, evaluate rationale: approve if sound, reject if weak or risky, ask for revision if info is thin. Enforce evidence quality: for volatile topics (news, pricing, specs, policies, releases, outages), require recent sources, require source URLs in findings, and reject stale cached assumptions. Be concise and direct.`,
            { traits: { openness: 0.85, conscientiousness: 0.9, extraversion: 0.7, agreeableness: 0.6, neuroticism: 0.15 }, communicationStyle: 'formal' },
            COORDINATOR,
            process.env.CEO_MODEL || 'llama3.1:70b'
        );

        this.rebuildRelationshipGraph();
        const savedLayout = await this.memoryStore.loadLayout('default');
        this.currentLayout = Array.isArray(savedLayout) ? savedLayout : [];

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
            console.log(`Chat from ${client.sessionId}: ${text}`);
            this.broadcast('chat', { sender: 'User', text });

            // Slash-command router — reliable, parse-first.
            if (text.startsWith('/')) {
                const handled = this.handleSlashCommand(text);
                if (handled) return;
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
        this.onMessage('assign-task', (client, message) => {
            const { title, agentId } = message;
            console.log(`[TaskBoard] Assigning "${title}" to ${agentId || 'auto'}`);

            // Pick agent: explicit or auto-assign to least busy
            const targetId = agentId || this.autoAssignAgent();
            const agent = this.coreAgents.get(targetId);
            const agentState = this.state.agents.get(targetId);

            if (agent && agentState) {
                agent.currentTask = title;
                agentState.currentTask = title;
                agentState.action = 'work';

                // Persist task
                this.memoryStore.createTask(title, targetId);

                this.broadcast('chat', {
                    sender: 'System',
                    text: `📋 Task "${title}" assigned to ${agentState.name}`
                });

                this.broadcast('task-update', {
                    agentId: targetId,
                    agentName: agentState.name,
                    task: title,
                    status: 'in_progress'
                });
            }
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

        // Save office layout from editor
        this.onMessage('save-layout', async (client, message) => {
            const layoutName = message.name || 'default';
            const layout = Array.isArray(message.layout) ? message.layout : [];
            await this.memoryStore.saveLayout(layoutName, JSON.stringify(layout));
            this.currentLayout = layout;
            this.broadcast('layout-sync', { name: layoutName, layout: this.currentLayout });
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

                coreAgent.think({
                    time: this.state.officeTime,
                    location: `${agentState.x},${agentState.y}`,
                    nearbyAgents,
                    currentTask: coreAgent.currentTask || null,
                    recentMessages: coreAgent.getUnreadMessages(),
                    memories: coreAgent.getRecentMemories(5)
                }).then(async (decision) => {
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
                                await this.memoryStore.createTask(title, targetId);

                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `📋 Created task "${title}" for ${targetAgent.config.name}`
                                });
                                this.broadcast('task-update', {
                                    agentId: targetId,
                                    agentName: targetAgent.config.name,
                                    task: title,
                                    status: 'in_progress'
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
                                const hireState = this.state.agents.get(hireId);
                                if (hireState) { hireState.x = spawnX; hireState.y = spawnY; }

                                const hireAgent = new Agent({
                                    id: hireId, name: hireName, role: hireRole, avatar: 'sprite.png',
                                    inference: {
                                        provider: 'ollama',
                                        model: 'llama3.2:latest',
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

                                hireAgent.setInferenceAdapter(this.ollamaAdapter);
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
                        } else if (id !== 'ceo' && this.isMajorToolCall(decision.toolCall.name, decision.toolCall.params)) {
                            // ─── MAJOR ACTION → CEO APPROVAL GATE ───
                            this.createApproval({
                                requestedBy: id,
                                requestedByName: coreAgent.config.name,
                                requestedAction: `${decision.toolCall.name}`,
                                rationale: decision.thought || 'No rationale provided — please supply more context.',
                                isMajor: true,
                                pending: { toolName: decision.toolCall.name, params: decision.toolCall.params },
                            });
                        } else {
                            const result = await this.toolExecutor.execute(
                                decision.toolCall.name,
                                decision.toolCall.params
                            );

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

                    // ─── PERSIST MEMORIES PERIODICALLY ───
                    if (Math.random() < 0.3) {
                        const recentMemories = coreAgent.memories.slice(-3);
                        await this.memoryStore.saveMemories(id, recentMemories, this.sessionId);
                    }

                    setTimeout(() => this.thinkingLocks.set(id, false), 15000);

                }).catch(err => {
                    console.error(`Agent ${id} think error:`, err);
                    setTimeout(() => this.thinkingLocks.set(id, false), 15000);
                });
            }
        });

        // ─── FURNITURE INTERACTION PATHFINDING ───
        // Office grid boundaries (agents must stay inside)
        const BOUNDS = { minX: 2, maxX: 36, minY: 2, maxY: 36 };
        const clamp = (agent: any) => {
            agent.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, agent.x));
            agent.y = Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, agent.y));
        };

        this.demoTickCount++;
        if (this.demoTickCount >= 5) {
            this.demoTickCount = 0;
            // Auto-end meeting when its duration expires
            if (this.meetingActive && Date.now() > this.meetingEndsAt) {
                this.endMeeting();
            }

            this.state.agents.forEach((agent, key) => {
                // Default targets: agent's own desk chair
                const deskKey = `${key}-desk`;
                let target = this.furnitureTargets[deskKey] || { x: 5, y: 18 };

                // During a meeting, everyone (except CEO who stays in their office
                // but attends virtually) gathers near the meeting table.
                if (this.meetingActive && key !== 'ceo') {
                    const table = this.furnitureTargets['meeting-table'];
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
                if (agent.action === 'talk') {
                    let closest: { x: number; y: number } | null = null;
                    let minDist = Infinity;
                    this.state.agents.forEach((other, otherKey) => {
                        if (otherKey === key) return;
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
            this.memoryStore.createTask(task, agentId).catch(() => {});
            this.broadcast('chat', {
                sender: '🏢 Office',
                text: `📌 CEO assigned "${task}" → ${agent.config.name}`
            });
            this.broadcast('task-update', {
                agentId, agentName: agent.config.name, task, status: 'in_progress'
            });
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

        // Structured project scenarios that actually route work across the whole agency
        const normalized = scenarioName.toLowerCase();
        if (normalized.includes('xylon growth sprint') || normalized.includes('acme')) {
            this.kickoffXylonGrowthSprint();
        }
    }

    // ─── REAL-WORLD PROJECT: XYLON GROWTH SPRINT (ACME MANUFACTURING) ───
    //
    // This scenario forces the whole agency to collaborate. The CEO is the gate
    // on pricing and launch. Each agent gets a specific brief that references
    // the others', so they must consult their paired buddy and cross-pod peers.
    //
    // Real business value mirror: Xylon Devs sells exactly this — a Microsoft 365
    // Copilot rollout with oversharing remediation, a landing page to capture
    // the lead, and a Statement of Work. Running this scenario exercises the
    // exact muscles the real company uses to win work.
    private kickoffXylonGrowthSprint() {
        const project = 'ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW';
        const brief = [
            `NEW PROJECT: ${project}.`,
            `Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3).`,
            `Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive.`,
            `Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan,`,
            ` (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API,`,
            ` (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks.`,
            `Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing,`,
            ` deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand.`,
        ].join(' ');

        this.broadcast('chat', {
            sender: '📣 Project Kickoff',
            text: `🚀 ${project}. Everyone has a specific brief in their inbox — check it, then start executing.`
        });
        this.emitHighlight('scenario', 'Xylon Growth Sprint kicked off', project, 'shepherd');

        const assignments: Array<{
            id: string;
            task: string;
            inbox: string;
        }> = [
            {
                id: 'shepherd',
                task: 'Coordinate ACME sprint: break work into milestones, route to specialists, track blockers',
                inbox: `${brief} You are the coordinator. Produce a milestone plan (Discovery → Research → Design → Build → Security review → QA → CEO gate → Launch), create tasks for each specialist via create_task, and chase blockers. Pair with Reality Checker to pressure-test the plan before assigning.`,
            },
            {
                id: 'reality',
                task: 'Pressure-test the ACME plan and every deliverable as they arrive',
                inbox: `${brief} Your job: challenge scope creep, thin rationale, and "is this really launch-ready?" checks. Pair with Project Shepherd on the milestone plan. Read xylondevs.com and flag any claim in the SOW we cannot back up with the current site.`,
            },
            {
                id: 'sales',
                task: 'Research ACME, qualify the opportunity, write outreach, brief Proposal Strategist',
                inbox: `${brief} Use web_search to research ACME Manufacturing (AU manufacturing sector, M365 adoption, Copilot pilots). Use fetch_url on xylondevs.com to match our positioning. Draft a 120-word outbound email and a 3-line LinkedIn opener. When qualified, brief Proposal Strategist with BANT/MEDDIC-lite notes. DO NOT commit pricing — that is the CEO's call.`,
            },
            {
                id: 'proposal',
                task: 'Draft the Statement of Work with 3 pricing tiers (Good/Better/Best) — pricing is MAJOR',
                inbox: `${brief} Build the 10-part SOW. Pair with Sales Outreach for qualification inputs, Security for the remediation scope, DevOps for deploy effort, and Frontend for landing-page scope. Write the SOW via write_file to data/workspace/acme-sow.md. Propose Good/Better/Best pricing but REQUEST CEO APPROVAL before finalising numbers or sending to client. Also read xylondevs.com to mirror tone.`,
            },
            {
                id: 'seo',
                task: 'Audit xylondevs.com and propose keyword/meta plan for /copilot-rollout landing page',
                inbox: `${brief} fetch_url https://xylondevs.com and audit: title tags, H1s, meta description, internal linking, any existing Copilot/AI content. web_search for Australian buyer-intent keywords around "Microsoft Copilot rollout", "Copilot oversharing", "Purview restricted SharePoint search". Hand the keyword + metadata brief to Frontend Dev. Pair with Evidence Collector so they can verify the new page ranks the right terms.`,
            },
            {
                id: 'frontend',
                task: 'Build landing page mockup at data/workspace/copilot-rollout-landing.html',
                inbox: `${brief} fetch_url https://xylondevs.com to match the current brand look. Take SEO's keyword+metadata brief and Proposal's scope. write_file an HTML landing page to data/workspace/copilot-rollout-landing.html with hero, pain statement, 3-tier pricing placeholder, intake form pointing at Backend Architect's API, and a clear CTA. Pair with Backend Architect on the form fields.`,
            },
            {
                id: 'backend',
                task: 'Design intake form API contract for the landing page',
                inbox: `${brief} Design a minimal POST /api/leads endpoint: fields (company, contact, email, staff_count, current_m365_plan, message, utm_source). Return 202 + lead id. Define validation + rate limiting. write_note the contract and share with Frontend Dev. Loop in Security Engineer for auth + Purview-aligned data handling.`,
            },
            {
                id: 'devops',
                task: 'Propose a safe deploy plan for the landing page + API — deploy is MAJOR',
                inbox: `${brief} Draft a deploy plan: static hosting for the landing page, containerised API, env vars, rollback plan, DNS for xylondevs.com/copilot-rollout. The actual deploy is MAJOR — do not execute it. File an approval request to the CEO with rationale (why now, rollback, blast radius). Pair with Security for any secret handling.`,
            },
            {
                id: 'security',
                task: 'Write the Copilot oversharing remediation plan for the ACME SOW',
                inbox: `${brief} This is the centrepiece. Produce a concrete remediation plan ACME can adopt pre-Copilot rollout: (1) SharePoint/OneDrive permission hygiene sweep, (2) sensitivity labels + DLP via Purview, (3) restricted SharePoint search, (4) Copilot semantic index scoping, (5) Entra ID conditional access + PIM, (6) content filtering + prompt logging, (7) audit cadence. Map each to the exact M365 setting. Hand to Proposal Strategist for the SOW. Pair with DevOps on any secrets handling.`,
            },
            {
                id: 'evidence',
                task: 'Capture proof: SOW complete, landing page file exists, API contract noted, site 200 OK',
                inbox: `${brief} Verify each deliverable: read_file data/workspace/acme-sow.md, read_file data/workspace/copilot-rollout-landing.html, check_health https://xylondevs.com and the deploy URL once live. Post an evidence summary in chat before the CEO's final approval. Pair with SEO for post-launch keyword verification.`,
            },
        ];

        for (const a of assignments) {
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
            this.memoryStore.createTask(a.task, a.id).catch(() => {});
            this.broadcast('task-update', {
                agentId: a.id, agentName: agent.config.name, task: a.task, status: 'in_progress'
            });
        }

        // CEO brief (no approval gate, just awareness)
        const ceo = this.coreAgents.get('ceo');
        if (ceo) {
            ceo.receiveMessage({
                from: 'Faz (CEO)',
                to: ceo.config.name,
                content: `You kicked off "${project}". You are the final gate on SOW pricing, the deploy, and the public launch. Watch the approval queue. Stay strategic — do not micromanage. Ask for rationale if a request is weak.`,
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
                aName: idToName[edge.a] || edge.a,
                bName: idToName[edge.b] || edge.b
            })),
            time: this.state.officeTime
        };
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
        client.send('relationship-update', this.buildRelationshipPayload());
        client.send('layout-sync', { name: 'default', layout: this.currentLayout });
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

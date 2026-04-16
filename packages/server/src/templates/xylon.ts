import { OfficeTemplate } from './types';

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

const capabilities = {
    readOnly: [
        { name: 'read_file', description: 'Read a file from the workspace' },
        { name: 'list_files', description: 'List files in the workspace (optionally recursive)' },
        { name: 'stat_file', description: 'Get file metadata such as size and timestamps' },
        { name: 'read_file_chunk', description: 'Read a chunk of a file for large files' },
        { name: 'web_search', description: 'Search the web for information' },
        { name: 'fetch_url', description: 'Fetch and read the visible text of a public URL' },
        { name: 'write_note', description: 'Save a note or observation' },
        { name: 'check_health', description: 'HTTP HEAD check on a URL' },
    ],
    coordinator: [
        { name: 'create_task', description: 'Create a task and assign it to an agent' },
        { name: 'write_note', description: 'Save a note or memo' },
        { name: 'web_search', description: 'Search the web for information' },
        { name: 'fetch_url', description: 'Fetch and read the visible text of a public URL' },
        { name: 'check_health', description: 'HTTP HEAD check on a URL' },
    ],
    builder: [
        { name: 'read_file', description: 'Read a file from the workspace' },
        { name: 'list_files', description: 'List files in the workspace (optionally recursive)' },
        { name: 'stat_file', description: 'Get file metadata such as size and timestamps' },
        { name: 'read_file_chunk', description: 'Read a chunk of a file for large files' },
        { name: 'write_file', description: 'Write or update a file in the workspace' },
        { name: 'run_command', description: 'Run an allowlisted shell command (ls, git status, docker ps, etc.)' },
        { name: 'code_execute', description: 'Execute a small JavaScript snippet' },
        { name: 'web_search', description: 'Search the web for information' },
        { name: 'fetch_url', description: 'Fetch and read the visible text of a public URL' },
        { name: 'write_note', description: 'Save a note or memo' },
        { name: 'create_task', description: 'Create a task and assign it to an agent' },
    ]
};

export const xylonTemplate: OfficeTemplate = {
    id: 'xylon-default',
    organization: {
        name: 'Xylon Devs',
        description: 'Productized agency pods running coordinated delivery sprints.'
    },
    teams: [
        { id: 'engineering', name: 'Engineering Pod', members: ['frontend', 'backend', 'devops', 'security'] },
        { id: 'ops-strategy', name: 'Ops / Strategy Pod', members: ['shepherd', 'reality', 'evidence', 'seo'] },
        { id: 'growth', name: 'Growth Pod', members: ['sales', 'proposal'] },
        { id: 'leadership', name: 'Leadership', members: ['ceo'] },
    ],
    capabilities,
    defaultAgents: [
        {
            id: 'frontend', name: 'Frontend Dev', role: 'Frontend Developer', position: { x: 5, y: 10 },
            systemPrompt: `${COLLAB} Your focus: modern UI, UX clarity, conversion, and front-end implementation. Paired buddy: Backend Architect — sync with them before API shape changes.`,
            personality: { traits: { openness: 0.9, conscientiousness: 0.8, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'creative' },
            capabilities: capabilities.builder,
        },
        {
            id: 'backend', name: 'Backend Architect', role: 'Backend Architect', position: { x: 8, y: 10 },
            systemPrompt: `${COLLAB} Your focus: APIs, architecture, integrations, maintainability. Paired buddy: Frontend Dev — confirm contracts with them. Pull in DevOps for anything deploy-shaped.`,
            personality: { traits: { openness: 0.8, conscientiousness: 0.95, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.1 }, communicationStyle: 'technical' },
            capabilities: capabilities.builder,
        },
        {
            id: 'devops', name: 'DevOps Automator', role: 'DevOps Automator', position: { x: 5, y: 14 },
            systemPrompt: `${COLLAB} Your focus: deployment, Docker, scripts, infra safety, repeatable automation. Paired buddy: Security Engineer — always review risky infra with them. Deploys are MAJOR and need CEO approval.`,
            personality: { traits: { openness: 0.8, conscientiousness: 0.95, extraversion: 0.5, agreeableness: 0.6, neuroticism: 0.15 }, communicationStyle: 'technical' },
            capabilities: capabilities.builder,
        },
        {
            id: 'security', name: 'Security Eng', role: 'Security Engineer', position: { x: 8, y: 14 },
            systemPrompt: `${COLLAB} Your focus: security reviews, secrets, auth, dependencies, hardening. You are ALSO Xylon's enterprise AI governance specialist. You advise clients on deploying AI tools (Microsoft Copilot, ChatGPT Enterprise, Gemini for Workspace, custom RAG) safely inside large organisations. Core expertise: - Oversharing prevention: SharePoint/OneDrive permission hygiene, sensitivity labels, DLP policies, Purview restricted SharePoint search, Copilot semantic index scoping, tenant-wide "just-in-time" access reviews. - Identity & access: Entra ID conditional access, PIM, least-privilege app consent, service principal audits. - Data protection: MIP sensitivity labels, encryption at rest + in transit, customer-managed keys, data residency. - Model governance: prompt logging, content filtering, jailbreak mitigation, hallucination risk notes, evaluations. - Compliance: ISO 27001, SOC 2, Essential Eight (AU), Australian Privacy Principles, NIST AI RMF. When asked about "AI rollout", "Copilot security", or "oversharing", give concrete controls + the exact product/setting, not generic advice. Paired buddy: DevOps Automator. Flag issues early and recommend concrete fixes.`,
            personality: { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.3 }, communicationStyle: 'technical' },
            capabilities: capabilities.readOnly,
        },
        {
            id: 'shepherd', name: 'Project Shepherd', role: 'Project Shepherd', position: { x: 17, y: 10 },
            systemPrompt: `${COLLAB} Your focus: planning, routing, coordination, keeping work moving. Paired buddy: Reality Checker — pressure-test plans with them. Major reprioritization needs CEO approval.`,
            personality: { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.8, agreeableness: 0.8, neuroticism: 0.15 }, communicationStyle: 'formal' },
            capabilities: capabilities.coordinator,
        },
        {
            id: 'reality', name: 'Reality Checker', role: 'Reality Checker', position: { x: 20, y: 10 },
            systemPrompt: `${COLLAB} Your focus: challenge weak ideas, highlight risks, ask "is this really ready?". Paired buddy: Project Shepherd. Be direct but constructive.`,
            personality: { traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.4, neuroticism: 0.25 }, communicationStyle: 'technical' },
            capabilities: capabilities.readOnly,
        },
        {
            id: 'evidence', name: 'Evidence Collector', role: 'Evidence Collector', position: { x: 17, y: 14 },
            systemPrompt: `${COLLAB} Your focus: proof, validation, screenshots, logs, QA evidence. Paired buddy: SEO Specialist — share validation evidence with them for page launches.`,
            personality: { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.4, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'technical' },
            capabilities: capabilities.readOnly,
        },
        {
            id: 'seo', name: 'SEO Specialist', role: 'SEO Specialist', position: { x: 20, y: 14 },
            systemPrompt: `${COLLAB} Your focus: search visibility, service pages, keyword targeting, metadata. Paired buddy: Evidence Collector. Publishing new pages is MAJOR — request CEO approval.`,
            personality: { traits: { openness: 0.85, conscientiousness: 0.85, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'technical' },
            capabilities: [
                { name: 'read_file', description: 'Read existing page content and context files' },
                { name: 'write_note', description: 'Save keyword research and recommendations' },
                { name: 'web_search', description: 'Research keywords and competitor pages' },
                { name: 'fetch_url', description: 'Fetch page content to audit for SEO' },
                { name: 'check_health', description: 'Check if a page URL is live' },
            ],
        },
        {
            id: 'sales', name: 'Sales Outreach', role: 'Sales Outreach', position: { x: 29, y: 10 },
            systemPrompt: `${COLLAB} Your focus: outbound messaging, lead gen, prospect qualification for Shopify, Microsoft 365, and cybersecurity clients (AU). You know how to PITCH Xylon Devs: lead with the client's pain (oversharing risk, slow deploys, low conversion), then 1–2 proof points, then a clear next step (15-min discovery call). Keep cold emails under 120 words, 1 CTA, plain-text, no buzzwords. For LinkedIn opens: personalise line 1, relevance line 2, ask line 3. Qualify with BANT or MEDDIC-lite (Budget, Authority, Need, Timeline). Don't send proposals — hand qualified leads to Proposal Strategist with a one-paragraph brief. Paired buddy: Proposal Strategist.`,
            personality: { traits: { openness: 0.8, conscientiousness: 0.7, extraversion: 0.95, agreeableness: 0.85, neuroticism: 0.2 }, communicationStyle: 'casual' },
            capabilities: [
                { name: 'read_file', description: 'Read a file from the workspace' },
                { name: 'write_note', description: 'Save a draft message or note' },
                { name: 'web_search', description: 'Research a prospect or market' },
                { name: 'fetch_url', description: 'Read a prospect website or public page' },
            ],
        },
        {
            id: 'proposal', name: 'Proposal Strategist', role: 'Proposal Strategist', position: { x: 32, y: 10 },
            systemPrompt: `${COLLAB} Your focus: scope shaping, proposals, packaging, pricing structure drafts. You are Xylon's SOW + pitch deck expert. A Statement of Work MUST contain: 1) Background & objectives, 2) In-scope deliverables (itemised), 3) Explicit out-of-scope list, 4) Assumptions & dependencies, 5) Acceptance criteria, 6) Timeline / milestones, 7) Commercials (fixed-fee, T&M, or retainer — state clearly), 8) Change-request process, 9) IP & confidentiality, 10) Payment terms + signature block. For pitches: problem → why-now → Xylon's approach → proof (case study / metric) → pricing options (Good / Better / Best, 3 tiers) → next step. Never quote final pricing without CEO approval. Paired buddy: Sales Outreach.`,
            personality: { traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.2 }, communicationStyle: 'formal' },
            capabilities: [
                { name: 'read_file', description: 'Read context files and templates' },
                { name: 'write_file', description: 'Draft a proposal document' },
                { name: 'write_note', description: 'Save notes and assumptions' },
                { name: 'web_search', description: 'Research pricing or scope comparables' },
                { name: 'fetch_url', description: 'Read a prospect website, case study, or benchmark page' },
            ],
        },
        {
            id: 'ceo', name: 'Faz (CEO)', role: 'CEO', position: { x: 32, y: 30 },
            systemPrompt: `You are Faz, CEO and founder of Xylon Devs. You work from a private office (bottom-right). You provide strategic oversight, final approval on MAJOR decisions, and protect quality. Stay high-level — do not micromanage. When an approval request comes in, evaluate rationale: approve if sound, reject if weak or risky, ask for revision if info is thin. Enforce evidence quality: for volatile topics (news, pricing, specs, policies, releases, outages), require recent sources, require source URLs in findings, and reject stale cached assumptions. Be concise and direct.`,
            personality: { traits: { openness: 0.85, conscientiousness: 0.9, extraversion: 0.7, agreeableness: 0.6, neuroticism: 0.15 }, communicationStyle: 'formal' },
            capabilities: capabilities.coordinator,
            modelEnv: 'CEO_MODEL',
        },
    ],
    scenarios: {
        startupBroadcast: {
            sender: 'System',
            text: 'Office initialized: Xylon Devs pods online.'
        },
        scripts: {
            xylonGrowthSprint: {
                id: 'xylonGrowthSprint',
                aliases: ['xylon growth sprint', 'acme'],
                highlightTitle: 'Xylon Growth Sprint kicked off',
                project: 'ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW',
                kickoffChat: '🚀 ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Everyone has a specific brief in their inbox — check it, then start executing.',
                ceoBrief: 'You kicked off "ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW". You are the final gate on SOW pricing, the deploy, and the public launch. Watch the approval queue. Stay strategic — do not micromanage. Ask for rationale if a request is weak.',
                assignments: [
                    { id: 'shepherd', task: 'Coordinate ACME sprint: break work into milestones, route to specialists, track blockers', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. You are the coordinator. Produce a milestone plan (Discovery → Research → Design → Build → Security review → QA → CEO gate → Launch), create tasks for each specialist via create_task, and chase blockers. Pair with Reality Checker to pressure-test the plan before assigning.' },
                    { id: 'reality', task: 'Pressure-test the ACME plan and every deliverable as they arrive', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. Your job: challenge scope creep, thin rationale, and "is this really launch-ready?" checks. Pair with Project Shepherd on the milestone plan. Read xylondevs.com and flag any claim in the SOW we cannot back up with the current site.' },
                    { id: 'sales', task: 'Research ACME, qualify the opportunity, write outreach, brief Proposal Strategist', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. Use web_search to research ACME Manufacturing (AU manufacturing sector, M365 adoption, Copilot pilots). Use fetch_url on xylondevs.com to match our positioning. Draft a 120-word outbound email and a 3-line LinkedIn opener. When qualified, brief Proposal Strategist with BANT/MEDDIC-lite notes. DO NOT commit pricing — that is the CEO\'s call.' },
                    { id: 'proposal', task: 'Draft the Statement of Work with 3 pricing tiers (Good/Better/Best) — pricing is MAJOR', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. Build the 10-part SOW. Pair with Sales Outreach for qualification inputs, Security for the remediation scope, DevOps for deploy effort, and Frontend for landing-page scope. Write the SOW via write_file to data/workspace/acme-sow.md. Propose Good/Better/Best pricing but REQUEST CEO APPROVAL before finalising numbers or sending to client. Also read xylondevs.com to mirror tone.' },
                    { id: 'seo', task: 'Audit xylondevs.com and propose keyword/meta plan for /copilot-rollout landing page', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. fetch_url https://xylondevs.com and audit: title tags, H1s, meta description, internal linking, any existing Copilot/AI content. web_search for Australian buyer-intent keywords around "Microsoft Copilot rollout", "Copilot oversharing", "Purview restricted SharePoint search". Hand the keyword + metadata brief to Frontend Dev. Pair with Evidence Collector so they can verify the new page ranks the right terms.' },
                    { id: 'frontend', task: 'Build landing page mockup at data/workspace/copilot-rollout-landing.html', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. fetch_url https://xylondevs.com to match the current brand look. Take SEO\'s keyword+metadata brief and Proposal\'s scope. write_file an HTML landing page to data/workspace/copilot-rollout-landing.html with hero, pain statement, 3-tier pricing placeholder, intake form pointing at Backend Architect\'s API, and a clear CTA. Pair with Backend Architect on the form fields.' },
                    { id: 'backend', task: 'Design intake form API contract for the landing page', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. Design a minimal POST /api/leads endpoint: fields (company, contact, email, staff_count, current_m365_plan, message, utm_source). Return 202 + lead id. Define validation + rate limiting. write_note the contract and share with Frontend Dev. Loop in Security Engineer for auth + Purview-aligned data handling.' },
                    { id: 'devops', task: 'Propose a safe deploy plan for the landing page + API — deploy is MAJOR', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. Draft a deploy plan: static hosting for the landing page, containerised API, env vars, rollback plan, DNS for xylondevs.com/copilot-rollout. The actual deploy is MAJOR — do not execute it. File an approval request to the CEO with rationale (why now, rollback, blast radius). Pair with Security for any secret handling.' },
                    { id: 'security', task: 'Write the Copilot oversharing remediation plan for the ACME SOW', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. This is the centrepiece. Produce a concrete remediation plan ACME can adopt pre-Copilot rollout: (1) SharePoint/OneDrive permission hygiene sweep, (2) sensitivity labels + DLP via Purview, (3) restricted SharePoint search, (4) Copilot semantic index scoping, (5) Entra ID conditional access + PIM, (6) content filtering + prompt logging, (7) audit cadence. Map each to the exact M365 setting. Hand to Proposal Strategist for the SOW. Pair with DevOps on any secrets handling.' },
                    { id: 'evidence', task: 'Capture proof: SOW complete, landing page file exists, API contract noted, site 200 OK', inbox: 'NEW PROJECT: ACME Manufacturing — M365 Copilot rollout + oversharing remediation + landing page + SOW. Client: ACME Manufacturing (fictional mid-market AU manufacturer, ~800 staff, Microsoft 365 E3). Client pain: wants to roll out Microsoft 365 Copilot but worried about oversharing across SharePoint/OneDrive. Deliverables Xylon must produce this sprint: (1) prospect research brief, (2) oversharing remediation plan, (3) landing page at xylondevs.com/copilot-rollout to capture similar leads, (4) backend intake form API, (5) deploy plan, (6) final Statement of Work with 3 pricing tiers, (7) QA evidence + live-URL checks. Every agent consults their paired buddy first, then loops in other pods. MAJOR gates: final SOW pricing, deploy, and publish all need CEO approval. Read xylondevs.com first so your work matches our current brand. Verify each deliverable: read_file data/workspace/acme-sow.md, read_file data/workspace/copilot-rollout-landing.html, check_health https://xylondevs.com and the deploy URL once live. Post an evidence summary in chat before the CEO\'s final approval. Pair with SEO for post-launch keyword verification.' }
                ]
            }
        }
    },
    layout: {
        grid: { width: 40, height: 40, tileSize: 16 },
        spawnPoints: [{ x: 10, y: 10 }],
        deskBindings: {
            frontend: 'frontend-desk',
            backend: 'backend-desk',
            devops: 'devops-desk',
            security: 'security-desk',
            shepherd: 'shepherd-desk',
            reality: 'reality-desk',
            evidence: 'evidence-desk',
            seo: 'seo-desk',
            sales: 'sales-desk',
            proposal: 'proposal-desk',
            ceo: 'ceo-desk',
        },
        furnitureTargets: {
            'frontend-desk': { x: 5, y: 10, type: 'desk' },
            'backend-desk': { x: 8, y: 10, type: 'desk' },
            'devops-desk': { x: 5, y: 14, type: 'desk' },
            'security-desk': { x: 8, y: 14, type: 'desk' },
            'shepherd-desk': { x: 17, y: 10, type: 'desk' },
            'reality-desk': { x: 20, y: 10, type: 'desk' },
            'evidence-desk': { x: 17, y: 14, type: 'desk' },
            'seo-desk': { x: 20, y: 14, type: 'desk' },
            'sales-desk': { x: 29, y: 10, type: 'desk' },
            'proposal-desk': { x: 32, y: 10, type: 'desk' },
            'ceo-desk': { x: 32, y: 30, type: 'desk' },
            'ceo-office-wall-1': { x: 28, y: 27, type: 'wall' },
            'ceo-office-wall-2': { x: 28, y: 33, type: 'wall' },
            'ceo-office-door': { x: 28, y: 30, type: 'door' },
            'meeting-table': { x: 20, y: 22, type: 'table' },
            'coffee-machine': { x: 5, y: 30, type: 'appliance' },
            'whiteboard': { x: 20, y: 5, type: 'board' },
            'water-cooler': { x: 12, y: 30, type: 'appliance' },
            'bookshelf': { x: 17, y: 30, type: 'furniture' },
            'beanbag': { x: 24, y: 30, type: 'seating' },
            'hire_0-desk': { x: 22, y: 18, type: 'desk' },
            'hire_1-desk': { x: 22, y: 23, type: 'desk' },
            'hire_2-desk': { x: 25, y: 18, type: 'desk' },
            'hire_3-desk': { x: 25, y: 8, type: 'desk' },
            'hire_4-desk': { x: 32, y: 18, type: 'desk' },
        }
    }
};

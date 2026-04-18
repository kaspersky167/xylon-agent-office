import express from 'express';
import { Server } from 'colyseus';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { readdir, stat, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { ArtifactStatus, MemoryStore } from './memory/MemoryStore';
import { OfficeRoom } from './rooms/OfficeRoom';
import { ExtensionRegistry } from './extensions/registry';
import { ProjectWorkspace } from './projects/ProjectWorkspace';
import {
    getActiveProject,
    getActiveWorkspaceRoot,
    getGlobalWorkspaceRoot,
    resolveScopedPath
} from './projects/workspacePaths';

// Setup Express
const app = express();
app.use(express.json());
const memoryStore = new MemoryStore();

// Basic REST API for Office Management
app.get('/api/offices', (req, res) => {
    res.json({ status: 'ok', offices: [] });
});

app.post('/api/vote-chaos', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (!room) {
        res.status(503).json({ ok: false, error: 'No active office room.' });
        return;
    }
    const { event, voterId } = req.body || {};
    const result = room.registerAudienceVote(event || 'server_outage', voterId);
    res.json({ ok: true, ...result });
});

app.get('/api/episode-recap', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (!room) {
        res.status(503).json({ ok: false, error: 'No active office room.' });
        return;
    }
    res.json({ ok: true, recap: room.getEpisodeRecap() });
});

const EXTENSION_TO_MIME: Record<string, string> = {
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

const resolveWorkspacePath = (targetPath: string): string => {
    return resolveScopedPath(getActiveWorkspaceRoot(), targetPath);
};

const guessMimeType = (filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_MIME[ext] || 'application/octet-stream';
};

const parseArtifactPath = (relativePath: string): {
    projectId: string;
    approved: boolean;
} => {
    const activeProject = getActiveProject();
    const normalized = relativePath.split(path.sep).join('/');
    const match = normalized.match(/^projects\/([^/]+)\/([^/]+)\//);
    if (!match) {
        const directSubfolderMatch = normalized.match(/^([^/]+)\//);
        const subfolder = directSubfolderMatch?.[1] || '';
        return {
            projectId: activeProject?.projectSlug || 'unscoped',
            approved: ['artifacts', 'uploads', 'generated', 'outputs', 'completed-work'].includes(subfolder)
        };
    }
    const subfolder = match[2];
    return {
        projectId: match[1],
        approved: ['artifacts', 'uploads', 'generated', 'outputs', 'completed-work'].includes(subfolder)
    };
};

const upsertArtifactFromPath = async (relativePath: string, context?: {
    taskId?: string;
    agentId?: string;
    status?: ArtifactStatus;
    checksum?: string;
}) => {
    const fullPath = resolveWorkspacePath(relativePath);
    let exists = false;
    let sizeBytes = 0;
    try {
        const fileStats = await stat(fullPath);
        exists = fileStats.isFile();
        sizeBytes = fileStats.size;
    } catch {
        exists = false;
    }
    const parsed = parseArtifactPath(relativePath);
    const status: ArtifactStatus = context?.status || (parsed.approved && exists ? 'validated' : 'rejected');
    await memoryStore.upsertArtifact({
        id: randomUUID(),
        projectId: parsed.projectId,
        taskId: context?.taskId || null,
        agentId: context?.agentId || null,
        relativePath: relativePath.split(path.sep).join('/'),
        mimeType: guessMimeType(relativePath),
        sizeBytes,
        status,
        checksum: context?.checksum || null,
        existsOnDisk: exists
    });
};

const listWorkspaceFiles = async (rootDir: string, maxFiles = 200) => {
    const files: Array<{ path: string; name: string; size: number; mimeType: string; createdAt: string }> = [];
    const walk = async (dir: string) => {
        if (files.length >= maxFiles) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (files.length >= maxFiles) return;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile()) {
                const stats = await stat(fullPath);
                const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
                files.push({
                    path: relativePath,
                    name: entry.name,
                    size: stats.size,
                    mimeType: guessMimeType(entry.name),
                    createdAt: stats.birthtime.toISOString()
                });
            }
        }
    };
    await walk(rootDir);
    return files.sort((a, b) => a.path.localeCompare(b.path));
};

app.get('/api/workspace-files', async (_req, res) => {
    try {
        const workspaceRoot = getActiveWorkspaceRoot();
        await mkdir(workspaceRoot, { recursive: true });
        const files = await listWorkspaceFiles(workspaceRoot);
        res.json({ ok: true, root: workspaceRoot, project: getActiveProject(), files });
    } catch (error) {
        console.error('[workspace-files] Failed to list files', error);
        res.status(500).json({ ok: false, error: 'Unable to list workspace files.' });
    }
});

app.get('/api/completed-work', async (_req, res) => {
    try {
        const workspaceRoot = getActiveWorkspaceRoot();
        await mkdir(path.join(workspaceRoot, 'completed-work'), { recursive: true });
        const files = await listWorkspaceFiles(path.join(workspaceRoot, 'completed-work'));
        res.json({
            ok: true,
            folder: `${workspaceRoot}/completed-work`,
            files
        });
    } catch (error) {
        console.error('[completed-work] Failed to list files', error);
        res.status(500).json({ ok: false, error: 'Unable to list completed work files.' });
    }
});

app.post('/api/projects/start', async (req, res) => {
    try {
        const project = await ProjectWorkspace.startProject({
            templateId: req.body?.templateId ?? req.body?.template,
            projectName: req.body?.projectName,
            brief: req.body?.brief,
            acceptanceCriteria: req.body?.acceptanceCriteria,
            constraints: req.body?.constraints,
            mode: req.body?.mode,
            runMetadata: {
                requestedBy: req.body?.requestedBy || 'api',
                source: 'rest',
                globalWorkspaceRoot: getGlobalWorkspaceRoot()
            }
        });
        res.status(201).json({ ok: true, ...project });
    } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || 'Unable to start project.' });
    }
});

app.post('/api/workspace-files/save', async (req, res) => {
    try {
        const targetPath = String(req.body?.path || '').trim();
        const content = typeof req.body?.content === 'string' ? req.body.content : '';
        const fullPath = resolveWorkspacePath(targetPath);
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, 'utf-8');
        await upsertArtifactFromPath(targetPath, {
            taskId: typeof req.body?.taskId === 'string' ? req.body.taskId : undefined,
            agentId: typeof req.body?.agentId === 'string' ? req.body.agentId : 'user',
            status: 'draft'
        });
        res.json({ ok: true, path: targetPath });
    } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || 'Unable to save workspace file.' });
    }
});

app.post('/api/workspace-files/upload', async (req, res) => {
    try {
        const targetPath = String(req.body?.path || '').trim();
        const base64 = String(req.body?.base64 || '');
        const fullPath = resolveWorkspacePath(targetPath);
        const normalized = base64.includes(',') ? base64.split(',').pop() as string : base64;
        const buffer = Buffer.from(normalized, 'base64');
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, buffer);
        await upsertArtifactFromPath(targetPath, {
            taskId: typeof req.body?.taskId === 'string' ? req.body.taskId : undefined,
            agentId: typeof req.body?.agentId === 'string' ? req.body.agentId : 'user',
            status: 'submitted'
        });
        res.json({ ok: true, path: targetPath, size: buffer.length });
    } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || 'Unable to upload workspace file.' });
    }
});

app.get('/api/artifacts', async (req, res) => {
    try {
        const existsFilter = typeof req.query.exists_on_disk === 'string'
            ? req.query.exists_on_disk === 'true'
            : undefined;
        const artifacts = await memoryStore.listArtifacts({
            projectId: typeof req.query.project_id === 'string'
                ? req.query.project_id
                : getActiveProject()?.projectSlug,
            taskId: typeof req.query.task_id === 'string' ? req.query.task_id : undefined,
            agentId: typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined,
            status: typeof req.query.status === 'string' ? req.query.status as ArtifactStatus : undefined,
            existsOnDisk: existsFilter,
            limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
        });
        res.json({
            ok: true,
            artifacts,
            project: getActiveProject(),
            rootHint: getActiveWorkspaceRoot()
        });
    } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || 'Unable to list artifacts.' });
    }
});

app.get('/api/projects/:projectId/artifacts', async (req, res) => {
    try {
        const existsFilter = typeof req.query.exists_on_disk === 'string'
            ? req.query.exists_on_disk === 'true'
            : undefined;
        const artifacts = await memoryStore.listArtifacts({
            projectId: String(req.params.projectId || '').trim(),
            taskId: typeof req.query.task_id === 'string' ? req.query.task_id : undefined,
            agentId: typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined,
            status: typeof req.query.status === 'string' ? req.query.status as ArtifactStatus : undefined,
            existsOnDisk: existsFilter,
            limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
        });
        const activeProject = getActiveProject();
        const projectArtifactsRoot = activeProject?.projectSlug === req.params.projectId
            ? path.join(activeProject.projectRoot, 'artifacts')
            : path.join(getGlobalWorkspaceRoot(), 'projects', req.params.projectId, 'artifacts');
        res.json({ ok: true, artifacts, rootHint: projectArtifactsRoot });
    } catch (error: any) {
        res.status(400).json({ ok: false, error: error?.message || 'Unable to list project artifacts.' });
    }
});

const bootstrap = async () => {
    const dbPath = process.env.OFFICE_MEMORY_DB_PATH || process.env.DATABASE_URL || './data/office-memory.db';
    await memoryStore.initialize(dbPath);
    const configuredExtensionFolder = process.env.AGENT_EXTENSION_DIR
        ? path.resolve(process.cwd(), process.env.AGENT_EXTENSION_DIR)
        : path.resolve(__dirname, 'extensions', 'builtin');
    const extensionRegistry = await ExtensionRegistry.loadFromFolder(configuredExtensionFolder);
    OfficeRoom.setExtensionRegistry(extensionRegistry);
    OfficeRoom.setArtifactWriteLogger(async (entry) => {
        await upsertArtifactFromPath(entry.relativePath, {
            agentId: entry.actorId,
            status: entry.status
        });
    });
    console.log(`[Extensions] Active hooks: ${extensionRegistry.list().join(', ') || 'none'}`);

    // Create HTTP and Colyseus server
    const httpServer = createServer(app);
    const colyseusServer = new Server({
        server: httpServer,
    });

    // Define Rooms
    colyseusServer.define('office', OfficeRoom);

    // Start listening
    const PORT = Number(process.env.PORT || 3000);
    await colyseusServer.listen(PORT);
    console.log(`[Server] AgentOffice Engine listening on ws://localhost:${PORT}`);
};

bootstrap().catch((error) => {
    console.error('[Server] Failed to bootstrap', error);
    process.exit(1);
});

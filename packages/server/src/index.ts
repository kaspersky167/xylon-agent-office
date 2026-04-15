import express from 'express';
import { Server } from 'colyseus';
import { createServer } from 'http';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { OfficeRoom } from './rooms/OfficeRoom';

// Setup Express
const app = express();
app.use(express.json());

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

const workspaceRoot = path.resolve(process.env.AGENT_WORKSPACE_DIR || 'data/workspace');

const guessMimeType = (filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_MIME[ext] || 'application/octet-stream';
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
        const files = await listWorkspaceFiles(workspaceRoot);
        res.json({ ok: true, files });
    } catch (error) {
        console.error('[workspace-files] Failed to list files', error);
        res.status(500).json({ ok: false, error: 'Unable to list workspace files.' });
    }
});

// Create HTTP and Colyseus server
const httpServer = createServer(app);
const colyseusServer = new Server({
    server: httpServer,
});

// Define Rooms
colyseusServer.define('office', OfficeRoom);

// Start listening
const PORT = Number(process.env.PORT || 3000);
colyseusServer.listen(PORT).then(() => {
    console.log(`[Server] AgentOffice Engine listening on ws://localhost:${PORT}`);
});

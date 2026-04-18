import os from 'os';
import path from 'path';
import { mkdtemp } from 'fs/promises';
import { MemoryStore } from '../memory/MemoryStore';

describe('MemoryStore artifact persistence', () => {
  it('creates artifact schema and upserts by project + relative path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'xylon-db-'));
    const dbPath = path.join(dir, 'office-memory.db');
    const store = new MemoryStore();
    await store.initialize(dbPath);

    await store.upsertArtifact({
      id: 'a1',
      projectId: 'proj-a',
      taskId: 'task-1',
      agentId: 'agent-1',
      relativePath: 'artifacts/summary.md',
      mimeType: 'text/markdown',
      sizeBytes: 100,
      status: 'draft',
      checksum: null,
      existsOnDisk: true,
    });

    await store.upsertArtifact({
      id: 'a2',
      projectId: 'proj-a',
      taskId: 'task-1',
      agentId: 'agent-1',
      relativePath: 'artifacts/summary.md',
      mimeType: 'text/markdown',
      sizeBytes: 120,
      status: 'submitted',
      checksum: 'abc',
      existsOnDisk: true,
    });

    await store.upsertArtifact({
      id: 'b1',
      projectId: 'proj-b',
      taskId: 'task-2',
      agentId: 'agent-2',
      relativePath: 'artifacts/summary.md',
      mimeType: 'text/markdown',
      sizeBytes: 64,
      status: 'validated',
      checksum: 'def',
      existsOnDisk: false,
    });

    const aArtifacts = await store.listArtifacts({ projectId: 'proj-a' });
    const bArtifacts = await store.listArtifacts({ projectId: 'proj-b' });

    expect(aArtifacts).toHaveLength(1);
    expect(aArtifacts[0].id).toBe('a2');
    expect(aArtifacts[0].sizeBytes).toBe(120);
    expect(aArtifacts[0].status).toBe('submitted');

    expect(bArtifacts).toHaveLength(1);
    expect(bArtifacts[0].id).toBe('b1');
  });
});

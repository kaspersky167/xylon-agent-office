import os from 'os';
import path from 'path';
import { mkdtemp, readFile } from 'fs/promises';

describe('ProjectWorkspace path alignment', () => {
  it('writes brief and criteria inside active project workspace root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'xylon-workspace-'));
    process.env.AGENT_WORKSPACE_DIR = root;

    jest.resetModules();
    const workspacePaths = await import('../projects/workspacePaths');
    const { ProjectWorkspace } = await import('../projects/ProjectWorkspace');

    const started = await ProjectWorkspace.startProject({
      templateId: 'webapp',
      projectName: 'Alpha Project',
      brief: 'Build an internal app',
      acceptanceCriteria: '- Uses local workspace',
      mode: 'standard'
    });

    const activeRoot = workspacePaths.getActiveWorkspaceRoot();
    expect(activeRoot).toBe(started.project.projectRoot);

    const briefPath = path.join(activeRoot, started.files.brief);
    const criteriaPath = path.join(activeRoot, started.files.acceptanceCriteria);

    await expect(readFile(briefPath, 'utf-8')).resolves.toContain('Build an internal app');
    await expect(readFile(criteriaPath, 'utf-8')).resolves.toContain('Uses local workspace');
  });
});

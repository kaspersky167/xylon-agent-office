import path from 'path';
import { mkdir, writeFile } from 'fs/promises';
import {
    ActiveProjectState,
    getGlobalWorkspaceRoot,
    getProjectsRoot,
    setActiveProject,
    toPosixRelativePath,
    toProjectSlug
} from './workspacePaths';

export interface StartProjectRequest {
    templateId: string;
    projectName: string;
    brief: string;
    acceptanceCriteria: string;
    constraints?: string[] | string | null;
    mode?: string;
    runMetadata?: Record<string, unknown>;
}

export interface ProjectStartResult {
    project: ActiveProjectState;
    folders: string[];
    files: {
        brief: string;
        acceptanceCriteria: string;
        config: string;
    };
}

export class ProjectWorkspace {
    private static readonly REQUIRED_SUBFOLDERS = [
        'brief',
        'context',
        'tasks',
        'artifacts',
        'reviews',
        'final',
        'logs'
    ] as const;

    static async startProject(input: StartProjectRequest): Promise<ProjectStartResult> {
        const templateId = String(input.templateId || '').trim();
        const projectName = String(input.projectName || '').trim();
        const brief = String(input.brief || '').trim();
        const acceptanceCriteria = String(input.acceptanceCriteria || '').trim();
        const mode = String(input.mode || 'standard').trim();

        if (!templateId) throw new Error('templateId is required.');
        if (!projectName) throw new Error('projectName is required.');
        if (!brief) throw new Error('brief is required.');
        if (!acceptanceCriteria) throw new Error('acceptanceCriteria is required.');

        const createdAt = new Date().toISOString();
        const projectSlug = toProjectSlug(projectName);
        const projectRoot = path.join(getProjectsRoot(), projectSlug);

        await mkdir(projectRoot, { recursive: true });
        for (const folder of ProjectWorkspace.REQUIRED_SUBFOLDERS) {
            await mkdir(path.join(projectRoot, folder), { recursive: true });
        }

        const briefPath = path.join(projectRoot, 'brief', 'brief.md');
        const criteriaPath = path.join(projectRoot, 'brief', 'acceptance-criteria.md');
        const configPath = path.join(projectRoot, 'brief', 'project-config.json');

        const constraints = Array.isArray(input.constraints)
            ? input.constraints.map((item) => String(item)).filter(Boolean)
            : typeof input.constraints === 'string' && input.constraints.trim()
                ? [input.constraints.trim()]
                : [];

        const runMetadata = (input.runMetadata && typeof input.runMetadata === 'object')
            ? input.runMetadata
            : {};

        await writeFile(briefPath, `${brief}\n`, 'utf-8');
        await writeFile(criteriaPath, `${acceptanceCriteria}\n`, 'utf-8');
        await writeFile(configPath, JSON.stringify({
            templateId,
            createdAt,
            mode,
            constraints,
            runMetadata,
            projectName,
            projectSlug
        }, null, 2), 'utf-8');

        const project = setActiveProject({
            projectName,
            projectSlug,
            templateId,
            createdAt,
            mode,
            projectRoot,
            projectRootRelative: toPosixRelativePath(getGlobalWorkspaceRoot(), projectRoot)
        });

        return {
            project,
            folders: ProjectWorkspace.REQUIRED_SUBFOLDERS.map((folder) => `/${folder}`),
            files: {
                brief: 'brief/brief.md',
                acceptanceCriteria: 'brief/acceptance-criteria.md',
                config: 'brief/project-config.json'
            }
        };
    }
}

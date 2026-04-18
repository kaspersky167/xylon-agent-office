import path from 'path';

export interface ActiveProjectState {
    projectName: string;
    projectSlug: string;
    templateId: string;
    createdAt: string;
    mode: string;
    projectRoot: string;
    projectRootRelative: string;
}

const globalWorkspaceRoot = path.resolve(process.env.AGENT_WORKSPACE_DIR || 'data/workspace');
const projectsRoot = path.join(globalWorkspaceRoot, 'projects');

let activeProject: ActiveProjectState | null = null;

export const getGlobalWorkspaceRoot = (): string => globalWorkspaceRoot;

export const getProjectsRoot = (): string => projectsRoot;

export const getActiveProject = (): ActiveProjectState | null => activeProject;

export const setActiveProject = (project: ActiveProjectState): ActiveProjectState => {
    activeProject = project;
    return activeProject;
};

export const clearActiveProject = (): void => {
    activeProject = null;
};

export const getActiveWorkspaceRoot = (): string => {
    return activeProject?.projectRoot || globalWorkspaceRoot;
};

export const resolveScopedPath = (root: string, targetPath: string): string => {
    const safeTarget = String(targetPath || '').trim();
    if (!safeTarget) throw new Error('Path is required.');

    const fullPath = path.resolve(root, safeTarget);
    const relative = path.relative(root, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid workspace path.');
    }
    return fullPath;
};

export const resolveActiveScopedPath = (targetPath: string): string => {
    return resolveScopedPath(getActiveWorkspaceRoot(), targetPath);
};

export const toPosixRelativePath = (root: string, absolutePath: string): string => {
    return path.relative(root, absolutePath).split(path.sep).join('/');
};

export const toProjectSlug = (projectName: string): string => {
    const normalized = String(projectName || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || `project-${Date.now()}`;
};

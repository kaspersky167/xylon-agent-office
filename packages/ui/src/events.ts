export const eventBus = new EventTarget();

export const UIEvents = {
    chatMessage: 'chat-message',
    taskUpdate: 'task-update',
    tasksSync: 'tasks-sync',
    highlightEvent: 'highlight-event',
    scenarioEvent: 'scenario-event',
    relationshipUpdate: 'relationship-update',
    approvalsSync: 'approvals-sync',
    meetingState: 'meeting-state',
    layoutSync: 'layout-sync',
    agentHover: 'agent-hover',
    agentSelect: 'agent-select',
    agentFocus: 'agent-focus',
    desktopFilesSync: 'desktop-files-sync',
    desktopFilePreview: 'desktop-file-preview',
    desktopFileError: 'desktop-file-error',
    mailSync: 'mail-sync',
    mailError: 'mail-error'
} as const;

export function emitUIEvent(eventName: string, detail?: unknown) {
    eventBus.dispatchEvent(new CustomEvent(eventName, { detail }));
}

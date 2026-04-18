import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';

type TaskStatus = 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done';

const LEGACY_TASK_STATUS_MAP: Record<string, TaskStatus> = {
    pending: 'backlog',
    completed: 'done'
};

const toCanonicalTaskStatus = (value: unknown): TaskStatus => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'backlog' || normalized === 'in_progress' || normalized === 'blocked' || normalized === 'review' || normalized === 'done') return normalized;
    return LEGACY_TASK_STATUS_MAP[normalized] || 'backlog';
};

export type PanelKey =
    | 'desktop'
    | 'advanced'
    | 'chat'
    | 'operations'
    | 'agentPulse'
    | 'relationship'
    | 'recap'
    | 'systemLog'
    | 'viral'
    | 'highlights'
    | 'layoutEditor'
    | 'inspector';

export interface TaskItem {
    id: number | string;
    title: string;
    assigned_to?: string;
    status: TaskStatus;
    progress?: number;
}

export interface ApprovalRequest {
    id: string;
    requestedByName: string;
    requestedAction: string;
    rationale: string;
    isMajor: boolean;
    status: 'pending' | 'approved' | 'rejected';
}

export interface CompletedWorkItem {
    id: string;
    task: string;
    agentName: string;
    completedAt: string;
    summaryPath: string;
}

export interface AgentSnapshot {
    id: string;
    name: string;
    role: string;
    status: TaskStatus;
    currentTask: string;
    mood: number;
    reputation: number;
    riskLevel: number;
    momentum: number;
}

type UIState = {
    selectedAgentId: string | null;
    agents: Record<string, AgentSnapshot>;
    panelVisibility: Record<PanelKey, boolean>;
    filters: {
        taskStatus: 'all' | TaskStatus;
        search: string;
        approvalsOnly: boolean;
    };
    simulation: {
        fastTrackEnabled: boolean;
        meeting: { active: boolean; topic?: string; endsAt?: number } | null;
    };
    tasks: TaskItem[];
    approvals: ApprovalRequest[];
    completedWork: CompletedWorkItem[];
    reviewFolder: string;
};

type UIAction =
    | { type: 'SELECT_AGENT'; agentId: string | null }
    | { type: 'UPSERT_AGENT'; payload: AgentSnapshot }
    | { type: 'REMOVE_AGENT'; agentId: string }
    | { type: 'SET_PANEL_VISIBILITY'; panel: PanelKey; visible: boolean }
    | { type: 'TOGGLE_PANEL'; panel: PanelKey }
    | { type: 'SET_FILTERS'; filters: Partial<UIState['filters']> }
    | { type: 'SET_TASKS'; tasks: TaskItem[] }
    | { type: 'UPSERT_TASK'; task: TaskItem }
    | { type: 'SET_APPROVALS'; approvals: ApprovalRequest[] }
    | { type: 'SET_MEETING'; meeting: UIState['simulation']['meeting'] }
    | { type: 'SET_FAST_TRACK'; enabled: boolean }
    | { type: 'SET_COMPLETED_WORK'; items: CompletedWorkItem[]; reviewFolder?: string };

const initialState: UIState = {
    selectedAgentId: null,
    agents: {},
    panelVisibility: {
        desktop: false,
        advanced: false,
        chat: true,
        operations: true,
        agentPulse: true,
        relationship: true,
        recap: true,
        systemLog: true,
        viral: true,
        highlights: true,
        layoutEditor: true,
        inspector: true
    },
    filters: {
        taskStatus: 'all',
        search: '',
        approvalsOnly: false
    },
    simulation: {
        fastTrackEnabled: true,
        meeting: null
    },
    tasks: [],
    approvals: [],
    completedWork: [],
    reviewFolder: 'data/workspace/completed-work'
};

function normalizeRole(rawRole: string) {
    const value = (rawRole || '').replace(/[_-]/g, ' ').trim();
    if (!value) return 'Agent';
    return value
        .split(' ')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function uiReducer(state: UIState, action: UIAction): UIState {
    switch (action.type) {
        case 'SELECT_AGENT':
            return { ...state, selectedAgentId: action.agentId };
        case 'UPSERT_AGENT':
            return {
                ...state,
                agents: { ...state.agents, [action.payload.id]: action.payload }
            };
        case 'REMOVE_AGENT': {
            const { [action.agentId]: _removed, ...rest } = state.agents;
            return {
                ...state,
                agents: rest,
                selectedAgentId: state.selectedAgentId === action.agentId ? null : state.selectedAgentId
            };
        }
        case 'SET_PANEL_VISIBILITY':
            return {
                ...state,
                panelVisibility: { ...state.panelVisibility, [action.panel]: action.visible }
            };
        case 'TOGGLE_PANEL':
            return {
                ...state,
                panelVisibility: { ...state.panelVisibility, [action.panel]: !state.panelVisibility[action.panel] }
            };
        case 'SET_FILTERS':
            return { ...state, filters: { ...state.filters, ...action.filters } };
        case 'SET_TASKS':
            return { ...state, tasks: action.tasks };
        case 'UPSERT_TASK': {
            const existing = state.tasks.find((task) => task.title === action.task.title);
            if (existing) {
                return {
                    ...state,
                    tasks: state.tasks.map((task) => (task.title === action.task.title ? { ...task, ...action.task } : task))
                };
            }
            return { ...state, tasks: [...state.tasks, action.task] };
        }
        case 'SET_APPROVALS':
            return { ...state, approvals: action.approvals };
        case 'SET_MEETING':
            return { ...state, simulation: { ...state.simulation, meeting: action.meeting } };
        case 'SET_FAST_TRACK':
            return { ...state, simulation: { ...state.simulation, fastTrackEnabled: action.enabled } };
        case 'SET_COMPLETED_WORK':
            return {
                ...state,
                completedWork: action.items,
                reviewFolder: action.reviewFolder?.trim() || state.reviewFolder
            };
        default:
            return state;
    }
}

interface UIStoreContextValue {
    state: UIState;
    selectedAgent: AgentSnapshot | null;
    filteredTasks: TaskItem[];
    actions: {
        selectAgent: (agentId: string | null) => void;
        togglePanel: (panel: PanelKey) => void;
        setPanelVisibility: (panel: PanelKey, visible: boolean) => void;
        setFilters: (filters: Partial<UIState['filters']>) => void;
        sendTaskAssignment: (title: string, agentId?: string) => void;
        sendApprovalDecision: (id: string, decision: 'approved' | 'rejected') => void;
        setFastTrack: (enabled: boolean) => void;
        callMeeting: (topic: string, durationSec: number) => void;
        endMeeting: () => void;
    };
}

const UIStoreContext = createContext<UIStoreContextValue | undefined>(undefined);

export function UIStoreProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(uiReducer, initialState);

    useEffect(() => {
        const onTaskUpdate = (event: Event) => {
            const data = (event as CustomEvent).detail || {};
            if (!data?.task) return;
            dispatch({
                type: 'UPSERT_TASK',
                task: {
                    id: data.id || Date.now(),
                    title: data.task,
                    assigned_to: data.agentId,
                    status: toCanonicalTaskStatus(data.status),
                    progress: typeof data.progress === 'number' ? data.progress : undefined
                }
            });
        };

        const onTasksSync = (event: Event) => {
            const list = (event as CustomEvent).detail;
            if (!Array.isArray(list)) return;
            dispatch({
                type: 'SET_TASKS',
                tasks: list.map((task: any) => ({
                    id: task.id,
                    title: task.title,
                    assigned_to: task.assigned_to || '',
                    status: toCanonicalTaskStatus(task.status),
                    progress: typeof task.progress === 'number' ? task.progress : undefined
                }))
            });
        };

        const onApprovalsSync = (event: Event) => {
            const list = (event as CustomEvent).detail;
            dispatch({ type: 'SET_APPROVALS', approvals: Array.isArray(list) ? list : [] });
        };

        const onMeeting = (event: Event) => {
            dispatch({ type: 'SET_MEETING', meeting: (event as CustomEvent).detail || null });
        };

        const onFastTrack = (event: Event) => {
            dispatch({ type: 'SET_FAST_TRACK', enabled: Boolean((event as CustomEvent).detail?.enabled) });
        };

        const onCompletedWork = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            dispatch({
                type: 'SET_COMPLETED_WORK',
                items: Array.isArray(detail.items) ? detail.items : [],
                reviewFolder: detail.reviewFolder
            });
        };

        const onAgentFocus = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            dispatch({ type: 'SELECT_AGENT', agentId: detail?.id || null });
        };

        const onAgentStateSync = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            if (!detail.id) return;
            dispatch({
                type: 'UPSERT_AGENT',
                payload: {
                    id: detail.id,
                    name: detail.name || detail.id,
                    role: normalizeRole(detail.role || detail.id),
                    status: detail.status || detail.action || 'idle',
                    currentTask: detail.currentTask || '',
                    mood: Number(detail.mood || 0),
                    reputation: Number(detail.reputation || 0),
                    riskLevel: Number(detail.riskLevel || 0),
                    momentum: Number(detail.momentum || 0)
                }
            });
        };

        const onAgentRemoved = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            if (detail.id) {
                dispatch({ type: 'REMOVE_AGENT', agentId: detail.id });
            }
        };

        eventBus.addEventListener('task-update', onTaskUpdate);
        eventBus.addEventListener('tasks-sync', onTasksSync);
        eventBus.addEventListener('approvals-sync', onApprovalsSync);
        eventBus.addEventListener('meeting-state', onMeeting);
        eventBus.addEventListener('fast-track-state', onFastTrack);
        eventBus.addEventListener('completed-work-sync', onCompletedWork);
        eventBus.addEventListener('agent-focus', onAgentFocus);
        eventBus.addEventListener('agent-state-sync', onAgentStateSync);
        eventBus.addEventListener('agent-removed', onAgentRemoved);

        return () => {
            eventBus.removeEventListener('task-update', onTaskUpdate);
            eventBus.removeEventListener('tasks-sync', onTasksSync);
            eventBus.removeEventListener('approvals-sync', onApprovalsSync);
            eventBus.removeEventListener('meeting-state', onMeeting);
            eventBus.removeEventListener('fast-track-state', onFastTrack);
            eventBus.removeEventListener('completed-work-sync', onCompletedWork);
            eventBus.removeEventListener('agent-focus', onAgentFocus);
            eventBus.removeEventListener('agent-state-sync', onAgentStateSync);
            eventBus.removeEventListener('agent-removed', onAgentRemoved);
        };
    }, []);

    const contextValue = useMemo<UIStoreContextValue>(() => {
        const selectedAgent = state.selectedAgentId ? state.agents[state.selectedAgentId] || null : null;
        const filteredTasks = state.tasks.filter((task) => {
            if (state.filters.taskStatus !== 'all' && task.status !== state.filters.taskStatus) return false;
            if (state.filters.search && !task.title.toLowerCase().includes(state.filters.search.toLowerCase())) return false;
            if (state.filters.approvalsOnly && !/\b(major|deploy|launch|publish|hire|fire|pricing)\b/i.test(task.title)) return false;
            return true;
        });

        return {
            state,
            selectedAgent,
            filteredTasks,
            actions: {
                selectAgent: (agentId) => dispatch({ type: 'SELECT_AGENT', agentId }),
                togglePanel: (panel) => dispatch({ type: 'TOGGLE_PANEL', panel }),
                setPanelVisibility: (panel, visible) => dispatch({ type: 'SET_PANEL_VISIBILITY', panel, visible }),
                setFilters: (filters) => dispatch({ type: 'SET_FILTERS', filters }),
                sendTaskAssignment: (title, agentId) => {
                    const room = getColyseusRoom();
                    room?.send('assign-task', { title: title.trim(), agentId: agentId || undefined });
                },
                sendApprovalDecision: (id, decision) => {
                    getColyseusRoom()?.send('approval-decision', { id, decision });
                },
                setFastTrack: (enabled) => {
                    getColyseusRoom()?.send('set-fast-track', { enabled });
                },
                callMeeting: (topic, durationSec) => {
                    getColyseusRoom()?.send('call-meeting', { topic, durationSec });
                },
                endMeeting: () => {
                    getColyseusRoom()?.send('end-meeting', {});
                }
            }
        };
    }, [state]);

    useEffect(() => {
        const requestTimer = setInterval(() => {
            const room = getColyseusRoom();
            if (!room) return;
            room.send('request-approvals', {});
            room.send('request-completed-work', {});
            clearInterval(requestTimer);
        }, 400);
        return () => clearInterval(requestTimer);
    }, []);

    return <UIStoreContext.Provider value={contextValue}>{children}</UIStoreContext.Provider>;
}

export function useUIStore() {
    const context = useContext(UIStoreContext);
    if (!context) {
        throw new Error('useUIStore must be used within UIStoreProvider');
    }
    return context;
}

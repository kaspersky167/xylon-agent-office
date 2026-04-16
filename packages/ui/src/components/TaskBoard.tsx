import React, { useEffect, useMemo, useState } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';

type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
type LifecycleStage = 'queued' | 'in-progress' | 'blocked' | 'review' | 'completed';

type TaskItem = {
    id: number | string;
    title: string;
    status?: string;
    lifecycleStage: LifecycleStage;
    priority: TaskPriority;
    approvalRequired: boolean;
    assigneeId?: string;
    assigneeName?: string;
    assigned_to?: string;
    createdAt?: string;
    updatedAt?: string;
    startedAt?: string;
    completedAt?: string;
};

type AgentRosterItem = {
    id: string;
    name: string;
    currentTask?: string;
};

const STAGES: LifecycleStage[] = ['queued', 'in-progress', 'blocked', 'review', 'completed'];

const STAGE_LABELS: Record<LifecycleStage, string> = {
    queued: 'Queued',
    'in-progress': 'In Progress',
    blocked: 'Blocked',
    review: 'Review',
    completed: 'Completed'
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
    low: '#74b9ff',
    medium: '#fdcb6e',
    high: '#ff7675',
    critical: '#d63031'
};

function normalizeStage(raw: unknown): LifecycleStage {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'in_progress' || value === 'in-progress') return 'in-progress';
    if (value === 'blocked') return 'blocked';
    if (value === 'review') return 'review';
    if (value === 'completed') return 'completed';
    return 'queued';
}

function normalizePriority(raw: unknown): TaskPriority {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'low' || value === 'high' || value === 'critical') return value;
    return 'medium';
}

function normalizeTask(input: any): TaskItem {
    const lifecycleStage = normalizeStage(input.lifecycleStage || input.stage || input.status);
    const assigneeId = input.assigneeId || input.assigned_to || input.agentId || undefined;

    return {
        id: input.id ?? `${input.title || 'task'}-${Date.now()}`,
        title: String(input.title || input.task || 'Untitled task'),
        status: input.status,
        lifecycleStage,
        priority: normalizePriority(input.priority),
        approvalRequired: Boolean(input.approvalRequired ?? input.approval_required),
        assigneeId,
        assigneeName: input.assigneeName,
        assigned_to: assigneeId,
        createdAt: input.createdAt || input.created_at,
        updatedAt: input.updatedAt || input.updated_at,
        startedAt: input.startedAt || input.started_at,
        completedAt: input.completedAt || input.completed_at
    };
}

export function TaskBoard() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [approvalRequired, setApprovalRequired] = useState(false);
    const [roster, setRoster] = useState<AgentRosterItem[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<number | string | null>(null);

    useEffect(() => {
        let stopped = false;

        const syncRoster = (state: any) => {
            const mapLike = state?.agents;
            if (!mapLike) return;

            const next: AgentRosterItem[] = [];
            if (typeof mapLike.forEach === 'function') {
                mapLike.forEach((agent: any, id: string) => {
                    next.push({ id, name: agent?.name || id, currentTask: agent?.currentTask });
                });
            } else {
                Object.entries(mapLike).forEach(([id, agent]: [string, any]) => {
                    next.push({ id, name: agent?.name || id, currentTask: agent?.currentTask });
                });
            }
            next.sort((a, b) => a.name.localeCompare(b.name));
            setRoster(next);
        };

        const upsertTask = (payload: any) => {
            const normalized = normalizeTask(payload);
            setTasks((prev) => {
                const key = String(normalized.id);
                const existing = prev.find((task) => String(task.id) === key || task.title === normalized.title);
                if (!existing) return [...prev, normalized];
                return prev.map((task) => (String(task.id) === key || task.title === normalized.title
                    ? { ...task, ...normalized, updatedAt: normalized.updatedAt || new Date().toISOString() }
                    : task));
            });
        };

        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (!room || stopped) return;

            syncRoster(room.state);
            room.onStateChange((state: any) => syncRoster(state));

            room.onMessage('task-update', (data: any) => upsertTask({ ...data, title: data?.title || data?.task }));
            room.onMessage('tasks-sync', (serverTasks: any[]) => {
                if (!Array.isArray(serverTasks)) return;
                setTasks(serverTasks.map((item) => normalizeTask(item)));
            });

            clearInterval(checkRoom);
        }, 500);

        return () => {
            stopped = true;
            clearInterval(checkRoom);
        };
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', {
                title: newTask.trim(),
                agentId: targetAgent === 'auto' ? undefined : targetAgent,
                priority,
                approvalRequired
            });
            setNewTask('');
            setApprovalRequired(false);
            setPriority('medium');
        }
    };

    const tasksByStage = useMemo(() => {
        const grouped = new Map<LifecycleStage, TaskItem[]>();
        STAGES.forEach((stage) => grouped.set(stage, []));

        tasks.forEach((task) => {
            const stage = normalizeStage(task.lifecycleStage || task.status);
            grouped.get(stage)?.push(task);
        });

        grouped.forEach((list) => list.sort((a, b) => (a.title > b.title ? 1 : -1)));
        return grouped;
    }, [tasks]);

    const selectedTask = tasks.find((task) => String(task.id) === String(selectedTaskId));

    const openTaskDetail = (task: TaskItem) => {
        setSelectedTaskId(task.id);
        eventBus.dispatchEvent(new CustomEvent('task-selected', { detail: task }));
        if (task.assigneeId) {
            const agent = roster.find((entry) => entry.id === task.assigneeId);
            eventBus.dispatchEvent(new CustomEvent('agent-focus', {
                detail: { id: task.assigneeId, name: agent?.name || task.assigneeId }
            }));
        }
    };

    return (
        <div style={{
            position: 'absolute', left: 20, top: 20, width: 360,
            backgroundColor: 'rgba(10,10,30,0.92)', color: 'white',
            padding: 16, borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(108,92,231,0.3)',
            maxHeight: '72vh', display: 'flex', flexDirection: 'column'
        }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                📋 Task Board
            </h3>

            <form onSubmit={handleSubmit} style={{ marginBottom: 10 }}>
                <input
                    type="text"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    placeholder="Assign a task..."
                    style={{
                        width: '100%', padding: '8px 10px', borderRadius: 6,
                        border: '1px solid #444', backgroundColor: '#1a1a3e',
                        color: 'white', fontSize: '12px', outline: 'none',
                        boxSizing: 'border-box', marginBottom: 6
                    }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, marginBottom: 6 }}>
                    <select
                        value={targetAgent}
                        onChange={(e) => setTargetAgent(e.target.value)}
                        style={{
                            padding: '6px', borderRadius: 6,
                            border: '1px solid #444', backgroundColor: '#1a1a3e',
                            color: '#aaa', fontSize: '11px'
                        }}
                    >
                        <option value="auto">🤖 Auto-assign</option>
                        {roster.map((agent) => (
                            <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                    </select>
                    <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as TaskPriority)}
                        style={{ padding: '6px', borderRadius: 6, border: '1px solid #444', backgroundColor: '#1a1a3e', color: '#aaa', fontSize: '11px' }}
                    >
                        <option value="low">Low priority</option>
                        <option value="medium">Medium priority</option>
                        <option value="high">High priority</option>
                        <option value="critical">Critical priority</option>
                    </select>
                    <button type="submit" style={{
                        padding: '6px 14px', borderRadius: 6, border: 'none',
                        backgroundColor: '#6c5ce7', color: 'white', fontSize: '11px',
                        cursor: 'pointer', fontWeight: 'bold'
                    }}>
                        Assign
                    </button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#ccc' }}>
                    <input
                        type="checkbox"
                        checked={approvalRequired}
                        onChange={(e) => setApprovalRequired(e.target.checked)}
                    />
                    Requires approval
                </label>
            </form>

            <div style={{ flex: 1, overflowY: 'auto', fontSize: '12px' }}>
                {tasks.length === 0 && (
                    <p style={{ color: '#666', fontStyle: 'italic', margin: 0, fontSize: '11px' }}>
                        No tasks yet. Type above to assign work to agents!
                    </p>
                )}

                {STAGES.map((stage) => {
                    const stageTasks = tasksByStage.get(stage) || [];
                    return (
                        <section key={stage} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#b2bec3', marginBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.09)', paddingBottom: 2 }}>
                                {STAGE_LABELS[stage]} ({stageTasks.length})
                            </div>
                            {stageTasks.length === 0 && <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>No tasks</div>}
                            {stageTasks.map((task) => {
                                const assigneeName = roster.find((entry) => entry.id === task.assigneeId)?.name || task.assigneeName || task.assigned_to || 'Unassigned';
                                return (
                                    <button
                                        key={task.id}
                                        type="button"
                                        onClick={() => openTaskDetail(task)}
                                        style={{
                                            width: '100%', textAlign: 'left', padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                                            backgroundColor: String(selectedTaskId) === String(task.id) ? 'rgba(108,92,231,0.35)' : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${String(selectedTaskId) === String(task.id) ? 'rgba(180,170,255,0.9)' : 'transparent'}`,
                                            borderLeft: `3px solid ${PRIORITY_COLORS[task.priority]}`,
                                            color: 'white', cursor: 'pointer'
                                        }}
                                    >
                                        <div style={{ fontWeight: 'bold', fontSize: '11px' }}>
                                            {task.title}
                                            {task.approvalRequired && <span style={{ marginLeft: 6, color: '#ff7675', fontSize: 10 }}>🛂 Approval</span>}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#a7b3be', marginTop: 2 }}>
                                            → {assigneeName} · {task.priority}
                                        </div>
                                    </button>
                                );
                            })}
                        </section>
                    );
                })}
            </div>

            {selectedTask && (
                <div style={{ marginTop: 8, fontSize: '10px', color: '#ccd2d8', borderTop: '1px solid #333', paddingTop: 6 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>Task detail</div>
                    <div>{selectedTask.title}</div>
                    <div>Stage: {STAGE_LABELS[selectedTask.lifecycleStage]}</div>
                    <div>Priority: {selectedTask.priority}</div>
                    <div>Approval required: {selectedTask.approvalRequired ? 'Yes' : 'No'}</div>
                    {selectedTask.createdAt && <div>Created: {new Date(selectedTask.createdAt).toLocaleString()}</div>}
                    {selectedTask.startedAt && <div>Started: {new Date(selectedTask.startedAt).toLocaleString()}</div>}
                    {selectedTask.completedAt && <div>Completed: {new Date(selectedTask.completedAt).toLocaleString()}</div>}
                    {selectedTask.updatedAt && <div>Updated: {new Date(selectedTask.updatedAt).toLocaleString()}</div>}
                </div>
            )}
        </div>
    );
}

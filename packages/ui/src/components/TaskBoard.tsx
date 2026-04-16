import React, { useEffect, useMemo, useState } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';
import { Button } from './ui/Button';
import { Chip } from './ui/Chip';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { Toolbar } from './ui/Toolbar';
import { controlRoomStyles, tokens } from '../theme/tokens';

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

    const taskTone = (s: string): 'success' | 'warning' | 'default' => {
        if (s === 'completed') return 'success';
        if (s === 'in_progress') return 'warning';
        return 'default';
    };

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
        <Panel style={{ position: 'absolute', left: 20, top: 20, width: 300, maxHeight: '52vh', display: 'flex', flexDirection: 'column' }}>
            <SectionHeader title="📋 Task Board" subtitle="Assign, route, and monitor execution" />

            <form onSubmit={handleSubmit} style={{ marginBottom: tokens.spacing.sm }}>
                <input
                    type="text"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    placeholder="Assign a task..."
                    style={{ ...controlRoomStyles.input, marginBottom: tokens.spacing.xs }}
                />
                <Toolbar>
                    <select
                        value={targetAgent}
                        onChange={(e) => setTargetAgent(e.target.value)}
                        style={{ ...controlRoomStyles.input, flex: 1, padding: 6, color: tokens.color.textSecondary }}
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
                    <Button type="submit" tone="primary">Assign</Button>
                </Toolbar>
            </form>

            <div style={{ flex: 1, overflowY: 'auto', fontSize: tokens.typography.caption, ...controlRoomStyles.scroll }}>
                {tasks.length === 0 && (
                    <p style={{ color: tokens.color.textMuted, fontStyle: 'italic', margin: 0, fontSize: tokens.typography.micro }}>
                        No tasks yet. Type above to assign work to agents.
                    </p>
                )}
                {tasks.map(task => (
                    <div key={task.id} style={{ ...controlRoomStyles.panelMuted, padding: `${tokens.spacing.xs}px ${tokens.spacing.sm}px`, marginBottom: tokens.spacing.xs }}>
                        <Toolbar>
                            <div style={{ fontWeight: 700, fontSize: tokens.typography.caption, flex: 1 }}>{statusIcon(task.status)} {task.title}</div>
                            {/(\bmajor\b|\bdeploy\b|\blaunch\b|\bpublish\b|\bhire\b|\bfire\b|\bpricing\b)/i.test(task.title) && (
                                <Chip tone="danger">🛂 CEO</Chip>
                            )}
                        </Toolbar>
                        <Toolbar style={{ marginTop: 3 }}>
                            <Chip tone={taskTone(task.status)}>{task.status.replace('_', ' ')}</Chip>
                            <div style={{ fontSize: tokens.typography.micro, color: tokens.color.textSecondary }}>
                                → {task.assigned_to || 'Unassigned'}
                            </div>
                        </Toolbar>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: tokens.spacing.sm, fontSize: tokens.typography.micro, color: tokens.color.textMuted, borderTop: `1px solid ${tokens.color.borderSoft}`, paddingTop: 6 }}>
                🤖 Engine: Ollama Local • 💾 SQLite Persistence
            </div>
        </Panel>
    );
}

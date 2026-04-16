import React, { useMemo, useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { Button } from './ui/Button';
import { Chip } from './ui/Chip';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { Toolbar } from './ui/Toolbar';
import { controlRoomStyles, tokens } from '../theme/tokens';
import { eventBus } from '../events';

type TaskStatus = 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done';
type TaskPriority = 'low' | 'medium' | 'high';

interface TaskItem {
    id: string;
    title: string;
    assigned_to: string;
    status: TaskStatus;
    priority?: TaskPriority;
    requires_approval?: boolean;
    status_reason?: string | null;
}

interface AgentRosterEntry {
    id: string;
    name: string;
}

const nextTransitions: Record<TaskStatus, TaskStatus[]> = {
    backlog: ['in_progress'],
    in_progress: ['blocked', 'review'],
    blocked: ['in_progress'],
    review: ['done', 'in_progress'],
    done: []
};

export function TaskBoard() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [requiresApproval, setRequiresApproval] = useState(false);
    const [roster, setRoster] = useState<AgentRosterEntry[]>([]);

    useEffect(() => {
        const onTaskUpdate = (event: Event) => {
            const data = ((event as CustomEvent).detail || {}) as any;
            if (!data?.task) return;
            setTasks(prev => {
                const existing = prev.find(t => t.id === data.id || (t.title === data.task && t.assigned_to === data.agentId));
                if (existing) {
                    return prev.map(t => (t.id === existing.id ? {
                        ...t,
                        id: data.id || t.id,
                        status: data.status || t.status,
                        assigned_to: data.agentId ?? t.assigned_to,
                        status_reason: data.statusReason ?? t.status_reason,
                        priority: data.priority || t.priority,
                        requires_approval: data.requiresApproval ?? t.requires_approval
                    } : t));
                }
                return [...prev, {
                    id: String(data.id || `${Date.now()}-${Math.random()}`),
                    title: data.task,
                    assigned_to: data.agentId || '',
                    status: (data.status || 'backlog') as TaskStatus,
                    status_reason: data.statusReason || null,
                    priority: data.priority || 'medium',
                    requires_approval: Boolean(data.requiresApproval)
                }];
            });
        };

        const onTasksSync = (event: Event) => {
            const serverTasks = (event as CustomEvent).detail;
            if (!Array.isArray(serverTasks)) return;
            setTasks(serverTasks.map((t: any) => ({
                id: String(t.id),
                title: t.title,
                assigned_to: t.assigned_to || '',
                status: (t.status || 'backlog') as TaskStatus,
                status_reason: t.status_reason || null,
                priority: t.priority || 'medium',
                requires_approval: Boolean(t.requires_approval)
            })));
        };

        const onRosterSync = (event: Event) => {
            const entries = (event as CustomEvent).detail;
            if (!Array.isArray(entries)) return;
            setRoster(entries.map((entry: any) => ({ id: String(entry.id), name: String(entry.name || entry.id) })));
        };

        eventBus.addEventListener('task-update', onTaskUpdate);
        eventBus.addEventListener('tasks-sync', onTasksSync);
        eventBus.addEventListener('agent-roster-sync', onRosterSync);
        return () => {
            eventBus.removeEventListener('task-update', onTaskUpdate);
            eventBus.removeEventListener('tasks-sync', onTasksSync);
            eventBus.removeEventListener('agent-roster-sync', onRosterSync);
        };
    }, []);

    const rosterMap = useMemo(() => new Map(roster.map((entry) => [entry.id, entry.name])), [roster]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', {
                title: newTask.trim(),
                agentId: targetAgent === 'auto' ? undefined : targetAgent,
                priority,
                requiresApproval
            });
            setNewTask('');
            setPriority('medium');
            setRequiresApproval(false);
        }
    };

    const taskTone = (s: string): 'success' | 'warning' | 'default' => {
        if (s === 'completed') return 'success';
        if (s === 'in_progress') return 'warning';
        return 'default';
    };

    const statusIcon = (s: TaskStatus) => {
        if (s === 'done') return '✅';
        if (s === 'review') return '🕵️';
        if (s === 'blocked') return '⛔';
        if (s === 'in_progress') return '🔄';
        return '🧾';
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

import React, { useMemo, useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { eventBus } from '../events';

type TaskStatus = 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

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

    const transitionTask = (taskId: string, status: TaskStatus) => {
        const room = getColyseusRoom();
        room?.send('task-transition', { id: taskId, status });
    };

    const statusColor = (s: TaskStatus) => {
        if (s === 'done') return '#00b894';
        if (s === 'review') return '#a29bfe';
        if (s === 'blocked') return '#ff7675';
        if (s === 'in_progress') return '#fdcb6e';
        return '#dfe6e9';
    };

    const statusIcon = (s: TaskStatus) => {
        if (s === 'done') return '✅';
        if (s === 'review') return '🕵️';
        if (s === 'blocked') return '⛔';
        if (s === 'in_progress') return '🔄';
        return '🧾';
    };

    return (
        <div style={{
            position: 'absolute', left: 20, top: 20, width: 300,
            backgroundColor: 'rgba(10,10,30,0.92)', color: 'white',
            padding: 16, borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(108,92,231,0.3)',
            maxHeight: '60vh', display: 'flex', flexDirection: 'column'
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
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', backgroundColor: '#1a1a3e', color: 'white', fontSize: '12px', outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
                />
                <div style={{ display: 'grid', gap: 6 }}>
                    <select value={targetAgent} onChange={(e) => setTargetAgent(e.target.value)} style={{ padding: '6px', borderRadius: 6, border: '1px solid #444', backgroundColor: '#1a1a3e', color: '#aaa', fontSize: '11px' }}>
                        <option value="auto">🤖 Auto-assign</option>
                        {roster.map((agent) => (
                            <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                    </select>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={{ borderRadius: 6, border: '1px solid #444', backgroundColor: '#1a1a3e', color: '#aaa', fontSize: '11px', padding: 6 }}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} /> CEO approval
                        </label>
                        <button type="submit" style={{ padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: '#6c5ce7', color: 'white', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>
                            Assign
                        </button>
                    </div>
                </div>
            </form>

            <div style={{ flex: 1, overflowY: 'auto', fontSize: '12px' }}>
                {tasks.length === 0 && <p style={{ color: '#666', fontStyle: 'italic', margin: 0, fontSize: '11px' }}>No tasks yet.</p>}
                {tasks.map(task => (
                    <div key={task.id} style={{ padding: '6px 8px', marginBottom: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderLeft: `3px solid ${statusColor(task.status)}` }}>
                        <div style={{ fontWeight: 'bold', fontSize: '11px' }}>{statusIcon(task.status)} {task.title}</div>
                        <div style={{ fontSize: '10px', color: '#888', marginTop: 2 }}>
                            → {rosterMap.get(task.assigned_to) || task.assigned_to || 'Unassigned'} · {task.priority || 'medium'}
                            {task.requires_approval ? ' · CEO gate' : ''}
                        </div>
                        {task.status_reason && <div style={{ fontSize: 10, color: '#ffb3b3', marginTop: 2 }}>Reason: {task.status_reason}</div>}
                        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                            {(nextTransitions[task.status] || []).map((next) => (
                                <button
                                    key={next}
                                    type="button"
                                    onClick={() => transitionTask(task.id, next)}
                                    style={{
                                        borderRadius: 6,
                                        border: '1px solid rgba(255,255,255,0.2)',
                                        background: 'rgba(108,92,231,0.2)',
                                        color: '#fff',
                                        fontSize: 10,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {next.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

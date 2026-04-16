import React, { useEffect, useMemo, useState } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';
import { FloatingPanel } from './FloatingPanel';

type TaskItem = {
    id: number | string;
    title: string;
    assigned_to?: string;
    status: 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done';
    progress?: number;
};

type ApprovalRequest = {
    id: string;
    requestedByName: string;
    requestedAction: string;
    rationale: string;
    isMajor: boolean;
    status: 'pending' | 'approved' | 'rejected';
};

type CompletedWorkItem = {
    id: string;
    task: string;
    agentName: string;
    completedAt: string;
    summaryPath: string;
};

export function CeoOperationsPanel() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
    const [meeting, setMeeting] = useState<{ active: boolean; topic?: string; endsAt?: number } | null>(null);
    const [fastTrackEnabled, setFastTrackEnabled] = useState(true);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');
    const [roster, setRoster] = useState<Array<{ id: string; name: string }>>([]);
    const [completedWork, setCompletedWork] = useState<CompletedWorkItem[]>([]);
    const [reviewFolder, setReviewFolder] = useState('data/workspace/completed-work');

    useEffect(() => {
        const onTaskUpdate = (event: Event) => {
            const data = (event as CustomEvent).detail || {};
            if (!data?.task) return;
            setTasks((prev) => {
                const existing = prev.find((t) => t.title === data.task);
                if (existing) {
                    return prev.map((t) => t.title === data.task
                        ? { ...t, status: data.status, assigned_to: data.agentId, progress: typeof data.progress === 'number' ? data.progress : t.progress }
                        : t);
                }
                return [...prev, {
                    id: Date.now(),
                    title: data.task,
                    assigned_to: data.agentId,
                    status: data.status || 'backlog',
                    progress: typeof data.progress === 'number' ? data.progress : undefined
                }];
            });
        };
        const onTasksSync = (event: Event) => {
            const list = (event as CustomEvent).detail;
            if (!Array.isArray(list)) return;
            setTasks(list.map((task: any) => ({
                id: task.id,
                title: task.title,
                assigned_to: task.assigned_to || '',
                status: task.status || 'backlog',
                progress: typeof task.progress === 'number' ? task.progress : undefined
            })));
        };
        const onApprovals = (event: Event) => {
            const list = (event as CustomEvent).detail;
            setApprovals(Array.isArray(list) ? list : []);
        };
        const onRosterSync = (event: Event) => {
            const list = (event as CustomEvent).detail;
            if (!Array.isArray(list)) return;
            setRoster(list.map((entry: any) => ({ id: String(entry.id), name: String(entry.name || entry.id) })));
        };
        const onMeeting = (event: Event) => setMeeting((event as CustomEvent).detail || null);
        const onFastTrack = (event: Event) => setFastTrackEnabled(Boolean((event as CustomEvent).detail?.enabled));
        const onCompletedWork = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            setCompletedWork(Array.isArray(detail.items) ? detail.items : []);
            if (typeof detail.reviewFolder === 'string' && detail.reviewFolder.trim()) {
                setReviewFolder(detail.reviewFolder.trim());
            }
        };

        eventBus.addEventListener('task-update', onTaskUpdate);
        eventBus.addEventListener('tasks-sync', onTasksSync);
        eventBus.addEventListener('approvals-sync', onApprovals);
        eventBus.addEventListener('agent-roster-sync', onRosterSync);
        eventBus.addEventListener('meeting-state', onMeeting);
        eventBus.addEventListener('fast-track-state', onFastTrack);
        eventBus.addEventListener('completed-work-sync', onCompletedWork);

        const requestTimer = setInterval(() => {
            const room = getColyseusRoom();
            if (!room) return;
            room.send('request-approvals', {});
            room.send('request-completed-work', {});
            clearInterval(requestTimer);
        }, 400);

        return () => {
            clearInterval(requestTimer);
            eventBus.removeEventListener('task-update', onTaskUpdate);
            eventBus.removeEventListener('tasks-sync', onTasksSync);
            eventBus.removeEventListener('approvals-sync', onApprovals);
            eventBus.removeEventListener('agent-roster-sync', onRosterSync);
            eventBus.removeEventListener('meeting-state', onMeeting);
            eventBus.removeEventListener('fast-track-state', onFastTrack);
            eventBus.removeEventListener('completed-work-sync', onCompletedWork);
        };
    }, []);

    const metrics = useMemo(() => {
        const total = tasks.length;
        const completed = tasks.filter((t) => t.status === 'done').length;
        const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
        const pending = tasks.filter((t) => t.status === 'backlog').length;
        return { total, completed, inProgress, pending, completionPct: total === 0 ? 0 : Math.round((completed / total) * 100) };
    }, [tasks]);

    const pendingApprovals = approvals.filter((a) => a.status === 'pending');

    const transitionTask = (id: string | number, status: 'in_progress' | 'blocked' | 'review' | 'done') => {
        const room = getColyseusRoom();
        room?.send('task-transition', { id: String(id), status });
    };

    const assignTask = () => {
        const room = getColyseusRoom();
        if (!room || !newTask.trim()) return;
        room.send('assign-task', { title: newTask.trim(), agentId: targetAgent === 'auto' ? undefined : targetAgent });
        setNewTask('');
    };

    const decide = (id: string, decision: 'approved' | 'rejected') => {
        const room = getColyseusRoom();
        room?.send('approval-decision', { id, decision });
    };

    const toggleFastTrack = () => {
        const room = getColyseusRoom();
        room?.send('set-fast-track', { enabled: !fastTrackEnabled });
    };

    const callMeeting = () => {
        const room = getColyseusRoom();
        if (!room) return;
        const topic = window.prompt('Meeting topic?', 'Daily executive sync') || 'All-hands';
        room.send('call-meeting', { topic, durationSec: 60 });
    };

    const endMeeting = () => {
        const room = getColyseusRoom();
        room?.send('end-meeting', {});
    };

    return (
        <FloatingPanel id="ceo-operations" title="CEO Operations" subtitle="Tasks · Progress · Approvals" width={360} defaultDock="right" defaultY={20} zIndex={26}>
            <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button onClick={toggleFastTrack} style={{ borderRadius: 6 }}>{fastTrackEnabled ? '⚡ Fast-track ON' : '🧭 Fast-track OFF'}</button>
                    {meeting?.active
                        ? <button onClick={endMeeting} style={{ borderRadius: 6 }}>🔚 End Meeting</button>
                        : <button onClick={callMeeting} style={{ borderRadius: 6 }}>📣 Call Meeting</button>}
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Task Assignment</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                        <select value={targetAgent} onChange={(e) => setTargetAgent(e.target.value)}>
                            <option value="auto">Auto-assign</option>
                            {roster.map((agent) => (
                                <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                        </select>
                        <button onClick={assignTask}>Assign</button>
                        <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Define work item..." style={{ gridColumn: '1 / -1' }} />
                    </div>
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Progress</div>
                    <div>Total: <strong>{metrics.total}</strong> · Completed: <strong style={{ color: '#55efc4' }}>{metrics.completed}</strong> · In progress: <strong>{metrics.inProgress}</strong> · Pending: <strong>{metrics.pending}</strong></div>
                    <div style={{ marginTop: 4 }}>Completion: <strong>{metrics.completionPct}%</strong></div>
                    <div style={{ marginTop: 8, display: 'grid', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                        {tasks.slice(0, 5).map((task) => (
                            <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, opacity: 0.85 }}>{task.title} ({task.status})</span>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {task.status === 'backlog' && <button onClick={() => transitionTask(task.id, 'in_progress')} style={{ borderRadius: 6 }}>Start</button>}
                                    {task.status === 'in_progress' && <button onClick={() => transitionTask(task.id, 'blocked')} style={{ borderRadius: 6 }}>Block</button>}
                                    {task.status === 'in_progress' && <button onClick={() => transitionTask(task.id, 'review')} style={{ borderRadius: 6 }}>Review</button>}
                                    {task.status === 'blocked' && <button onClick={() => transitionTask(task.id, 'in_progress')} style={{ borderRadius: 6 }}>Resume</button>}
                                    {task.status === 'review' && <button onClick={() => transitionTask(task.id, 'done')} style={{ borderRadius: 6 }}>Done</button>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', maxHeight: 180, overflowY: 'auto' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Pending Approvals ({pendingApprovals.length})</div>
                    {pendingApprovals.length === 0 && <div style={{ opacity: 0.7 }}>No pending approvals.</div>}
                    {pendingApprovals.map((req) => (
                        <div key={req.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ fontWeight: 700 }}>{req.requestedByName} {req.isMajor ? '🛂' : ''}</div>
                            <div style={{ opacity: 0.85 }}>{req.requestedAction}</div>
                            <div style={{ fontSize: 11, opacity: 0.7, margin: '2px 0 6px' }}>{req.rationale}</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => decide(req.id, 'approved')}>✅ Approve</button>
                                <button onClick={() => decide(req.id, 'rejected')}>❌ Reject</button>
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', maxHeight: 120, overflowY: 'auto' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Completed Outputs</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>{reviewFolder}</div>
                    {completedWork.length === 0 && <div style={{ opacity: 0.7 }}>No completed outputs yet.</div>}
                    {completedWork.slice(0, 6).map((item) => (
                        <div key={item.id} style={{ marginBottom: 5 }}>
                            <div>{item.task}</div>
                            <div style={{ fontSize: 11, opacity: 0.72 }}>{item.agentName} · {new Date(item.completedAt).toLocaleString()}</div>
                            <div style={{ fontSize: 11, color: '#9cc8ff' }}>{item.summaryPath}</div>
                        </div>
                    ))}
                </div>
            </div>
        </FloatingPanel>
    );
}

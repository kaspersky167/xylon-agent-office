import React, { useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';
import { FloatingPanel } from './FloatingPanel';

type TaskItem = {
    id: number | string;
    title: string;
    assigned_to?: string;
    status: string;
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
    const [completedWork, setCompletedWork] = useState<CompletedWorkItem[]>([]);
    const [reviewFolder, setReviewFolder] = useState('data/workspace/completed-work');
    const [panelPulse, setPanelPulse] = useState(false);
    const tasksSectionRef = useRef<HTMLDivElement>(null);
    const approvalsSectionRef = useRef<HTMLDivElement>(null);
    const activitySectionRef = useRef<HTMLDivElement>(null);

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
                    status: data.status || 'pending',
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
                status: task.status || 'pending',
                progress: typeof task.progress === 'number' ? task.progress : undefined
            })));
        };
        const onApprovals = (event: Event) => {
            const list = (event as CustomEvent).detail;
            setApprovals(Array.isArray(list) ? list : []);
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
        const onOpenContext = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            if (detail.panel && detail.panel !== 'ceo-operations') return;
            setPanelPulse(true);
            window.setTimeout(() => setPanelPulse(false), 700);
            const section = detail.section;
            if (section === 'approvals') {
                approvalsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }
            if (section === 'tasks') {
                tasksSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }
            activitySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };

        eventBus.addEventListener('task-update', onTaskUpdate);
        eventBus.addEventListener('tasks-sync', onTasksSync);
        eventBus.addEventListener('approvals-sync', onApprovals);
        eventBus.addEventListener('meeting-state', onMeeting);
        eventBus.addEventListener('fast-track-state', onFastTrack);
        eventBus.addEventListener('completed-work-sync', onCompletedWork);
        eventBus.addEventListener('open-context-panel', onOpenContext);

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
            eventBus.removeEventListener('meeting-state', onMeeting);
            eventBus.removeEventListener('fast-track-state', onFastTrack);
            eventBus.removeEventListener('completed-work-sync', onCompletedWork);
            eventBus.removeEventListener('open-context-panel', onOpenContext);
        };
    }, []);

    const metrics = useMemo(() => {
        const total = tasks.length;
        const completed = tasks.filter((t) => t.status === 'completed').length;
        const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
        const pending = tasks.filter((t) => t.status !== 'completed' && t.status !== 'in_progress').length;
        return { total, completed, inProgress, pending, completionPct: total === 0 ? 0 : Math.round((completed / total) * 100) };
    }, [tasks]);

    const pendingApprovals = approvals.filter((a) => a.status === 'pending');

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
                <div
                    ref={activitySectionRef}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 6,
                        border: panelPulse ? '1px solid rgba(108,92,231,0.75)' : '1px solid transparent',
                        borderRadius: 8,
                        padding: 3
                    }}
                >
                    <button onClick={toggleFastTrack} style={{ borderRadius: 6 }}>{fastTrackEnabled ? '⚡ Fast-track ON' : '🧭 Fast-track OFF'}</button>
                    {meeting?.active
                        ? <button onClick={endMeeting} style={{ borderRadius: 6 }}>🔚 End Meeting</button>
                        : <button onClick={callMeeting} style={{ borderRadius: 6 }}>📣 Call Meeting</button>}
                </div>

                <div ref={tasksSectionRef} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Task Assignment</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                        <select value={targetAgent} onChange={(e) => setTargetAgent(e.target.value)}>
                            <option value="auto">Auto-assign</option>
                            <option value="frontend">Frontend</option>
                            <option value="backend">Backend</option>
                            <option value="devops">DevOps</option>
                            <option value="security">Security</option>
                            <option value="shepherd">Shepherd</option>
                            <option value="reality">Reality</option>
                            <option value="evidence">Evidence</option>
                            <option value="seo">SEO</option>
                            <option value="sales">Sales</option>
                            <option value="proposal">Proposal</option>
                        </select>
                        <button onClick={assignTask}>Assign</button>
                        <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Define work item..." style={{ gridColumn: '1 / -1' }} />
                    </div>
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Progress</div>
                    <div>Total: <strong>{metrics.total}</strong> · Completed: <strong style={{ color: '#55efc4' }}>{metrics.completed}</strong> · In progress: <strong>{metrics.inProgress}</strong> · Pending: <strong>{metrics.pending}</strong></div>
                    <div style={{ marginTop: 4 }}>Completion: <strong>{metrics.completionPct}%</strong></div>
                </div>

                <div ref={approvalsSectionRef} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', maxHeight: 180, overflowY: 'auto' }}>
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

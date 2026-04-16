import React, { useEffect, useMemo, useState } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';

interface TaskItem {
    id: number | string;
    title: string;
    assigned_to?: string;
    status: 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done';
    progress?: number;
}

interface ApprovalRequest {
    id: string;
    status: 'pending' | 'approved' | 'rejected';
}

interface HighlightEvent {
    type?: string;
    title?: string;
    body?: string;
    createdAt?: string;
}

interface ProjectMetrics {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
}

interface CompletedWorkItem {
    id: string;
    task: string;
    agentId: string;
    agentName: string;
    completedAt: string;
    summaryPath: string;
}

const priorityPattern = /\b(blocker|blocked|high[- ]?priority|urgent|risk|critical)\b/i;

export function ProjectProgressPanel() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
    const [priorityHighlights, setPriorityHighlights] = useState<HighlightEvent[]>([]);
    const [fastTrackEnabled, setFastTrackEnabled] = useState(true);
    const [completedWork, setCompletedWork] = useState<CompletedWorkItem[]>([]);
    const [reviewFolder, setReviewFolder] = useState('data/workspace/completed-work');

    useEffect(() => {
        const onTaskUpdate = (event: Event) => {
            const data = (event as CustomEvent).detail || {};
            if (!data?.task) return;
            setTasks((prev) => {
                const existing = prev.find((t) => t.title === data.task);
                if (existing) {
                    return prev.map((t) => (
                        t.title === data.task
                            ? {
                                ...t,
                                status: data.status,
                                assigned_to: data.agentId,
                                progress: typeof data.progress === 'number' ? data.progress : t.progress
                            }
                            : t
                    ));
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

        const onApprovalsSync = (event: Event) => {
            const list = (event as CustomEvent).detail;
            setApprovals(Array.isArray(list) ? list : []);
        };

        const onHighlight = (event: Event) => {
            const detail = ((event as CustomEvent).detail || {}) as HighlightEvent;
            const haystack = `${detail.type || ''} ${detail.title || ''} ${detail.body || ''}`;
            if (!priorityPattern.test(haystack)) return;
            setPriorityHighlights((prev) => [detail, ...prev].slice(0, 5));
        };

        const onFastTrackState = (event: Event) => {
            setFastTrackEnabled(Boolean((event as CustomEvent).detail?.enabled));
        };

        const onCompletedWork = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            setCompletedWork(Array.isArray(detail.items) ? detail.items : []);
            if (typeof detail.reviewFolder === 'string' && detail.reviewFolder.trim()) {
                setReviewFolder(detail.reviewFolder.trim());
            }
        };

        eventBus.addEventListener('task-update', onTaskUpdate);
        eventBus.addEventListener('tasks-sync', onTasksSync);
        eventBus.addEventListener('approvals-sync', onApprovalsSync);
        eventBus.addEventListener('highlight-event', onHighlight);
        eventBus.addEventListener('fast-track-state', onFastTrackState);
        eventBus.addEventListener('completed-work-sync', onCompletedWork);

        return () => {
            eventBus.removeEventListener('task-update', onTaskUpdate);
            eventBus.removeEventListener('tasks-sync', onTasksSync);
            eventBus.removeEventListener('approvals-sync', onApprovalsSync);
            eventBus.removeEventListener('highlight-event', onHighlight);
            eventBus.removeEventListener('fast-track-state', onFastTrackState);
            eventBus.removeEventListener('completed-work-sync', onCompletedWork);
        };
    }, []);

    const metrics = useMemo<ProjectMetrics>(() => {
        const total = tasks.length;
        const completed = tasks.filter((task) => task.status === 'done').length;
        const inProgress = tasks.filter((task) => task.status === 'in_progress').length;
        const pending = tasks.filter((task) => task.status === 'backlog').length;
        return { total, completed, inProgress, pending };
    }, [tasks]);

    const completionPct = metrics.total === 0 ? 0 : Math.round((metrics.completed / metrics.total) * 100);
    const pendingApprovals = approvals.filter((approval) => approval.status === 'pending').length;
    const activeTasks = tasks
        .filter((task) => task.status === 'in_progress')
        .slice(0, 3);

    const toggleFastTrack = () => {
        const next = !fastTrackEnabled;
        setFastTrackEnabled(next);
        const room = getColyseusRoom();
        room?.send('set-fast-track', { enabled: next });
    };

    return (
        <div style={{
            position: 'absolute',
            right: 20,
            top: 350,
            width: 320,
            backgroundColor: 'rgba(9, 20, 38, 0.92)',
            color: 'white',
            padding: 14,
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(52, 152, 219, 0.4)',
            zIndex: 10
        }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>
                📈 Project Progress
            </h3>
            <button
                type="button"
                onClick={toggleFastTrack}
                style={{
                    width: '100%',
                    marginBottom: 10,
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.25)',
                    background: fastTrackEnabled ? 'rgba(16,185,129,0.25)' : 'rgba(71,85,105,0.35)',
                    color: '#fff',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    fontSize: 11
                }}
            >
                {fastTrackEnabled ? '⚡ Fast-track ON (click to pause)' : '🧭 Fast-track OFF (click to accelerate)'}
            </button>

            <div style={{ fontSize: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Total tasks</span>
                    <strong>{metrics.total}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#55efc4' }}>
                    <span>Completed</span>
                    <strong>{metrics.completed}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ffeaa7' }}>
                    <span>In progress</span>
                    <strong>{metrics.inProgress}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dfe6e9' }}>
                    <span>Pending</span>
                    <strong>{metrics.pending}</strong>
                </div>
            </div>

            <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span>Completion</span>
                    <strong>{completionPct}%</strong>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                    <div style={{
                        width: `${completionPct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #00b894, #55efc4)'
                    }} />
                </div>
            </div>

            <div style={{
                fontSize: 12,
                marginBottom: 10,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'rgba(231,76,60,0.12)',
                border: '1px solid rgba(231,76,60,0.35)'
            }}>
                🛂 Pending CEO approvals: <strong>{pendingApprovals}</strong>
            </div>

            <div style={{ fontSize: 11, marginBottom: 10 }}>
                <div style={{ marginBottom: 6, color: '#9cc8ff', fontWeight: 700 }}>
                    Active task progress
                </div>
                {activeTasks.length === 0 && (
                    <div style={{ color: '#8ca4d6' }}>No active tasks right now.</div>
                )}
                {activeTasks.map((task) => {
                    const pct = Math.round(Math.max(0, Math.min(1, task.progress ?? 0)) * 100);
                    return (
                        <div key={`${task.id}-${task.title}`} style={{ marginBottom: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {task.title}
                                </span>
                                <strong>{pct}%</strong>
                            </div>
                            <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: '#74b9ff' }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            <div style={{ fontSize: 11 }}>
                <div style={{ marginBottom: 6, color: '#9cc8ff', fontWeight: 700 }}>
                    Recent blockers / high-priority highlights
                </div>
                {priorityHighlights.length === 0 && (
                    <div style={{ color: '#8ca4d6' }}>No blockers or urgent highlights yet.</div>
                )}
                {priorityHighlights.map((item, idx) => (
                    <div key={`${item.title || 'highlight'}-${idx}`} style={{
                        marginBottom: 6,
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.06)'
                    }}>
                        <div style={{ fontWeight: 700, fontSize: 11 }}>{item.title || 'Priority event'}</div>
                        <div style={{ color: '#d4def2', marginTop: 2 }}>{item.body || item.type || 'No details provided.'}</div>
                    </div>
                ))}
            </div>

            <div style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid rgba(255,255,255,0.12)',
                fontSize: 11
            }}>
                <div style={{ marginBottom: 6, color: '#9cc8ff', fontWeight: 700 }}>
                    Completed work snapshots ({completedWork.length})
                </div>
                <div style={{ color: '#8ca4d6', marginBottom: 6 }}>
                    Review folder: <code>{reviewFolder}</code>
                </div>
                {completedWork.length === 0 && (
                    <div style={{ color: '#8ca4d6' }}>No completed deliverables exported yet.</div>
                )}
                {completedWork.slice(0, 3).map((item) => (
                    <div key={item.id} style={{
                        marginBottom: 6,
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.06)'
                    }}>
                        <div style={{ fontWeight: 700, fontSize: 11 }}>{item.task}</div>
                        <div style={{ color: '#d4def2', marginTop: 2 }}>
                            {item.agentName} · {new Date(item.completedAt).toLocaleString()}
                        </div>
                        <div style={{ color: '#9cc8ff', marginTop: 2 }}>{item.summaryPath}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

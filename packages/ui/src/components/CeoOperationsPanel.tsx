import React, { useMemo, useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { useUIStore } from '../store/uiStore';

export function CeoOperationsPanel() {
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');
    const { state, filteredTasks, actions } = useUIStore();
    const { approvals, simulation, completedWork, reviewFolder, filters } = state;

    const metrics = useMemo(() => {
        const total = filteredTasks.length;
        const completed = filteredTasks.filter((t) => t.status === 'completed').length;
        const inProgress = filteredTasks.filter((t) => t.status === 'in_progress').length;
        const pending = filteredTasks.filter((t) => t.status !== 'completed' && t.status !== 'in_progress').length;
        return { total, completed, inProgress, pending, completionPct: total === 0 ? 0 : Math.round((completed / total) * 100) };
    }, [filteredTasks]);

    const pendingApprovals = approvals.filter((a) => a.status === 'pending');

    const assignTask = () => {
        if (!newTask.trim()) return;
        actions.sendTaskAssignment(newTask, targetAgent === 'auto' ? undefined : targetAgent);
        setNewTask('');
    };

    const decide = (id: string, decision: 'approved' | 'rejected') => {
        actions.sendApprovalDecision(id, decision);
    };

    const toggleFastTrack = () => {
        actions.setFastTrack(!simulation.fastTrackEnabled);
    };

    const callMeeting = () => {
        const topic = window.prompt('Meeting topic?', 'Daily executive sync') || 'All-hands';
        actions.callMeeting(topic, 60);
    };

    const endMeeting = () => {
        actions.endMeeting();
    };

    return (
        <FloatingPanel id="ceo-operations" title="CEO Operations" subtitle="Tasks · Progress · Approvals" width={360} defaultDock="right" defaultY={20} zIndex={26}>
            <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button onClick={toggleFastTrack} style={{ borderRadius: 6 }}>{simulation.fastTrackEnabled ? '⚡ Fast-track ON' : '🧭 Fast-track OFF'}</button>
                    {simulation.meeting?.active
                        ? <button onClick={endMeeting} style={{ borderRadius: 6 }}>🔚 End Meeting</button>
                        : <button onClick={callMeeting} style={{ borderRadius: 6 }}>📣 Call Meeting</button>}
                </div>

                <div style={{ display: 'grid', gap: 6, padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div style={{ fontWeight: 700 }}>Filters</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <select value={filters.taskStatus} onChange={(e) => actions.setFilters({ taskStatus: e.target.value as any })}>
                            <option value="all">All statuses</option>
                            <option value="pending">Pending</option>
                            <option value="in_progress">In progress</option>
                            <option value="completed">Completed</option>
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={filters.approvalsOnly} onChange={(e) => actions.setFilters({ approvalsOnly: e.target.checked })} />
                            CEO-gated only
                        </label>
                    </div>
                    <input value={filters.search} onChange={(e) => actions.setFilters({ search: e.target.value })} placeholder="Search tasks..." />
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
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

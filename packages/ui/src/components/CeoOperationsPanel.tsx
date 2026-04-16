import React, { useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { useUIStore } from '../store/uiStore';

export function CeoOperationsPanel() {
    const { state, filteredTasks, actions } = useUIStore();
    const { approvals, simulation } = state;
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');

    const pendingApprovals = approvals.filter((a) => a.status === 'pending');

    return (
        <FloatingPanel id="ceo-operations" title="CEO Operations" subtitle="Tasks · Progress · Approvals" width={360} defaultDock="right" defaultY={20} zIndex={26}>
            <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button onClick={() => actions.setFastTrack(!simulation.fastTrackEnabled)} style={{ borderRadius: 6 }}>
                        {simulation.fastTrackEnabled ? '⚡ Fast-track ON' : '🧭 Fast-track OFF'}
                    </button>
                    {simulation.meeting?.active
                        ? <button onClick={actions.endMeeting} style={{ borderRadius: 6 }}>🔚 End Meeting</button>
                        : <button onClick={() => actions.callMeeting('Daily executive sync', 60)} style={{ borderRadius: 6 }}>📣 Call Meeting</button>}
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Task Assignment</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                        <select value={targetAgent} onChange={(e) => setTargetAgent(e.target.value)}>
                            <option value="auto">Auto-assign</option>
                            {Object.values(state.agents).map((agent) => (
                                <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                        </select>
                        <button onClick={() => {
                            if (!newTask.trim()) return;
                            actions.sendTaskAssignment(newTask, targetAgent === 'auto' ? undefined : targetAgent);
                            setNewTask('');
                        }}>Assign</button>
                        <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Define work item..." style={{ gridColumn: '1 / -1' }} />
                    </div>
                </div>

                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', maxHeight: 150, overflowY: 'auto' }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Tasks ({filteredTasks.length})</div>
                    {filteredTasks.slice(0, 8).map((task) => (
                        <div key={task.id} style={{ fontSize: 11, opacity: 0.85 }}>{task.title} ({task.status})</div>
                    ))}
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
                                <button onClick={() => actions.sendApprovalDecision(req.id, 'approved')}>✅ Approve</button>
                                <button onClick={() => actions.sendApprovalDecision(req.id, 'rejected')}>❌ Reject</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </FloatingPanel>
    );
}

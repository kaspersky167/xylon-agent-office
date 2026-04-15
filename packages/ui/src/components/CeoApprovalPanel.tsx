import React, { useEffect, useState } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';

interface ApprovalRequest {
    id: string;
    requestedBy: string;
    requestedByName: string;
    requestedAction: string;
    rationale: string;
    isMajor: boolean;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
    fileContext?: {
        fileId: string;
        filePath: string;
        fileName: string;
        sharedByAgentId: string;
        sharedByAgentName: string;
        summaryNote: string;
    } | null;
}

export function CeoApprovalPanel() {
    const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
    const [meeting, setMeeting] = useState<{ active: boolean; topic?: string; endsAt?: number } | null>(null);

    useEffect(() => {
        const handler = (e: any) => {
            const list = Array.isArray(e.detail) ? e.detail : [];
            setApprovals(list);
        };
        eventBus.addEventListener('approvals-sync', handler);
        const meetingHandler = (e: any) => setMeeting(e.detail || null);
        eventBus.addEventListener('meeting-state', meetingHandler);

        // Ask server for the current queue once the room is available.
        const tryRequest = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                room.send('request-approvals', {});
                clearInterval(tryRequest);
            }
        }, 500);

        return () => {
            eventBus.removeEventListener('approvals-sync', handler);
            eventBus.removeEventListener('meeting-state', meetingHandler);
            clearInterval(tryRequest);
        };
    }, []);

    const decide = (id: string, decision: 'approved' | 'rejected') => {
        const room = getColyseusRoom();
        if (room) room.send('approval-decision', { id, decision });
    };

    const callMeeting = () => {
        const room = getColyseusRoom();
        if (!room) return;
        const topic = window.prompt('Meeting topic?', 'Weekly sync') || 'All-hands';
        const durRaw = window.prompt('Meeting duration in seconds (10–600)?', '60');
        const durationSec = Math.max(10, Math.min(600, parseInt(durRaw || '60', 10) || 60));
        room.send('call-meeting', { topic, durationSec });
    };

    const endMeeting = () => {
        const room = getColyseusRoom();
        if (room) room.send('end-meeting', {});
    };

    const pending = approvals.filter(a => a.status === 'pending');

    return (
        <div style={{
            position: 'absolute', right: 20, top: 20, width: 320,
            backgroundColor: 'rgba(20,10,30,0.92)', color: 'white',
            padding: 14, borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(231,76,60,0.4)',
            maxHeight: '45vh', display: 'flex', flexDirection: 'column', zIndex: 10
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>
                    🛂 CEO Approvals {pending.length > 0 && <span style={{ color: '#ff6b6b' }}>({pending.length})</span>}
                </h3>
                <div style={{ display: 'flex', gap: 4 }}>
                    {meeting?.active ? (
                        <button onClick={endMeeting} style={{
                            padding: '4px 10px', borderRadius: 4, border: 'none',
                            background: '#e74c3c', color: 'white', fontSize: 11, cursor: 'pointer', fontWeight: 'bold'
                        }}>🔚 End Meeting</button>
                    ) : (
                        <button onClick={callMeeting} style={{
                            padding: '4px 10px', borderRadius: 4, border: 'none',
                            background: '#6c5ce7', color: 'white', fontSize: 11, cursor: 'pointer', fontWeight: 'bold'
                        }}>📣 Call Meeting</button>
                    )}
                </div>
            </div>
            {meeting?.active && (
                <div style={{
                    fontSize: 11, color: '#fdcb6e', marginBottom: 6, padding: '4px 6px',
                    background: 'rgba(253,203,110,0.08)', borderRadius: 4
                }}>
                    📣 Meeting in progress: <strong>{meeting.topic}</strong>
                </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
                {approvals.length === 0 && (
                    <p style={{ color: '#888', fontStyle: 'italic', margin: 0, fontSize: 11 }}>
                        No approval requests. Major decisions from agents will appear here.
                    </p>
                )}
                {approvals.map(req => (
                    <div key={req.id} style={{
                        padding: 8, marginBottom: 6, borderRadius: 6,
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        borderLeft: `3px solid ${
                            req.status === 'pending' ? '#fdcb6e'
                                : req.status === 'approved' ? '#00b894' : '#e74c3c'
                        }`
                    }}>
                        <div style={{ fontSize: 11, color: '#aaa' }}>
                            <strong style={{ color: '#fff' }}>{req.requestedByName}</strong>
                            {req.isMajor && <span style={{ marginLeft: 6, color: '#ff6b6b' }}>[MAJOR]</span>}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 'bold', margin: '2px 0' }}>{req.requestedAction}</div>
                        <div style={{ fontSize: 11, color: '#ccc', marginBottom: 6 }}>{req.rationale}</div>
                        {req.fileContext && (
                            <div style={{
                                marginBottom: 6,
                                padding: 6,
                                borderRadius: 4,
                                background: 'rgba(108, 92, 231, 0.15)',
                                border: '1px solid rgba(108, 92, 231, 0.35)',
                                fontSize: 11
                            }}>
                                <div><strong>File:</strong> {req.fileContext.fileName}</div>
                                <div style={{ color: '#b2bec3' }}><strong>Path:</strong> {req.fileContext.filePath}</div>
                                <div><strong>Shared by:</strong> {req.fileContext.sharedByAgentName}</div>
                                <div style={{ color: '#dfe6e9', marginTop: 2 }}><strong>Summary:</strong> {req.fileContext.summaryNote}</div>
                                <a
                                    href={`vscode://file/${encodeURI(req.fileContext.filePath)}`}
                                    style={{ color: '#74b9ff', textDecoration: 'underline', marginTop: 4, display: 'inline-block' }}
                                    title="Quick-open in VS Code"
                                >
                                    🔎 Quick open
                                </a>
                            </div>
                        )}
                        {req.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => decide(req.id, 'approved')} style={{
                                    flex: 1, padding: '5px 8px', borderRadius: 4, border: 'none',
                                    background: '#00b894', color: 'white', fontSize: 11, cursor: 'pointer', fontWeight: 'bold'
                                }}>✅ Approve</button>
                                <button onClick={() => decide(req.id, 'rejected')} style={{
                                    flex: 1, padding: '5px 8px', borderRadius: 4, border: 'none',
                                    background: '#e74c3c', color: 'white', fontSize: 11, cursor: 'pointer', fontWeight: 'bold'
                                }}>❌ Reject</button>
                            </div>
                        ) : (
                            <div style={{ fontSize: 11, color: req.status === 'approved' ? '#00b894' : '#e74c3c' }}>
                                {req.status === 'approved' ? '✅ Approved' : '❌ Rejected'}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

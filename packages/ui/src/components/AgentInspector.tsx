import React from 'react';

export type InspectorActionEntry = {
    action: string;
    thought: string;
    time: string;
};

export type InspectorAgent = {
    id: string;
    name: string;
    role: string;
    team: string;
    division: string;
    status: string;
    currentTask: string;
    mood: number;
    riskLevel: number;
    momentum: number;
    reputation: number;
    recentActions: InspectorActionEntry[];
    collaborationPartners: string[];
    buddy: string;
    autonomyPaused: boolean;
};

type AgentInspectorProps = {
    agent: InspectorAgent | null;
    onAction?: (actionType: string, agent: InspectorAgent) => void;
};

function pct(value: number): string {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '6px 8px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(108,92,231,0.28)',
                color: 'white',
                fontSize: 11,
                cursor: 'pointer'
            }}
        >
            {label}
        </button>
    );
}

export function AgentInspector({ agent, onAction }: AgentInspectorProps) {
    if (!agent) {
        return (
            <div style={{ position: 'absolute', right: 20, top: 20, width: 300, backgroundColor: 'rgba(0,0,0,0.82)', color: 'white', padding: 16, borderRadius: 10, border: '1px solid rgba(108,92,231,0.3)' }}>
                <h3 style={{ margin: '0 0 8px 0' }}>Inspector</h3>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>Select an agent in the map to inspect details.</p>
            </div>
        );
    }

    return (
        <div style={{ position: 'absolute', right: 20, top: 20, width: 320, backgroundColor: 'rgba(0,0,0,0.86)', color: 'white', padding: 16, borderRadius: 10, border: '1px solid rgba(108,92,231,0.3)', zIndex: 18 }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Inspector: {agent.name}</h3>

            <div style={{ fontSize: '12px', display: 'grid', gap: 4 }}>
                <p style={{ margin: 0 }}><strong>Role:</strong> {agent.role}</p>
                <p style={{ margin: 0 }}><strong>Team / Division:</strong> {agent.team} / {agent.division}</p>
                <p style={{ margin: 0 }}><strong>Status:</strong> {agent.status}</p>
                <p style={{ margin: 0 }}><strong>Current Task:</strong> {agent.currentTask}</p>
            </div>

            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 11, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <div>Mood: {pct(agent.mood)}</div>
                <div>Risk: {pct(agent.riskLevel)}</div>
                <div>Momentum: {pct(agent.momentum)}</div>
                <div>Reputation: {pct(agent.reputation)}</div>
            </div>

            <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Recent Actions</div>
                {agent.recentActions.length === 0 && (
                    <div style={{ fontSize: 11, color: '#a3b3d4' }}>No recent activity yet.</div>
                )}
                {agent.recentActions.map((entry, idx) => (
                    <div key={`${entry.time}-${idx}`} style={{ fontSize: 10, marginBottom: 3, color: '#d6dcff' }}>
                        {entry.time} · {entry.action}{entry.thought ? ` — ${entry.thought}` : ''}
                    </div>
                ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 11 }}>
                <div><strong>Collaboration partners:</strong> {agent.collaborationPartners.length ? agent.collaborationPartners.join(', ') : 'None yet'}</div>
                <div><strong>Buddy:</strong> {agent.buddy}</div>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <ActionButton label="Assign task" onClick={() => onAction?.('assign-task', agent)} />
                <ActionButton label="Send message" onClick={() => onAction?.('send-message', agent)} />
                <ActionButton label="Request update" onClick={() => onAction?.('request-update', agent)} />
                <ActionButton label="Focus camera" onClick={() => onAction?.('focus-camera', agent)} />
                <ActionButton
                    label={agent.autonomyPaused ? 'Resume autonomy' : 'Pause autonomy'}
                    onClick={() => onAction?.('toggle-autonomy', agent)}
                />
            </div>
        </div>
    );
}

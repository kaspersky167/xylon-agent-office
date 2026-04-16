import React from 'react';

export function AgentInspector({ agent, mode = 'floating' }: { agent?: any; mode?: 'floating' | 'docked' }) {
    if (!agent) return null;
    return (
        <div style={{ position: mode === 'floating' ? 'absolute' : 'relative', right: mode === 'floating' ? 20 : undefined, top: mode === 'floating' ? 20 : undefined, width: mode === 'floating' ? 250 : '100%', backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: 16, borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Inspector: {agent.name}</h3>
            <div style={{ fontSize: '14px' }}>
                <p style={{ margin: '4px 0' }}><strong>Role:</strong> {agent.role}</p>
                <p style={{ margin: '4px 0' }}><strong>Status:</strong> {agent.status}</p>
                <p style={{ margin: '4px 0' }}><strong>Current Task:</strong> {agent.currentTask || 'None'}</p>
            </div>
        </div>
    );
}

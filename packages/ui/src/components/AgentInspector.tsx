import React from 'react';
import { FloatingPanel } from './FloatingPanel';
import { useUIStore } from '../store/uiStore';

export function AgentInspector() {
    const { selectedAgent } = useUIStore();
    if (!selectedAgent) return null;

    return (
        <FloatingPanel id="agent-inspector" title={`Inspector: ${selectedAgent.name}`} subtitle="Live agent snapshot" width={280} defaultDock="right" defaultY={420}>
            <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
                <div><strong>Role:</strong> {selectedAgent.role || 'Unknown'}</div>
                <div><strong>Status:</strong> {selectedAgent.status || 'Idle'}</div>
                <div><strong>Current Task:</strong> {selectedAgent.currentTask || 'None'}</div>
                <div><strong>Mood:</strong> {selectedAgent.mood}</div>
                <div><strong>Momentum:</strong> {selectedAgent.momentum}</div>
            </div>
        </FloatingPanel>
    );
}

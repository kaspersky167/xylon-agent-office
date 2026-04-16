import React, { useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { AgentInspector } from './components/AgentInspector';
import { LayoutEditor } from './components/LayoutEditor';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { HighlightsFeed } from './components/HighlightsFeed';
import { AgentPulseBoard } from './components/AgentPulseBoard';
import { RelationshipGraph } from './components/RelationshipGraph';
import { EpisodeRecapPanel } from './components/EpisodeRecapPanel';
import { DesktopComputerPanel } from './components/DesktopComputerPanel';
import { CeoOperationsPanel } from './components/CeoOperationsPanel';

export function App() {
    const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);
    const [layoutMode, setLayoutMode] = useState<'focus' | 'full'>('focus');

    return (
        <>
            <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white', backgroundColor: 'rgba(10,10,30,0.85)', padding: '12px 16px', borderRadius: '10px', zIndex: 10, border: '1px solid rgba(108,92,231,0.3)' }}>
                <h1 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: 8 }}>🏢 Xylon Devs HQ</h1>
                <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: '11px' }}>10 specialist agents + CEO · collaborative agency simulation</p>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button
                        onClick={() => setLayoutMode('focus')}
                        style={{ borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: layoutMode === 'focus' ? 'rgba(16,185,129,0.35)' : 'rgba(120, 165, 255, 0.18)', color: '#fff', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                        Focus Layout
                    </button>
                    <button
                        onClick={() => setLayoutMode('full')}
                        style={{ borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: layoutMode === 'full' ? 'rgba(168,85,247,0.35)' : 'rgba(120, 165, 255, 0.18)', color: '#fff', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                        Full Layout
                    </button>
                </div>
                <button
                    onClick={() => setDesktopPanelOpen((open) => !open)}
                    style={{ marginTop: 10, borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(120, 165, 255, 0.24)', color: '#fff', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                    {desktopPanelOpen ? 'Close Desk Computer' : 'Desk Computer'}
                </button>
            </div>
            <ChatPanel />
            {layoutMode === 'full' && <AgentInspector agent={{ name: 'Alice', role: 'Engineer', status: 'Idle', currentTask: 'Write Scaffold' }} />}
            {layoutMode === 'full' && <LayoutEditor />}
            {layoutMode === 'full' && <SystemLog />}
            <ViralControlPanel />
            <RelationshipGraph />
            {layoutMode === 'full' && <HighlightsFeed />}
            <AgentPulseBoard />
            {layoutMode === 'full' && <EpisodeRecapPanel />}
            <CeoOperationsPanel />
            <DesktopComputerPanel isOpen={desktopPanelOpen} onClose={() => setDesktopPanelOpen(false)} />
        </>
    );
}

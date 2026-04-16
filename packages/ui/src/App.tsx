import React, { useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { TaskBoard } from './components/TaskBoard';
import { AgentInspector } from './components/AgentInspector';
import { LayoutEditor } from './components/LayoutEditor';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { HighlightsFeed } from './components/HighlightsFeed';
import { AgentPulseBoard } from './components/AgentPulseBoard';
import { RelationshipGraph } from './components/RelationshipGraph';
import { EpisodeRecapPanel } from './components/EpisodeRecapPanel';
import { CeoApprovalPanel } from './components/CeoApprovalPanel';
import { ProjectProgressPanel } from './components/ProjectProgressPanel';
import { DesktopComputerPanel } from './components/DesktopComputerPanel';

export function App() {
    const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);

    return (
        <>
            <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white', backgroundColor: 'rgba(10,10,30,0.85)', padding: '12px 16px', borderRadius: '10px', zIndex: 10, border: '1px solid rgba(108,92,231,0.3)' }}>
                <h1 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: 8 }}>🏢 Xylon Devs HQ</h1>
                <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: '11px' }}>10 specialist agents + CEO · collaborative agency simulation</p>
                <button
                    onClick={() => setDesktopPanelOpen((open) => !open)}
                    style={{ marginTop: 10, borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(120, 165, 255, 0.24)', color: '#fff', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                    {desktopPanelOpen ? 'Close Desk Computer' : 'Desk Computer'}
                </button>
            </div>
            <ChatPanel />
            <TaskBoard />
            <AgentInspector />
            <LayoutEditor />
            <SystemLog />
            <ViralControlPanel />
            <RelationshipGraph />
            <HighlightsFeed />
            <AgentPulseBoard />
            <EpisodeRecapPanel />
            <CeoApprovalPanel />
            <ProjectProgressPanel />
            <DesktopComputerPanel isOpen={desktopPanelOpen} onClose={() => setDesktopPanelOpen(false)} />
        </>
    );
}

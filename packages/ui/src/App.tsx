import React from 'react';
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
import { DesktopComputerPanel } from './components/DesktopComputerPanel';
import { CeoOperationsPanel } from './components/CeoOperationsPanel';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { LayoutEditor } from './components/LayoutEditor';
import { AgentInspector } from './components/AgentInspector';
import { HighlightsFeed } from './components/HighlightsFeed';
import { UIStoreProvider, useUIStore } from './store/uiStore';

function AppContent() {
    const { state, actions } = useUIStore();
    const { panelVisibility } = state;

    return (
        <>
            <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white', backgroundColor: 'rgba(10,10,30,0.85)', padding: '12px 16px', borderRadius: '10px', zIndex: 10, border: '1px solid rgba(108,92,231,0.3)' }}>
                <h1 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: 8 }}>🏢 Xylon Devs HQ</h1>
                <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: '11px' }}>CEO Operations Mode · unified command center</p>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button
                        onClick={() => actions.togglePanel('advanced')}
                        style={{ borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: panelVisibility.advanced ? 'rgba(168,85,247,0.35)' : 'rgba(16,185,129,0.35)', color: '#fff', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                        {panelVisibility.advanced ? 'Hide Advanced Panels' : 'Show Advanced Panels'}
                    </button>
                </div>
                <button
                    onClick={() => actions.togglePanel('desktop')}
                    style={{ marginTop: 10, borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(120, 165, 255, 0.24)', color: '#fff', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                    {panelVisibility.desktop ? 'Close Desk Computer' : 'Desk Computer'}
                </button>
            </div>
            {panelVisibility.chat && <ChatPanel />}
            {panelVisibility.operations && <CeoOperationsPanel />}
            <DesktopComputerPanel isOpen={panelVisibility.desktop} onClose={() => actions.setPanelVisibility('desktop', false)} />

            {panelVisibility.advanced && panelVisibility.agentPulse && <AgentPulseBoard />}
            {panelVisibility.advanced && panelVisibility.relationship && <RelationshipGraph />}
            {panelVisibility.advanced && panelVisibility.recap && <EpisodeRecapPanel />}
            {panelVisibility.advanced && panelVisibility.systemLog && <SystemLog />}
            {panelVisibility.advanced && panelVisibility.viral && <ViralControlPanel />}
            {panelVisibility.advanced && panelVisibility.highlights && <HighlightsFeed />}
            {panelVisibility.advanced && panelVisibility.layoutEditor && <LayoutEditor />}
            {panelVisibility.advanced && panelVisibility.inspector && <AgentInspector />}
        </>
    );
}

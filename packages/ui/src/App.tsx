import React, { useEffect, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { AgentPulseBoard } from './components/AgentPulseBoard';
import { RelationshipGraph } from './components/RelationshipGraph';
import { EpisodeRecapPanel } from './components/EpisodeRecapPanel';
import { DesktopComputerPanel } from './components/DesktopComputerPanel';
import { CeoOperationsPanel } from './components/CeoOperationsPanel';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { HighlightsFeed } from './components/HighlightsFeed';
import { LayoutEditor } from './components/LayoutEditor';
import { AgentInspector } from './components/AgentInspector';
import { eventBus } from './events';

export function App() {
    const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);
    const [showAdvancedPanels, setShowAdvancedPanels] = useState(false);
    const [activeZone, setActiveZone] = useState<'main' | 'ceo_office'>('main');

    useEffect(() => {
        const onZoneState = (e: Event) => {
            const detail = (e as CustomEvent).detail as { zoneId?: 'main' | 'ceo_office' };
            setActiveZone(detail?.zoneId === 'ceo_office' ? 'ceo_office' : 'main');
        };
        eventBus.addEventListener('zone-state', onZoneState);
        return () => eventBus.removeEventListener('zone-state', onZoneState);
    }, []);

    const switchZone = (zoneId: 'main' | 'ceo_office', focus = false) => {
        eventBus.dispatchEvent(new CustomEvent('zone-switch', { detail: { zoneId, focus } }));
        setActiveZone(zoneId);
    };

    return (
        <>
            <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white', backgroundColor: 'rgba(10,10,30,0.85)', padding: '12px 16px', borderRadius: '10px', zIndex: 10, border: '1px solid rgba(108,92,231,0.3)' }}>
                <h1 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: 8 }}>🏢 Xylon Devs HQ</h1>
                <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: '11px' }}>CEO Operations Mode · unified command center</p>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button
                        onClick={() => setShowAdvancedPanels((prev) => !prev)}
                        style={{ borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: showAdvancedPanels ? 'rgba(168,85,247,0.35)' : 'rgba(16,185,129,0.35)', color: '#fff', padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                        {showAdvancedPanels ? 'Hide Advanced Panels' : 'Show Advanced Panels'}
                    </button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>Zone:</span>
                    <button
                        onClick={() => switchZone('main', true)}
                        style={{ borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: activeZone === 'main' ? 'rgba(56,189,248,0.35)' : 'rgba(255,255,255,0.08)', color: '#fff', padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                    >
                        Main Floor
                    </button>
                    <button
                        onClick={() => switchZone('ceo_office', true)}
                        style={{ borderRadius: 7, border: '1px solid rgba(255,255,255,0.25)', background: activeZone === 'ceo_office' ? 'rgba(251,113,133,0.35)' : 'rgba(255,255,255,0.08)', color: '#fff', padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                    >
                        CEO Office
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
            <CeoOperationsPanel />
            <DesktopComputerPanel isOpen={desktopPanelOpen} onClose={() => setDesktopPanelOpen(false)} />

            {showAdvancedPanels && <AgentPulseBoard />}
            {showAdvancedPanels && <RelationshipGraph />}
            {showAdvancedPanels && <EpisodeRecapPanel />}
            {showAdvancedPanels && <SystemLog />}
            {showAdvancedPanels && <ViralControlPanel />}
            {showAdvancedPanels && <HighlightsFeed />}
            {showAdvancedPanels && <LayoutEditor />}
            {showAdvancedPanels && <AgentInspector agent={{ name: 'Alice', role: 'Engineer', status: 'Idle', currentTask: 'Write Scaffold' }} />}
        </>
    );
}

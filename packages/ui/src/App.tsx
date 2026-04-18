import React, { Suspense } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { DesktopComputerPanel } from './components/DesktopComputerPanel';
import { CeoOperationsPanel } from './components/CeoOperationsPanel';
import { UIStoreProvider, useUIStore } from './store/uiStore';

const AgentInspector = React.lazy(() => import('./components/AgentInspector').then((module) => ({ default: module.AgentInspector })));
const LayoutEditor = React.lazy(() => import('./components/LayoutEditor').then((module) => ({ default: module.LayoutEditor })));
const SystemLog = React.lazy(() => import('./components/SystemLog').then((module) => ({ default: module.SystemLog })));
const DemoModePanels = React.lazy(() => import('./components/DemoModePanels').then((module) => ({ default: module.DemoModePanels })));

function AdvancedPanelFallback() {
    return (
        <div style={{ position: 'absolute', top: 18, right: 18, color: 'rgba(255,255,255,0.8)', background: 'rgba(9,14,30,0.78)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, padding: '8px 12px', fontSize: 12, zIndex: 30 }}>
            Loading advanced panels…
        </div>
    );
}

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

            {panelVisibility.advanced && (
                <Suspense fallback={<AdvancedPanelFallback />}>
                    {(panelVisibility.agentPulse || panelVisibility.relationship || panelVisibility.recap || panelVisibility.viral || panelVisibility.highlights) && (
                        <DemoModePanels
                            showAgentPulse={panelVisibility.agentPulse}
                            showHighlights={panelVisibility.highlights}
                            showRecap={panelVisibility.recap}
                            showRelationship={panelVisibility.relationship}
                            showViral={panelVisibility.viral}
                        />
                    )}
                    {panelVisibility.systemLog && <SystemLog />}
                    {panelVisibility.layoutEditor && <LayoutEditor />}
                    {panelVisibility.inspector && <AgentInspector />}
                </Suspense>
            )}
        </>
    );
}

export function App() {
    return (
        <UIStoreProvider>
            <AppContent />
        </UIStoreProvider>
    );
}

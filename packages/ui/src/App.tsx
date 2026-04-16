import React, { useState } from 'react';
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
import { AppShell, AppShellZone } from './layout/AppShell';
import './layout/app-shell.css';

export function App() {
    const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);

    return (
        <>
            <AppShell>
                <AppShellZone title="Top HUD" tone="hud">
                    <div className="app-shell-top-hud">
                        <div className="app-shell-brand">
                            <h1>🏢 Xylon Devs HQ</h1>
                            <p>CEO Operations Mode · unified command center</p>
                        </div>
                        <div className="app-shell-kpis">
                            <div className="app-shell-kpi">Agents Online<strong>11</strong></div>
                            <div className="app-shell-kpi">Pending Approvals<strong>Live</strong></div>
                            <div className="app-shell-kpi">Throughput<strong>Realtime</strong></div>
                        </div>
                        <div className="app-shell-actions">
                            <button
                                onClick={() => setDesktopPanelOpen((open) => !open)}
                                className="app-shell-btn"
                            >
                                {desktopPanelOpen ? 'Close Desk Computer' : 'Desk Computer'}
                            </button>
                        </div>
                    </div>
                </AppShellZone>

                <AppShellZone title="Operations Rail" tone="rail">
                    <CeoOperationsPanel mode="docked" />
                    <AgentPulseBoard mode="docked" />
                    <LayoutEditor mode="docked" />
                </AppShellZone>

                <AppShellZone title="Game Viewport" tone="viewport">
                    <div className="app-shell-viewport-card">
                        <div>
                            <strong>Live Office Simulation View</strong>
                            <div>The Phaser world remains active behind this viewport frame.</div>
                        </div>
                    </div>
                </AppShellZone>

                <AppShellZone title="Inspector" tone="inspector">
                    <AgentInspector mode="docked" agent={{ name: 'Alice', role: 'Engineer', status: 'Idle', currentTask: 'Write Scaffold' }} />
                    <RelationshipGraph mode="docked" />
                    <EpisodeRecapPanel mode="docked" />
                    <ViralControlPanel mode="docked" />
                </AppShellZone>

                <AppShellZone title="Event + Chat Drawer" tone="drawer">
                    <ChatPanel mode="docked" />
                    <SystemLog mode="docked" />
                    <HighlightsFeed mode="docked" />
                </AppShellZone>
            </AppShell>

            <DesktopComputerPanel isOpen={desktopPanelOpen} onClose={() => setDesktopPanelOpen(false)} />
        </>
    );
}

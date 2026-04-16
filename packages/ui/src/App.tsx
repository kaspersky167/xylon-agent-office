import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { AgentPulseBoard } from './components/AgentPulseBoard';
import { RelationshipGraph } from './components/RelationshipGraph';
import { EpisodeRecapPanel } from './components/EpisodeRecapPanel';
import { DesktopComputerPanel } from './components/DesktopComputerPanel';
import { CeoOperationsPanel } from './components/CeoOperationsPanel';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { LayoutEditor } from './components/LayoutEditor';
import { AgentInspector } from './components/AgentInspector';
import { TaskBoard } from './components/TaskBoard';

export function App() {
    const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);
    const [showAdvancedPanels, setShowAdvancedPanels] = useState(false);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [agentsById, setAgentsById] = useState<Record<string, AgentStateEvent>>({});
    const [activityByAgent, setActivityByAgent] = useState<Record<string, InspectorActionEntry[]>>({});
    const [edges, setEdges] = useState<RelationshipEdge[]>([]);
    const [pausedAgents, setPausedAgents] = useState<Record<string, boolean>>({});
    const agentsByIdRef = useRef<Record<string, AgentStateEvent>>({});
    const selectedAgentIdRef = useRef<string | null>(null);

    useEffect(() => {
        selectedAgentIdRef.current = selectedAgentId;
    }, [selectedAgentId]);

    useEffect(() => {
        const onAgentState = (e: Event) => {
            const detail = (e as CustomEvent).detail as AgentStateEvent;
            if (!detail?.id) return;
            setAgentsById((prev) => {
                const next = { ...prev, [detail.id]: detail };
                agentsByIdRef.current = next;
                return next;
            });
        };

        const onAgentRemoved = (e: Event) => {
            const detail = (e as CustomEvent).detail as { id?: string };
            if (!detail?.id) return;
            const agentId = detail.id;
            setAgentsById((prev) => {
                const next = { ...prev };
                delete next[agentId];
                agentsByIdRef.current = next;
                return next;
            });
            setPausedAgents((prev) => {
                const next = { ...prev };
                delete next[agentId];
                return next;
            });
            if (selectedAgentIdRef.current === agentId) {
                setSelectedAgentId(null);
            }
        };

        const onAgentSelected = (e: Event) => {
            const detail = (e as CustomEvent).detail as { id?: string } | null;
            setSelectedAgentId(detail?.id || null);
        };

        const onAgentFocus = (e: Event) => {
            const detail = (e as CustomEvent).detail as { id?: string } | null;
            setSelectedAgentId(detail?.id || null);
        };

        const onActivityLog = (e: Event) => {
            const detail = (e as CustomEvent).detail as { agent?: string; action?: string; thought?: string; time?: string };
            if (!detail?.agent || !detail?.action) return;
            const action = detail.action;

            const match = Object.values(agentsByIdRef.current).find((agent) => agent.name === detail.agent);
            if (!match?.id) return;

            setActivityByAgent((prev) => {
                const existing = prev[match.id] || [];
                const nextEntry: InspectorActionEntry = {
                    action,
                    thought: detail.thought || '',
                    time: detail.time || new Date().toLocaleTimeString()
                };
                return {
                    ...prev,
                    [match.id]: [nextEntry, ...existing].slice(0, 6)
                };
            });
        };

        const onRelationships = (e: Event) => {
            const detail = (e as CustomEvent).detail as { edges?: RelationshipEdge[] };
            setEdges(detail?.edges || []);
        };

        eventBus.addEventListener('agent-state', onAgentState);
        eventBus.addEventListener('agent-removed', onAgentRemoved);
        eventBus.addEventListener('agent-selected', onAgentSelected);
        eventBus.addEventListener('agent-focus', onAgentFocus);
        eventBus.addEventListener('activity-log', onActivityLog);
        eventBus.addEventListener('relationship-update', onRelationships);

        return () => {
            eventBus.removeEventListener('agent-state', onAgentState);
            eventBus.removeEventListener('agent-removed', onAgentRemoved);
            eventBus.removeEventListener('agent-selected', onAgentSelected);
            eventBus.removeEventListener('agent-focus', onAgentFocus);
            eventBus.removeEventListener('activity-log', onActivityLog);
            eventBus.removeEventListener('relationship-update', onRelationships);
        };
    }, []);

    const selectedAgent = useMemo<InspectorAgent | null>(() => {
        if (!selectedAgentId) return null;
        const state = agentsById[selectedAgentId];
        if (!state) return null;

        const identity = deriveIdentity(state.id, state.name);
        const partners = edges
            .filter((edge) => edge.a === state.id || edge.b === state.id)
            .map((edge) => {
                const isA = edge.a === state.id;
                const name = isA ? edge.bName : edge.aName;
                return `${name} (${edge.status})`;
            })
            .slice(0, 3);

        return {
            id: state.id,
            name: state.name,
            role: identity.role,
            team: identity.team,
            division: identity.division,
            status: normalizeStatus(state.action),
            currentTask: state.currentTask || 'No active task',
            mood: state.mood,
            riskLevel: state.riskLevel,
            momentum: state.momentum,
            reputation: state.reputation,
            recentActions: activityByAgent[state.id] || [],
            collaborationPartners: partners,
            buddy: `${identity.buddyRole} buddy`,
            autonomyPaused: Boolean(pausedAgents[state.id])
        };
    }, [selectedAgentId, agentsById, edges, activityByAgent, pausedAgents]);

    const handleAction = (actionType: string, agent: InspectorAgent) => {
        if (actionType === 'focus-camera') {
            eventBus.dispatchEvent(new CustomEvent('agent-focus', { detail: { id: agent.id, name: agent.name } }));
            setSelectedAgentId(agent.id);
            return;
        }

        if (actionType === 'toggle-autonomy') {
            setPausedAgents((prev) => ({ ...prev, [agent.id]: !prev[agent.id] }));
        }

        eventBus.dispatchEvent(new CustomEvent('inspector-action', {
            detail: {
                type: actionType,
                agentId: agent.id,
                agentName: agent.name,
                at: new Date().toISOString()
            }
        }));
    };

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

            {showAdvancedPanels && <TaskBoard />}
            {showAdvancedPanels && <AgentPulseBoard />}
            {showAdvancedPanels && <RelationshipGraph />}
            {showAdvancedPanels && <EpisodeRecapPanel />}
            {showAdvancedPanels && <SystemLog />}
            {showAdvancedPanels && <ViralControlPanel />}
            {showAdvancedPanels && <LayoutEditor />}
            {showAdvancedPanels && <AgentInspector agent={selectedAgent} onAction={handleAction} />}
        </>
    );
}

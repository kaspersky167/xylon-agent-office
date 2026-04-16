import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { AgentInspector, type InspectorAgent, type InspectorActionEntry } from './components/AgentInspector';
import { eventBus } from './events';

type AgentStateEvent = {
    id: string;
    name: string;
    action: string;
    currentTask: string;
    mood: number;
    reputation: number;
    riskLevel: number;
    momentum: number;
};

type RelationshipEdge = {
    a: string;
    b: string;
    aName: string;
    bName: string;
    score: number;
    status: 'alliance' | 'neutral' | 'rivalry';
};

type AgentIdentity = {
    role: string;
    team: string;
    division: string;
    buddyRole: string;
};

const ROLES = ['Engineer', 'Product Designer', 'Data Analyst', 'Growth Strategist', 'QA Specialist', 'Platform Ops'];
const TEAMS = ['Core Platform', 'Innovation Lab', 'Customer Ops', 'Revenue'];
const DIVISIONS = ['Delivery', 'Research', 'Enablement'];

function hashSeed(input: string): number {
    return Math.abs((input || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0));
}

function deriveIdentity(agentId: string, agentName: string): AgentIdentity {
    const seed = hashSeed(`${agentId}:${agentName}`);
    return {
        role: ROLES[seed % ROLES.length],
        team: TEAMS[seed % TEAMS.length],
        division: DIVISIONS[seed % DIVISIONS.length],
        buddyRole: ROLES[(seed + 2) % ROLES.length]
    };
}

function normalizeStatus(action: string): string {
    if (!action) return 'Idle';
    return action.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

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
            {showAdvancedPanels && <AgentInspector agent={selectedAgent} onAction={handleAction} />}
        </>
    );
}

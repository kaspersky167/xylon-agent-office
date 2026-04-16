import React, { useEffect, useMemo, useState } from 'react';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';
import { Stat } from './ui/Stat';
import { tokens } from '../theme/tokens';

type AgentPulse = {
    id: string;
    name: string;
    mood: number;
    reputation: number;
    riskLevel: number;
    momentum: number;
    action: string;
};

function pct(value: number): string {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function AgentPulseBoard({ mode = 'floating' }: { mode?: 'floating' | 'docked' }) {
    const [agents, setAgents] = useState<Record<string, AgentPulse>>({});

    useEffect(() => {
        const onTelemetry = (e: Event) => {
            const detail = (e as CustomEvent).detail as AgentPulse;
            if (!detail?.id) return;
            setAgents((prev) => ({ ...prev, [detail.id]: detail }));
        };

        eventBus.addEventListener('agent-telemetry', onTelemetry);
        return () => eventBus.removeEventListener('agent-telemetry', onTelemetry);
    }, []);

    const sortedAgents = useMemo(
        () => Object.values(agents).sort((a, b) => b.momentum - a.momentum),
        [agents]
    );

    return (
        <FloatingPanel
            id="agent-pulse"
            title="Agent Pulse"
            subtitle="Mood, risk, momentum"
            width={320}
            defaultDock="left"
            defaultY={420}
            zIndex={14}
            mode={mode}
        >
            {sortedAgents.length === 0 && (
                <div style={{ fontSize: tokens.typography.caption, color: tokens.color.textMuted }}>Waiting for live telemetry...</div>
            )}
            {sortedAgents.map((agent) => (
                <div key={agent.id} style={{ marginBottom: tokens.spacing.sm, paddingBottom: tokens.spacing.sm, borderBottom: `1px solid ${tokens.color.borderSoft}` }}>
                    <div style={{ fontSize: tokens.typography.body, fontWeight: 700 }}>
                        {agent.name} <span style={{ fontWeight: 400, color: tokens.color.textSecondary }}>({agent.action})</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
                        <Stat label="Mood" value={pct(agent.mood)} />
                        <Stat label="Reputation" value={pct(agent.reputation)} />
                        <Stat label="Risk" value={pct(agent.riskLevel)} />
                        <Stat label="Momentum" value={pct(agent.momentum)} />
                    </div>
                </div>
            ))}
        </FloatingPanel>
    );
}

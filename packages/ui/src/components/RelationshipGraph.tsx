import React, { useEffect, useMemo, useState } from 'react';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';
import { Chip } from './ui/Chip';
import { Toolbar } from './ui/Toolbar';
import { tokens } from '../theme/tokens';

type Edge = {
    a: string;
    b: string;
    aName: string;
    bName: string;
    score: number;
    status: 'alliance' | 'neutral' | 'rivalry';
    label?: string;
};

export function RelationshipGraph({ mode = 'floating' }: { mode?: 'floating' | 'docked' }) {
    const [edges, setEdges] = useState<Edge[]>([]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            setEdges((detail?.edges || []) as Edge[]);
        };
        eventBus.addEventListener('relationship-update', handler);
        return () => eventBus.removeEventListener('relationship-update', handler);
    }, []);

    const visible = useMemo(
        () => edges.filter((edge) => edge.status !== 'neutral').sort((a, b) => Math.abs(b.score) - Math.abs(a.score)),
        [edges]
    );

    return (
        <FloatingPanel
            id="relationship-graph"
            title="Relationship Graph"
            subtitle="0–100% = strength of collaboration/conflict"
            width={320}
            defaultDock="right"
            defaultY={220}
            zIndex={16}
            mode={mode}
        >
            {visible.length === 0 && (
                <div style={{ fontSize: tokens.typography.caption, color: tokens.color.textMuted }}>No strong alliances or rivalries yet.</div>
            )}
            {visible.map((edge, idx) => {
                const isAlliance = edge.status === 'alliance';
                return (
                    <div key={idx} style={{ marginBottom: tokens.spacing.sm, paddingBottom: tokens.spacing.sm, borderBottom: `1px solid ${tokens.color.borderSoft}` }}>
                        <div style={{ fontSize: tokens.typography.caption, fontWeight: 700, color: isAlliance ? tokens.color.success : tokens.color.danger }}>
                            {edge.aName} {isAlliance ? '🤝' : '⚔️'} {edge.bName}
                        </div>
                        <Toolbar style={{ marginTop: 4 }}>
                            <Chip tone={isAlliance ? 'success' : 'danger'}>{edge.status}</Chip>
                            <div style={{ fontSize: tokens.typography.micro, color: tokens.color.textSecondary }}>
                                {edge.label || edge.status} ({Math.round(Math.abs(edge.score) * 100)}%)
                            </div>
                        </Toolbar>
                    </div>
                );
            })}
        </FloatingPanel>
    );
}

import React from 'react';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { Stat } from './ui/Stat';
import { tokens } from '../theme/tokens';

export function AgentInspector({ agent }: { agent?: any }) {
    if (!agent) return null;

    return (
        <Panel style={{ position: 'absolute', right: 20, top: 20, width: 260 }}>
            <SectionHeader title={`Inspector: ${agent.name}`} subtitle="Live agent snapshot" />
            <div style={{ display: 'grid', gap: tokens.spacing.xs }}>
                <Stat label="Role" value={agent.role || 'Unknown'} />
                <Stat label="Status" value={agent.status || 'Idle'} />
                <Stat label="Current Task" value={agent.currentTask || 'None'} />
            </div>
        </Panel>
    );
}

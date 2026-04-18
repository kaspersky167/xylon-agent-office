import React from 'react';
import { ViralControlPanel } from './ViralControlPanel';
import { HighlightsFeed } from './HighlightsFeed';
import { AgentPulseBoard } from './AgentPulseBoard';
import { RelationshipGraph } from './RelationshipGraph';
import { EpisodeRecapPanel } from './EpisodeRecapPanel';

interface DemoModePanelsProps {
    showAgentPulse: boolean;
    showRelationship: boolean;
    showRecap: boolean;
    showViral: boolean;
    showHighlights: boolean;
}

export function DemoModePanels({
    showAgentPulse,
    showRelationship,
    showRecap,
    showViral,
    showHighlights
}: DemoModePanelsProps) {
    return (
        <>
            {showAgentPulse && <AgentPulseBoard />}
            {showRelationship && <RelationshipGraph />}
            {showRecap && <EpisodeRecapPanel />}
            {showViral && <ViralControlPanel />}
            {showHighlights && <HighlightsFeed />}
        </>
    );
}

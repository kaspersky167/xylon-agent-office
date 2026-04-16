export type Traits = {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
};

export type CapabilityDefinition = {
    name: string;
    description: string;
};

export type CommunicationStyle = 'technical' | 'casual' | 'creative' | 'formal';

export type AgentTemplate = {
    id: string;
    name: string;
    role: string;
    position: { x: number; y: number };
    systemPrompt: string;
    personality: {
        traits: Traits;
        communicationStyle: CommunicationStyle;
    };
    capabilities: CapabilityDefinition[];
    modelEnv?: string;
};

export type LayoutTarget = {
    x: number;
    y: number;
    type: string;
};

export type ScenarioAssignment = {
    id: string;
    task: string;
    inbox: string;
};

export type ScenarioScript = {
    id: string;
    aliases: string[];
    highlightTitle: string;
    project: string;
    kickoffChat: string;
    ceoBrief: string;
    assignments: ScenarioAssignment[];
};

export type OfficeTemplate = {
    id: string;
    organization: {
        name: string;
        description: string;
    };
    teams: Array<{
        id: string;
        name: string;
        members: string[];
    }>;
    capabilities: Record<string, CapabilityDefinition[]>;
    defaultAgents: AgentTemplate[];
    scenarios: {
        startupBroadcast: {
            sender: string;
            text: string;
        };
        scripts: Record<string, ScenarioScript>;
    };
    layout: {
        grid: { width: number; height: number; tileSize: number };
        spawnPoints: Array<{ x: number; y: number }>;
        furnitureTargets: Record<string, LayoutTarget>;
        deskBindings: Record<string, string>;
    };
};

export interface ExtensionApprovalRequestInput {
    requestedBy: string;
    requestedByName: string;
    requestedAction: string;
    rationale: string;
    isMajor: boolean;
    pending?: { toolName: string; params: any } | null;
}

export interface BeforeToolCallContext {
    agentId: string;
    agentName: string;
    toolName: string;
    params: any;
    thought?: string;
    requestApproval: (input: ExtensionApprovalRequestInput) => void;
    isMajorToolCall: (name: string, params: any) => boolean;
}

export interface BeforeToolCallResult {
    handled?: boolean;
}

export interface AfterToolCallContext {
    agentId: string;
    agentName: string;
    toolName: string;
    params: any;
    success: boolean;
    output: string;
    error?: string;
}

export interface TaskCreatedContext {
    title: string;
    assigneeId: string;
    assigneeName: string;
    createdById: string;
    createdByName: string;
    source: 'tool' | 'ui' | 'scenario';
}

export interface ApprovalRequestedContext {
    id: string;
    requestedBy: string;
    requestedByName: string;
    requestedAction: string;
    rationale: string;
    isMajor: boolean;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
}

export interface ScenarioStartContext {
    scenario: string;
    startedAt: string;
}

export interface OfficeExtension {
    name: string;
    beforeToolCall?: (context: BeforeToolCallContext) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;
    afterToolCall?: (context: AfterToolCallContext) => Promise<void> | void;
    onTaskCreated?: (context: TaskCreatedContext) => Promise<void> | void;
    onApprovalRequested?: (context: ApprovalRequestedContext) => Promise<void> | void;
    onScenarioStart?: (context: ScenarioStartContext) => Promise<void> | void;
}

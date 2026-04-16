import { OfficeExtension } from '../contracts';

const majorToolApprovalExtension: OfficeExtension = {
    name: 'major-tool-approval-gate',
    beforeToolCall(context) {
        if (context.agentId === 'ceo') return;
        if (!context.isMajorToolCall(context.toolName, context.params)) return;

        context.requestApproval({
            requestedBy: context.agentId,
            requestedByName: context.agentName,
            requestedAction: context.toolName,
            rationale: context.thought || 'No rationale provided — please supply more context.',
            isMajor: true,
            pending: { toolName: context.toolName, params: context.params },
        });

        return { handled: true };
    },
};

export default majorToolApprovalExtension;

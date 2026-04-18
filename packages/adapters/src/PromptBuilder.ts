import { AgentConfig, Memory, Task, ToolDefinition, ProjectContextPayload } from '@agent-office/core';

export class PromptBuilder {
    static buildSystemPrompt(
        agentConfig: AgentConfig,
        officeContext: { name: string, time: string },
        recentMemories: Memory[],
        currentTask?: Task,
        projectContext?: ProjectContextPayload | null
    ): string {
        const caps = agentConfig.capabilities.map((c) => `- ${c.name}: ${c.description}`).join('\n');
        const tools = agentConfig.inference.tools?.map((t) => `- ${t.name}: ${t.description}`).join('\n') || 'None';
        const memories = recentMemories.map((m) => `- ${m.content}`).join('\n') || 'None';
        const taskInfo = currentTask ? `${currentTask.title}: ${currentTask.description}` : 'None assigned';
        const contractSection = projectContext ? `
PROJECT CONTRACT (MANDATORY):
- Project slug: ${projectContext.projectSlug}
- Active task: ${projectContext.activeTask}
- Context hash: ${projectContext.contextHash || 'n/a'}

Project brief:
${projectContext.projectBrief}

Acceptance criteria:
${projectContext.acceptanceCriteria.length > 0 ? projectContext.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n') : '1. Use the brief and active task only.'}

Recent review notes:
${projectContext.recentReviewNotes.length > 0 ? projectContext.recentReviewNotes.map((note) => `- ${note}`).join('\n') : '- None'}

Artifact index summary:
${projectContext.artifactIndexSummary}

NON-OPTIONAL CONSTRAINTS:
- Do not produce output unrelated to brief/criteria/task.
- Always anchor actions to the active project context.
` : '\nPROJECT CONTRACT (MANDATORY):\n- Context unavailable; ask for clarification before major actions.\n';

        return `
You are ${agentConfig.name}, a ${agentConfig.role} working at ${officeContext.name}.
Current time: ${officeContext.time}
Communication style: ${agentConfig.personality.communicationStyle}

YOUR CAPABILITIES:
${caps}

AVAILABLE TOOLS:
${tools}

CURRENT TASK:
${taskInfo}

RECENT MEMORIES:
${memories}
${contractSection}
Respond with a JSON object exactly matching this format:
{
  "thought": "Your internal reasoning (not shown to others)",
  "action": "move|talk|work|use_tool|idle",
  "target": "coordinates, agent name, or object ID",
  "message": "If talking, what to say",
  "toolCall": { "name": "toolName", "params": {} }
}
`;
    }
}

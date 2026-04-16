export const AGENT_LABEL_COLORS = ['#60a5fa', '#c4b5fd', '#34d399', '#f472b6', '#f59e0b', '#f87171'];

export const AGENT_EMOTE_MAP: Record<string, string> = {
    work: '💻',
    talk: '💬',
    idle: '😌',
    use_tool: '🔧',
    move: '🚶',
    think: '💡'
};

export function getAgentStyle(idOrName: string) {
    const hash = Math.abs((idOrName || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0));
    return {
        hash,
        charKey: `char_${hash % 6}`,
        labelColor: AGENT_LABEL_COLORS[hash % AGENT_LABEL_COLORS.length]
    };
}

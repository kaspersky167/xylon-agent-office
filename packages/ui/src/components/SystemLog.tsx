import React, { useState, useEffect, useRef } from 'react';
import { eventBus } from '../events';
import { Button } from './ui/Button';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { controlRoomStyles, tokens } from '../theme/tokens';

interface LogEntry {
    id: number;
    agent: string;
    action: string;
    thought: string;
    time: string;
}

const actionIcons: Record<string, string> = {
    work: '💻', talk: '💬', idle: '😌',
    use_tool: '🔧', move: '🚶', think: '💡'
};

export function SystemLog() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isOpen, setIsOpen] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const idRef = useRef(0);

    const lastEntryPerAgent = useRef<Record<string, string>>({});

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const key = `${detail.agent}:${detail.action}:${detail.thought}`;
            if (lastEntryPerAgent.current[detail.agent] === key) return;
            lastEntryPerAgent.current[detail.agent] = key;

            setLogs(prev => {
                const newLog: LogEntry = { id: idRef.current++, ...detail };
                const updated = [...prev, newLog];
                return updated.slice(-30);
            });
        };
        eventBus.addEventListener('activity-log', handler);
        return () => eventBus.removeEventListener('activity-log', handler);
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    if (!isOpen) {
        return (
            <Button
                onClick={() => setIsOpen(true)}
                style={{ position: 'absolute', right: 20, top: 20, zIndex: 10 }}
            >
                📊 Activity Log
            </Button>
        );
    }

    return (
        <Panel style={{ position: 'absolute', right: 20, top: 20, width: 280, maxHeight: '35vh', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
            <SectionHeader
                title="📊 System Activity Log"
                action={<Button onClick={() => setIsOpen(false)} style={{ padding: '4px 8px' }}>✕</Button>}
            />

            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', fontSize: tokens.typography.micro, lineHeight: 1.5, ...controlRoomStyles.scroll }}>
                {logs.length === 0 && (
                    <p style={{ color: tokens.color.textMuted, fontStyle: 'italic', margin: 0 }}>Waiting for agent events...</p>
                )}
                {logs.map(log => (
                    <div key={log.id} style={{ padding: '3px 0', borderBottom: `1px solid ${tokens.color.borderSoft}`, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                        <span style={{ opacity: 0.5, minWidth: 48, color: tokens.color.textMuted }}>{log.time}</span>
                        <span>{actionIcons[log.action] || '•'}</span>
                        <span>
                            <strong style={{ color: log.agent === 'Alice' ? '#a8ffd4' : '#9bc8ff' }}>{log.agent}</strong>{' '}
                            <span style={{ color: tokens.color.textSecondary }}>{log.action}</span>
                            {log.thought && <span style={{ color: tokens.color.textMuted, fontStyle: 'italic' }}> — "{log.thought.slice(0, 60)}"</span>}
                        </span>
                    </div>
                ))}
            </div>
        </Panel>
    );
}

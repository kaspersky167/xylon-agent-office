import React, { useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '../events';
import { Button } from './ui/Button';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { controlRoomStyles, tokens } from '../theme/tokens';

interface LogEntry {
    id: string;
    category: EventCategory;
    agent: string;
    action: string;
    title: string;
    summary: string;
    agentId?: string;
    taskId?: string | number;
    approvalId?: string;
    status?: string;
    time: string;
    createdAt: number;
    dedupeKey: string;
}

const actionIcons: Record<string, string> = {
    work: '💻', talk: '💬', idle: '😌',
    use_tool: '🔧', move: '🚶', think: '💡'
};

export function SystemLog({ mode = 'floating' }: { mode?: 'floating' | 'docked' }) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [categoryFilter, setCategoryFilter] = useState<Record<EventCategory, boolean>>({
        activity: true,
        highlight: true,
        task: true,
        approval: true
    });
    const [agentFilter, setAgentFilter] = useState('all');
    const scrollRef = useRef<HTMLDivElement>(null);
    const idRef = useRef(1);
    const seenByKeyRef = useRef<Map<string, number>>(new Map());
    const knownApprovalsRef = useRef<Map<string, string>>(new Map());

    const pushLog = (entry: Omit<LogEntry, 'id' | 'createdAt'>) => {
        const now = Date.now();
        const lastSeenAt = seenByKeyRef.current.get(entry.dedupeKey);
        if (lastSeenAt && now - lastSeenAt < 5000) return;
        seenByKeyRef.current.set(entry.dedupeKey, now);
        if (seenByKeyRef.current.size > 500) {
            const cutoff = now - 90_000;
            for (const [key, seenAt] of seenByKeyRef.current.entries()) {
                if (seenAt < cutoff) {
                    seenByKeyRef.current.delete(key);
                }
            }
        }

        setLogs((prev) => {
            const next = [...prev, {
                ...entry,
                id: `event_${idRef.current++}`,
                createdAt: now
            }];
            return next.slice(-160);
        });
    };

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
            if (knownApprovalsRef.current.size > 250) {
                const activeIds = new Set(approvals.map((item: any) => item.id));
                for (const approvalId of knownApprovalsRef.current.keys()) {
                    if (!activeIds.has(approvalId)) {
                        knownApprovalsRef.current.delete(approvalId);
                    }
                }
            }
        };

        eventBus.addEventListener('activity-log', onActivity);
        eventBus.addEventListener('highlight-event', onHighlight);
        eventBus.addEventListener('task-update', onTaskUpdate);
        eventBus.addEventListener('approvals-sync', onApprovalsSync);
        return () => {
            eventBus.removeEventListener('activity-log', onActivity);
            eventBus.removeEventListener('highlight-event', onHighlight);
            eventBus.removeEventListener('task-update', onTaskUpdate);
            eventBus.removeEventListener('approvals-sync', onApprovalsSync);
        };
    }, []);

    const visibleLogs = useMemo(() => (
        logs.filter((log) => categoryFilter[log.category] && (agentFilter === 'all' || log.agent === agentFilter))
    ), [agentFilter, categoryFilter, logs]);

    const knownAgents = useMemo(() => {
        const names = Array.from(new Set(logs.map((log) => log.agent).filter(Boolean)));
        return names.sort((a, b) => a.localeCompare(b));
    }, [logs]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [visibleLogs]);

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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';

type EventCategory = 'activity' | 'highlight' | 'task' | 'approval';

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
    'work': '💻', 'talk': '💬', 'idle': '😌',
    'use_tool': '🔧', 'move': '🚶', 'think': '💡'
};

export function SystemLog() {
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
        const onActivity = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            const agent = detail.agent || 'Unknown';
            const action = detail.action || 'activity';
            const thought = typeof detail.thought === 'string' ? detail.thought : '';
            const dedupeThought = thought.trim().slice(0, 80);
            pushLog({
                category: 'activity',
                agent,
                agentId: typeof detail.agentId === 'string' ? detail.agentId : undefined,
                action,
                title: `${agent} · ${action}`,
                summary: thought ? thought.slice(0, 160) : 'Agent status update.',
                status: action,
                time: detail.time || new Date().toLocaleTimeString(),
                dedupeKey: `activity:${agent}:${action}:${dedupeThought}`
            });
        };

        const onHighlight = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            const type = detail.type || 'event';
            const agentId = typeof detail.agentId === 'string' ? detail.agentId : undefined;
            pushLog({
                category: 'highlight',
                agent: agentId || 'Office',
                agentId,
                action: type,
                title: detail.title || 'Office highlight',
                summary: detail.body || 'New highlight captured.',
                time: detail.time || new Date().toLocaleTimeString(),
                dedupeKey: `highlight:${type}:${detail.title || ''}:${detail.body || ''}:${agentId || ''}`
            });
        };

        const onTaskUpdate = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            if (!detail.task) return;
            const agent = detail.agentName || detail.agentId || detail.assigned_to || 'Unassigned';
            pushLog({
                category: 'task',
                agent,
                agentId: typeof detail.agentId === 'string' ? detail.agentId : undefined,
                action: 'task-update',
                title: detail.task,
                summary: `Task ${detail.status || 'updated'}${typeof detail.progress === 'number' ? ` · ${Math.round(detail.progress * 100)}%` : ''}`,
                status: detail.status,
                taskId: detail.id || detail.task,
                time: new Date().toLocaleTimeString(),
                dedupeKey: `task:${detail.task}:${agent}:${detail.status || ''}:${detail.progress ?? ''}`
            });
        };

        const onApprovalsSync = (event: Event) => {
            const approvals = (event as CustomEvent).detail;
            if (!Array.isArray(approvals)) return;
            approvals.forEach((approval: any) => {
                const priorStatus = knownApprovalsRef.current.get(approval.id);
                knownApprovalsRef.current.set(approval.id, approval.status);
                if (priorStatus === approval.status) return;
                pushLog({
                    category: 'approval',
                    agent: approval.requestedByName || 'Unknown',
                    agentId: approval.requestedBy,
                    action: 'approval',
                    title: approval.requestedAction || 'Approval request',
                    summary: `${approval.status?.toUpperCase() || 'PENDING'} · ${approval.rationale || ''}`.slice(0, 180),
                    status: approval.status,
                    approvalId: approval.id,
                    time: new Date(approval.createdAt || Date.now()).toLocaleTimeString(),
                    dedupeKey: `approval:${approval.id}:${approval.status}`
                });
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

    const eventEmoji: Record<EventCategory, string> = {
        activity: '🧠',
        highlight: '✨',
        task: '🗂️',
        approval: '🛂'
    };

    const onSelectEvent = (entry: LogEntry) => {
        eventBus.dispatchEvent(new CustomEvent('focus-agent-request', {
            detail: {
                agentId: entry.agentId,
                agentName: entry.agent
            }
        }));
        const panel = entry.category === 'approval' ? 'approvals' : entry.category === 'task' ? 'tasks' : 'activity';
        eventBus.dispatchEvent(new CustomEvent('open-context-panel', {
            detail: {
                panel: 'ceo-operations',
                section: panel,
                approvalId: entry.approvalId,
                taskId: entry.taskId,
                agentId: entry.agentId,
                agentName: entry.agent
            }
        }));
    };

    return (
        <FloatingPanel
            id="system-log"
            title="System Event Stream"
            subtitle="Activity · Highlights · Tasks · Approvals"
            width={470}
            defaultDock="left"
            defaultY={typeof window !== 'undefined' ? Math.max(12, window.innerHeight - 340) : 440}
            zIndex={28}
        >
            <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(Object.keys(categoryFilter) as EventCategory[]).map((category) => (
                        <button
                            key={category}
                            onClick={() => setCategoryFilter((prev) => ({ ...prev, [category]: !prev[category] }))}
                            style={{
                                borderRadius: 16,
                                border: '1px solid rgba(255,255,255,0.25)',
                                background: categoryFilter[category] ? 'rgba(108,92,231,0.35)' : 'rgba(255,255,255,0.06)',
                                color: '#fff',
                                padding: '3px 10px',
                                fontSize: 11
                            }}
                        >
                            {eventEmoji[category]} {category}
                        </button>
                    ))}
                    <select
                        value={agentFilter}
                        onChange={(event) => setAgentFilter(event.target.value)}
                        style={{ marginLeft: 'auto', borderRadius: 6, maxWidth: 160 }}
                    >
                        <option value="all">All agents</option>
                        {knownAgents.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                </div>

                <div ref={scrollRef} style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 }}>
                    {visibleLogs.length === 0 && (
                        <p style={{ color: '#8ca4d6', fontStyle: 'italic', margin: 0 }}>Waiting for stream events…</p>
                    )}
                    {visibleLogs.map((log) => (
                        <button
                            key={log.id}
                            onClick={() => onSelectEvent(log)}
                            style={{
                                textAlign: 'left',
                                borderRadius: 10,
                                border: '1px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255,255,255,0.05)',
                                padding: '7px 8px',
                                color: '#f4f8ff',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, opacity: 0.85 }}>
                                <span>{eventEmoji[log.category]}</span>
                                <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{log.category}</span>
                                <span style={{ opacity: 0.8 }}>{log.time}</span>
                                {log.status && <span style={{ marginLeft: 'auto', opacity: 0.85 }}>{log.status}</span>}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{log.title}</div>
                            <div style={{ fontSize: 11, color: '#d4def2', marginTop: 1 }}>
                                <strong style={{ color: '#9dd4ff' }}>{log.agent}</strong>
                                {' · '}
                                {actionIcons[log.action] ? `${actionIcons[log.action]} ` : ''}
                                {log.summary}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </FloatingPanel>
    );
}

import React, { useEffect, useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { eventBus } from '../events';

type LogEntry = {
    id: string;
    time: string;
    agent: string;
    action: string;
    thought?: string;
};

export function SystemLog() {
    const [logs, setLogs] = useState<LogEntry[]>([]);

    useEffect(() => {
        const onActivity = (event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            setLogs((prev) => [{
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                time: detail.time || new Date().toLocaleTimeString(),
                agent: detail.agent || 'System',
                action: detail.action || 'event',
                thought: detail.thought
            }, ...prev].slice(0, 80));
        };

        eventBus.addEventListener('activity-log', onActivity);
        return () => eventBus.removeEventListener('activity-log', onActivity);
    }, []);

    return (
        <FloatingPanel id="system-log" title="System Log" subtitle="Live agent activity" width={360} defaultDock="left" defaultY={20}>
            <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto', fontSize: 11 }}>
                {logs.length === 0 && <div style={{ opacity: 0.65 }}>No activity yet.</div>}
                {logs.map((log) => (
                    <div key={log.id} style={{ opacity: 0.9 }}>
                        <strong>{log.time}</strong> · <strong>{log.agent}</strong> · {log.action}
                        {log.thought ? ` — ${log.thought}` : ''}
                    </div>
                ))}
            </div>
        </FloatingPanel>
    );
}

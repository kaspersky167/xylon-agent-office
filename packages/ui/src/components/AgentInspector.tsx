import React, { useEffect, useState } from 'react';
import { eventBus } from '../events';

type InspectorAgent = {
    id?: string;
    name: string;
    role?: string;
    status?: string;
    currentTask?: string;
};

type SelectedTask = {
    title: string;
    lifecycleStage?: string;
    priority?: string;
    approvalRequired?: boolean;
    assigneeId?: string;
};

export function AgentInspector({ agent }: { agent?: InspectorAgent }) {
    const [focusedAgent, setFocusedAgent] = useState<InspectorAgent | undefined>(agent);
    const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);

    useEffect(() => {
        setFocusedAgent(agent);
    }, [agent]);

    useEffect(() => {
        const onAgentFocus = (event: Event) => {
            const detail = (event as CustomEvent).detail as InspectorAgent | null;
            if (!detail) {
                setFocusedAgent(agent);
                return;
            }
            setFocusedAgent((prev) => ({
                ...(prev || {}),
                ...detail,
                name: detail.name || prev?.name || 'Unknown agent'
            }));
        };

        const onTaskSelected = (event: Event) => {
            const detail = (event as CustomEvent).detail as SelectedTask;
            if (!detail?.title) return;
            setSelectedTask(detail);
            if (detail.assigneeId) {
                setFocusedAgent((prev) => prev ? prev : { id: detail.assigneeId, name: detail.assigneeId });
            }
        };

        eventBus.addEventListener('agent-focus', onAgentFocus);
        eventBus.addEventListener('task-selected', onTaskSelected);
        return () => {
            eventBus.removeEventListener('agent-focus', onAgentFocus);
            eventBus.removeEventListener('task-selected', onTaskSelected);
        };
    }, [agent]);

    if (!focusedAgent && !selectedTask) return null;

    return (
        <div style={{ position: 'absolute', right: 20, top: 20, width: 260, backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: 16, borderRadius: 8 }}>
            {focusedAgent && (
                <>
                    <h3 style={{ margin: '0 0 10px 0' }}>Inspector: {focusedAgent.name}</h3>
                    <div style={{ fontSize: '14px', marginBottom: 8 }}>
                        <p style={{ margin: '4px 0' }}><strong>Role:</strong> {focusedAgent.role || '—'}</p>
                        <p style={{ margin: '4px 0' }}><strong>Status:</strong> {focusedAgent.status || '—'}</p>
                        <p style={{ margin: '4px 0' }}><strong>Current Task:</strong> {focusedAgent.currentTask || 'None'}</p>
                    </div>
                </>
            )}
            {selectedTask && (
                <div style={{ fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 8 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Selected Task</div>
                    <div>{selectedTask.title}</div>
                    {selectedTask.lifecycleStage && <div>Stage: {selectedTask.lifecycleStage}</div>}
                    {selectedTask.priority && <div>Priority: {selectedTask.priority}</div>}
                    <div>Approval: {selectedTask.approvalRequired ? 'Required' : 'Not required'}</div>
                </div>
            )}
        </div>
    );
}

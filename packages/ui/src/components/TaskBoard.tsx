import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { Button } from './ui/Button';
import { Chip } from './ui/Chip';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { Toolbar } from './ui/Toolbar';
import { controlRoomStyles, tokens } from '../theme/tokens';

interface TaskItem {
    id: number;
    title: string;
    assigned_to: string;
    status: string;
}

export function TaskBoard() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');

    useEffect(() => {
        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                room.onMessage('task-update', (data: any) => {
                    setTasks(prev => {
                        const existing = prev.find(t => t.title === data.task);
                        if (existing) {
                            return prev.map(t => t.title === data.task ? { ...t, status: data.status, assigned_to: data.agentId } : t);
                        }
                        return [...prev, { id: Date.now(), title: data.task, assigned_to: data.agentId, status: data.status }];
                    });
                });
                room.onMessage('tasks-sync', (serverTasks: any[]) => {
                    setTasks(serverTasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        assigned_to: t.assigned_to || '',
                        status: t.status
                    })));
                });
                clearInterval(checkRoom);
            }
        }, 500);
        return () => clearInterval(checkRoom);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', { title: newTask, agentId: targetAgent === 'auto' ? undefined : targetAgent });
            setNewTask('');
        }
    };

    const taskTone = (s: string): 'success' | 'warning' | 'default' => {
        if (s === 'completed') return 'success';
        if (s === 'in_progress') return 'warning';
        return 'default';
    };

    const statusIcon = (s: string) => {
        if (s === 'completed') return '✅';
        if (s === 'in_progress') return '🔄';
        return '⏳';
    };

    return (
        <Panel style={{ position: 'absolute', left: 20, top: 20, width: 300, maxHeight: '52vh', display: 'flex', flexDirection: 'column' }}>
            <SectionHeader title="📋 Task Board" subtitle="Assign, route, and monitor execution" />

            <form onSubmit={handleSubmit} style={{ marginBottom: tokens.spacing.sm }}>
                <input
                    type="text"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    placeholder="Assign a task..."
                    style={{ ...controlRoomStyles.input, marginBottom: tokens.spacing.xs }}
                />
                <Toolbar>
                    <select
                        value={targetAgent}
                        onChange={(e) => setTargetAgent(e.target.value)}
                        style={{ ...controlRoomStyles.input, flex: 1, padding: 6, color: tokens.color.textSecondary }}
                    >
                        <option value="auto">🤖 Auto-assign</option>
                        <optgroup label="Engineering">
                            <option value="frontend">Frontend Dev</option>
                            <option value="backend">Backend Architect</option>
                            <option value="devops">DevOps Automator</option>
                            <option value="security">Security Engineer</option>
                        </optgroup>
                        <optgroup label="Ops / Strategy">
                            <option value="shepherd">Project Shepherd</option>
                            <option value="reality">Reality Checker</option>
                            <option value="evidence">Evidence Collector</option>
                            <option value="seo">SEO Specialist</option>
                        </optgroup>
                        <optgroup label="Growth">
                            <option value="sales">Sales Outreach</option>
                            <option value="proposal">Proposal Strategist</option>
                        </optgroup>
                        <optgroup label="Leadership">
                            <option value="ceo">Faz (CEO)</option>
                        </optgroup>
                    </select>
                    <Button type="submit" tone="primary">Assign</Button>
                </Toolbar>
            </form>

            <div style={{ flex: 1, overflowY: 'auto', fontSize: tokens.typography.caption, ...controlRoomStyles.scroll }}>
                {tasks.length === 0 && (
                    <p style={{ color: tokens.color.textMuted, fontStyle: 'italic', margin: 0, fontSize: tokens.typography.micro }}>
                        No tasks yet. Type above to assign work to agents.
                    </p>
                )}
                {tasks.map(task => (
                    <div key={task.id} style={{ ...controlRoomStyles.panelMuted, padding: `${tokens.spacing.xs}px ${tokens.spacing.sm}px`, marginBottom: tokens.spacing.xs }}>
                        <Toolbar>
                            <div style={{ fontWeight: 700, fontSize: tokens.typography.caption, flex: 1 }}>{statusIcon(task.status)} {task.title}</div>
                            {/(\bmajor\b|\bdeploy\b|\blaunch\b|\bpublish\b|\bhire\b|\bfire\b|\bpricing\b)/i.test(task.title) && (
                                <Chip tone="danger">🛂 CEO</Chip>
                            )}
                        </Toolbar>
                        <Toolbar style={{ marginTop: 3 }}>
                            <Chip tone={taskTone(task.status)}>{task.status.replace('_', ' ')}</Chip>
                            <div style={{ fontSize: tokens.typography.micro, color: tokens.color.textSecondary }}>
                                → {task.assigned_to || 'Unassigned'}
                            </div>
                        </Toolbar>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: tokens.spacing.sm, fontSize: tokens.typography.micro, color: tokens.color.textMuted, borderTop: `1px solid ${tokens.color.borderSoft}`, paddingTop: 6 }}>
                🤖 Engine: Ollama Local • 💾 SQLite Persistence
            </div>
        </Panel>
    );
}

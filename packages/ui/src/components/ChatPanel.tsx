import React, { useState, useEffect, useRef } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';
import { Button } from './ui/Button';
import { Chip } from './ui/Chip';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { Toolbar } from './ui/Toolbar';
import { controlRoomStyles, tokens } from '../theme/tokens';

type ChatAttachment = {
    id: string;
    path: string;
    name: string;
    mimeType: string;
    size: number;
    sharedBy: string;
    sharedWith: string[];
    createdAt: string;
};

type ChatMessage = {
    sender: string;
    text: string;
    attachments?: ChatAttachment[];
};

type WorkspaceFile = {
    path: string;
    name: string;
    mimeType: string;
    size: number;
    createdAt: string;
};

const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const mentionHandles = ['frontend', 'backend', 'devops', 'security', 'shepherd', 'reality', 'evidence', 'seo', 'sales', 'proposal', 'ceo'];

export function ChatPanel({ mode = 'floating' }: { mode?: 'floating' | 'docked' }) {
    const [messages, setMessages] = useState<ChatMessage[]>([
        { sender: 'System', text: 'Office environment initialized.' }
    ]);
    const [input, setInput] = useState('');
    const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
    const [selectedPath, setSelectedPath] = useState('');
    const [selectedAttachments, setSelectedAttachments] = useState<ChatAttachment[]>([]);
    const [newFilePath, setNewFilePath] = useState('');
    const [newFileContent, setNewFileContent] = useState('');
    const [fileActionStatus, setFileActionStatus] = useState('');
    const endRef = useRef<HTMLDivElement>(null);

    const loadWorkspaceFiles = async () => {
        try {
            const response = await fetch('/api/workspace-files');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            setWorkspaceFiles(Array.isArray(payload?.files) ? payload.files : []);
        } catch (error) {
            console.warn('Could not load workspace files for chat attachments.', error);
        }
    };

    useEffect(() => {
        loadWorkspaceFiles();
    }, []);

    useEffect(() => {
        const handleChat = (e: any) => {
            const detail = e.detail || {};
            setMessages(prev => [...prev, {
                sender: String(detail.sender || 'System'),
                text: String(detail.text || ''),
                attachments: Array.isArray(detail.attachments) ? detail.attachments : undefined
            }]);
        };
        eventBus.addEventListener('chat-message', handleChat);
        return () => eventBus.removeEventListener('chat-message', handleChat);
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const attachSelectedFile = () => {
        if (!selectedPath) return;
        const file = workspaceFiles.find((entry) => entry.path === selectedPath);
        if (!file) return;
        if (selectedAttachments.some((entry) => entry.path === file.path)) return;
        setSelectedAttachments(prev => [...prev, {
            id: `att-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            path: file.path,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            sharedBy: 'User',
            sharedWith: ['all'],
            createdAt: new Date().toISOString()
        }]);
    };

    const removeSelectedAttachment = (id: string) => {
        setSelectedAttachments(prev => prev.filter((item) => item.id !== id));
    };

    const insertMention = (handle: string) => {
        setInput((prev) => {
            const trimmed = prev.trimEnd();
            const prefix = trimmed.length === 0 ? '' : `${trimmed} `;
            return `${prefix}@${handle} `;
        });
    };

    const send = () => {
        if (!input.trim() && selectedAttachments.length === 0) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('chat', {
                text: input,
                attachments: selectedAttachments
            });
            setInput('');
            setSelectedAttachments([]);
        } else {
            setMessages(prev => [...prev, { sender: 'System', text: 'Error: Cannot send message, Colyseus not connected.' }]);
        }
    };

    const saveWorkspaceFile = async () => {
        if (!newFilePath.trim()) {
            setFileActionStatus('Enter a file path first.');
            return;
        }
        try {
            setFileActionStatus('Saving...');
            const response = await fetch('/api/workspace-files/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newFilePath.trim(), content: newFileContent })
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
            await loadWorkspaceFiles();
            setFileActionStatus(`Saved ${newFilePath.trim()}.`);
        } catch (error: any) {
            setFileActionStatus(`Save failed: ${error?.message || 'unknown error'}`);
        }
    };

    const uploadWorkspaceFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const targetPath = newFilePath.trim() || file.name;
        try {
            setFileActionStatus('Uploading...');
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            const response = await fetch('/api/workspace-files/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: targetPath, base64 })
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
            setNewFilePath(targetPath);
            await loadWorkspaceFiles();
            setFileActionStatus(`Uploaded ${targetPath}.`);
        } catch (error: any) {
            setFileActionStatus(`Upload failed: ${error?.message || 'unknown error'}`);
        } finally {
            event.target.value = '';
        }
    };

    return (
        <Panel style={{ position: 'absolute', right: 20, bottom: 20, width: 320, height: 520, display: 'flex', flexDirection: 'column' }}>
            <SectionHeader title="Office Chat" subtitle="Message agents + share workspace files" />
            <div style={{ flex: 1, overflowY: 'auto', fontSize: tokens.typography.body, marginBottom: tokens.spacing.sm, paddingRight: 4, ...controlRoomStyles.scroll }}>
                {messages.map((m, i) => (
                    <div key={i} style={{ margin: '6px 0' }}>
                        <p style={{ margin: 0, lineHeight: '1.4' }}>
                            <strong style={{ color: m.sender === 'System' ? '#7de9ff' : '#b9fbc0' }}>{m.sender}:</strong> {m.text}
                        </p>
                        {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                            <Toolbar style={{ marginTop: 6 }}>
                                {m.attachments.map((attachment) => (
                                    <div key={attachment.id} style={{ ...controlRoomStyles.panelMuted, padding: '6px 8px', fontSize: tokens.typography.micro, minWidth: 110 }}>
                                        <div style={{ fontWeight: 700, color: '#d8d0ff' }}>{attachment.name}</div>
                                        <div style={{ color: tokens.color.textSecondary }}>{attachment.mimeType} • {formatBytes(attachment.size)}</div>
                                    </div>
                                ))}
                            </Toolbar>
                        )}
                    </div>
                ))}
                <div ref={endRef} />
            </div>

            <Toolbar style={{ marginBottom: tokens.spacing.sm }}>
                <select
                    value={selectedPath}
                    onChange={(e) => setSelectedPath(e.target.value)}
                    style={{ ...controlRoomStyles.input, flex: 1 }}
                >
                    <option value="">Attach workspace file...</option>
                    {workspaceFiles.map((file) => (
                        <option key={file.path} value={file.path}>{file.name} ({file.path})</option>
                    ))}
                </select>
                <Button type="button" onClick={attachSelectedFile}>Attach</Button>
            </Toolbar>

            <Toolbar style={{ marginBottom: tokens.spacing.sm }}>
                {mentionHandles.slice(0, 6).map((handle) => (
                    <Chip key={handle} tone="accent" onClick={() => insertMention(handle)}>@{handle}</Chip>
                ))}
            </Toolbar>

            {selectedAttachments.length > 0 && (
                <Toolbar style={{ marginBottom: tokens.spacing.sm }}>
                    {selectedAttachments.map((attachment) => (
                        <Chip key={attachment.id} tone="default" onClick={() => removeSelectedAttachment(attachment.id)}>
                            {attachment.name} ×
                        </Chip>
                    ))}
                </Toolbar>
            )}

            <Panel tone="muted" style={{ marginBottom: tokens.spacing.sm, padding: tokens.spacing.sm }}>
                <div style={{ fontSize: tokens.typography.caption, marginBottom: 6, color: tokens.color.textSecondary }}>Save/upload workspace file</div>
                <input
                    type="text"
                    placeholder="notes/todo.md"
                    value={newFilePath}
                    onChange={(e) => setNewFilePath(e.target.value)}
                    style={{ ...controlRoomStyles.input, marginBottom: 6 }}
                />
                <textarea
                    placeholder="File content"
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    rows={3}
                    style={{ ...controlRoomStyles.input, marginBottom: 6, resize: 'vertical' }}
                />
                <Toolbar style={{ marginBottom: 4 }}>
                    <Button type="button" onClick={saveWorkspaceFile}>Save File</Button>
                    <label style={{ cursor: 'pointer' }}>
                        <span style={{
                            borderRadius: tokens.radius.sm,
                            border: `1px solid ${tokens.color.border}`,
                            background: 'rgba(18,25,52,0.95)',
                            color: tokens.color.textPrimary,
                            padding: '6px 10px',
                            fontSize: tokens.typography.caption,
                            fontWeight: 600,
                            display: 'inline-block'
                        }}>
                            Upload File
                        </span>
                        <input type="file" onChange={uploadWorkspaceFile} style={{ display: 'none' }} />
                    </label>
                </Toolbar>
                {fileActionStatus && <div style={{ fontSize: tokens.typography.micro, color: '#9ac5ff' }}>{fileActionStatus}</div>}
            </Panel>

            <input
                type="text"
                placeholder="Send a message... (tip: use @frontend, @devops, @shepherd)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                style={controlRoomStyles.input}
            />
        </Panel>
    );
}

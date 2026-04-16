import React, { useState, useEffect, useRef } from 'react';
import { eventBus } from '../events';
import { getColyseusRoom } from '../game/Game';

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

export function ChatPanel() {
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
        <div style={{ position: 'absolute', right: 20, bottom: 20, width: 300, height: 400, backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: 16, borderRadius: 8, display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Office Chat</h3>
            <div style={{ flex: 1, overflowY: 'auto', fontSize: '14px', marginBottom: 10, paddingRight: 4 }}>
                {messages.map((m, i) => (
                    <div key={i} style={{ margin: '6px 0' }}>
                        <p style={{ margin: 0, lineHeight: '1.4' }}>
                            <strong style={{ color: m.sender === 'System' ? '#00eeff' : '#aaffaa' }}>{m.sender}:</strong> {m.text}
                        </p>
                        {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                {m.attachments.map((attachment) => (
                                    <div key={attachment.id} style={{ border: '1px solid #4f6270', borderRadius: 6, padding: '6px 8px', background: '#1f2937', fontSize: 11, minWidth: 110 }}>
                                        <div style={{ fontWeight: 700, color: '#d9f99d' }}>{attachment.name}</div>
                                        <div style={{ color: '#9ca3af' }}>{attachment.mimeType} • {formatBytes(attachment.size)}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                <div ref={endRef} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <select
                    value={selectedPath}
                    onChange={(e) => setSelectedPath(e.target.value)}
                    style={{ flex: 1, background: '#333', color: 'white', border: '1px solid #444', borderRadius: 4, padding: '8px' }}
                >
                    <option value="">Attach workspace file...</option>
                    {workspaceFiles.map((file) => (
                        <option key={file.path} value={file.path}>{file.name} ({file.path})</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={attachSelectedFile}
                    style={{ border: '1px solid #555', background: '#1f2937', color: '#fff', borderRadius: 4, padding: '8px 10px', cursor: 'pointer' }}
                >
                    Attach
                </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {mentionHandles.slice(0, 6).map((handle) => (
                    <button
                        key={handle}
                        type="button"
                        onClick={() => insertMention(handle)}
                        style={{ border: '1px solid #43506b', background: '#0f172a', color: '#c7d2fe', borderRadius: 999, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}
                    >
                        @{handle}
                    </button>
                ))}
            </div>
            {selectedAttachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {selectedAttachments.map((attachment) => (
                        <button
                            key={attachment.id}
                            type="button"
                            onClick={() => removeSelectedAttachment(attachment.id)}
                            style={{ border: '1px solid #566', background: '#202938', color: '#dbeafe', borderRadius: 999, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                        >
                            {attachment.name} ×
                        </button>
                    ))}
                </div>
            )}
            <div style={{ border: '1px solid #2f3c4a', borderRadius: 6, padding: 8, marginBottom: 8, background: '#111827' }}>
                <div style={{ fontSize: 11, marginBottom: 6, color: '#d1d5db' }}>Save/upload workspace file</div>
                <input
                    type="text"
                    placeholder="notes/todo.md"
                    value={newFilePath}
                    onChange={(e) => setNewFilePath(e.target.value)}
                    style={{ width: '100%', marginBottom: 6, padding: '6px 8px', boxSizing: 'border-box', background: '#1f2937', color: 'white', border: '1px solid #374151', borderRadius: 4 }}
                />
                <textarea
                    placeholder="File content"
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    rows={3}
                    style={{ width: '100%', marginBottom: 6, padding: '6px 8px', boxSizing: 'border-box', background: '#1f2937', color: 'white', border: '1px solid #374151', borderRadius: 4, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <button type="button" onClick={saveWorkspaceFile} style={{ border: '1px solid #555', background: '#1f2937', color: '#fff', borderRadius: 4, padding: '6px 8px', cursor: 'pointer' }}>Save File</button>
                    <label style={{ border: '1px solid #555', background: '#1f2937', color: '#fff', borderRadius: 4, padding: '6px 8px', cursor: 'pointer' }}>
                        Upload File
                        <input type="file" onChange={uploadWorkspaceFile} style={{ display: 'none' }} />
                    </label>
                </div>
                {fileActionStatus && <div style={{ fontSize: 10, color: '#93c5fd' }}>{fileActionStatus}</div>}
            </div>
            <input
                type="text"
                placeholder="Send a message... (tip: use @frontend, @devops, @shepherd)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                style={{ width: '100%', padding: '10px', boxSizing: 'border-box', background: '#333', color: 'white', border: '1px solid #444', borderRadius: 4, outline: 'none' }}
            />
        </div>
    );
}

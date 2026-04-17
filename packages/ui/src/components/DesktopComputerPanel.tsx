import React, { useEffect, useMemo, useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { getColyseusRoom } from '../game/Game';
import { UIEvents, eventBus } from '../events';
import { Button } from './ui/Button';
import { Chip } from './ui/Chip';
import { Panel } from './ui/Panel';
import { SectionHeader } from './ui/SectionHeader';
import { Toolbar } from './ui/Toolbar';
import { controlRoomStyles, tokens } from '../theme/tokens';

type PreviewKind = 'text' | 'markdown' | 'json' | 'html' | 'unsupported';

interface DesktopFileItem {
    path: string;
    type?: 'file' | 'directory';
    size?: number;
    updatedAt?: string;
    mimeType?: string;
    name?: string;
}

interface DesktopFilePreview {
    path: string;
    type?: string;
    content?: string;
    encoding?: string;
    downloadUrl?: string;
    externalUrl?: string;
}

interface MailAttachment {
    path: string;
    name: string;
    mimeType: string;
    size: number;
}

interface MailMessage {
    id: string;
    threadId: string;
    from: string;
    to: string;
    toAgentId?: string;
    subject: string;
    body: string;
    attachments: MailAttachment[];
    createdAt: string;
}

interface DesktopComputerPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

const agentOptions = [
    { id: 'frontend', name: 'Frontend Dev' },
    { id: 'backend', name: 'Backend Architect' },
    { id: 'devops', name: 'DevOps Automator' },
    { id: 'security', name: 'Security Engineer' },
    { id: 'shepherd', name: 'Project Shepherd' },
    { id: 'reality', name: 'Reality Checker' },
    { id: 'evidence', name: 'Evidence Collector' },
    { id: 'seo', name: 'SEO Specialist' },
    { id: 'sales', name: 'Sales Outreach' },
    { id: 'proposal', name: 'Proposal Strategist' },
    { id: 'ceo', name: 'Faz (CEO)' }
];

function inferPreviewKind(path: string, typeHint?: string): PreviewKind {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const textTypes = ['txt', 'log', 'mdx', 'csv', 'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java', 'rb', 'css', 'scss', 'yml', 'yaml'];

    if (typeHint === 'json' || ext === 'json') return 'json';
    if (typeHint === 'markdown' || ext === 'md' || ext === 'mdx') return 'markdown';
    if (typeHint === 'html' || ext === 'html' || ext === 'htm') return 'html';
    if (typeHint === 'text' || textTypes.includes(ext)) return 'text';
    return 'unsupported';
}

function renderPreviewContent(preview: DesktopFilePreview | null, loading: boolean, error: string | null) {
    if (loading) return <div style={{ opacity: 0.7 }}>Loading preview...</div>;
    if (error) return <div style={{ color: tokens.color.danger }}>{error}</div>;
    if (!preview) return <div style={{ opacity: 0.65 }}>Select a file to preview.</div>;

    const previewKind = inferPreviewKind(preview.path, preview.type);

    if (previewKind === 'unsupported') {
        return (
            <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ opacity: 0.8 }}>Preview unavailable for this binary/unsupported format.</div>
                {preview.downloadUrl && (
                    <a href={preview.downloadUrl} target="_blank" rel="noreferrer" style={{ color: '#9ed0ff' }}>Download file</a>
                )}
                {preview.externalUrl && (
                    <a href={preview.externalUrl} target="_blank" rel="noreferrer" style={{ color: '#9ed0ff' }}>Open externally</a>
                )}
                {!preview.downloadUrl && !preview.externalUrl && (
                    <div style={{ opacity: 0.6 }}>Use your local tools to open this file.</div>
                )}
            </div>
        );
    }

    const raw = preview.content ?? '';

    if (previewKind === 'json') {
        try {
            const pretty = JSON.stringify(JSON.parse(raw), null, 2);
            return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{pretty}</pre>;
        } catch {
            return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{raw}</pre>;
        }
    }

    if (previewKind === 'html') {
        return (
            <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 11, opacity: 0.7 }}>HTML source preview</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{raw}</pre>
            </div>
        );
    }

    return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{raw}</pre>;
}

export function DesktopComputerPanel({ isOpen, onClose }: DesktopComputerPanelProps) {
    const [files, setFiles] = useState<DesktopFileItem[]>([]);
    const [, setEditorValue] = useState('');
    const [, setIsDirty] = useState(false);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [preview, setPreview] = useState<DesktopFilePreview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mailMessages, setMailMessages] = useState<MailMessage[]>([]);
    const [targetAgent, setTargetAgent] = useState('frontend');
    const [mailSubject, setMailSubject] = useState('Work request');
    const [mailBody, setMailBody] = useState('');
    const [mailAttachments, setMailAttachments] = useState<MailAttachment[]>([]);

    const selectedFile = selectedPath ? files.find((item) => item.path === selectedPath) : undefined;
    const filteredMail = useMemo(() => {
        return mailMessages
            .filter((message) => !targetAgent || message.toAgentId === targetAgent)
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }, [mailMessages, targetAgent]);
    const groupedFiles = files;

    const loadWorkspaceFiles = async () => {
        try {
            const response = await fetch('/api/workspace-files');
            const payload = await response.json();
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
            const rows = Array.isArray(payload?.files) ? payload.files : [];
            setFiles(rows.map((item: any) => ({
                path: String(item?.path || ''),
                type: 'file',
                size: typeof item?.size === 'number' ? item.size : undefined,
                updatedAt: typeof item?.createdAt === 'string' ? item.createdAt : undefined,
                mimeType: typeof item?.mimeType === 'string' ? item.mimeType : undefined,
                name: typeof item?.name === 'string' ? item.name : undefined
            })).filter((item: DesktopFileItem) => item.path));
        } catch (err: any) {
            setError(err?.message || 'Could not load workspace files.');
        }
    };

    const requestMailSync = () => {
        const room = getColyseusRoom();
        if (!room) return;
        room.send('mail-request-sync', {});
    };

    useEffect(() => {
        const onFilePreview = (event: Event) => {
            const payload = (event as CustomEvent).detail;
            setLoadingPreview(false);
            setError(null);
            const content = typeof payload?.content === 'string' ? payload.content : '';
            setPreview({
                path: String(payload?.path ?? selectedPath ?? ''),
                type: typeof payload?.type === 'string' ? payload.type : undefined,
                content,
                encoding: typeof payload?.encoding === 'string' ? payload.encoding : undefined,
                downloadUrl: typeof payload?.downloadUrl === 'string' ? payload.downloadUrl : undefined,
                externalUrl: typeof payload?.externalUrl === 'string' ? payload.externalUrl : undefined
            });
            setEditorValue(content);
            setIsDirty(false);
        };

        const onFileError = (event: Event) => {
            const payload = (event as CustomEvent).detail;
            setLoadingPreview(false);
            setError(typeof payload?.message === 'string' ? payload.message : 'Unable to load file data.');
        };

        const onMailSync = (event: Event) => {
            const payload = (event as CustomEvent).detail;
            const messages = Array.isArray(payload?.messages) ? payload.messages : [];
            setMailMessages(messages as MailMessage[]);
        };

        const onMailError = (event: Event) => {
            const payload = (event as CustomEvent).detail;
            if (payload?.message) setError(String(payload.message));
        };

        eventBus.addEventListener(UIEvents.desktopFilePreview, onFilePreview);
        eventBus.addEventListener(UIEvents.desktopFileError, onFileError);
        eventBus.addEventListener(UIEvents.mailSync, onMailSync);
        eventBus.addEventListener(UIEvents.mailError, onMailError);

        return () => {
            eventBus.removeEventListener(UIEvents.desktopFilePreview, onFilePreview);
            eventBus.removeEventListener(UIEvents.desktopFileError, onFileError);
            eventBus.removeEventListener(UIEvents.mailSync, onMailSync);
            eventBus.removeEventListener(UIEvents.mailError, onMailError);
        };
    }, [selectedPath]);

    useEffect(() => {
        if (!isOpen) return;
        setError(null);
        loadWorkspaceFiles();
        requestMailSync();
    }, [isOpen]);

    const openFile = (path: string) => {
        setSelectedPath(path);
        setLoadingPreview(true);
        setError(null);
        const room = getColyseusRoom();
        if (!room) {
            setLoadingPreview(false);
            setError('Room is not connected yet.');
            return;
        }
        room.send('file-preview', { path });
    };

    const attachSelectedFile = () => {
        if (!selectedFile) return;
        if (mailAttachments.some((entry) => entry.path === selectedFile.path)) return;
        setMailAttachments((prev) => [...prev, {
            path: selectedFile.path,
            name: selectedFile.name || selectedFile.path.split('/').pop() || selectedFile.path,
            mimeType: selectedFile.mimeType || 'application/octet-stream',
            size: selectedFile.size || 0
        }]);
    };

    const sendMail = () => {
        const room = getColyseusRoom();
        if (!room) {
            setError('Room is not connected yet.');
            return;
        }
        room.send('mail-send', {
            toAgentId: targetAgent,
            subject: mailSubject,
            body: mailBody,
            attachments: mailAttachments
        });
        setMailBody('');
        setMailAttachments([]);
    };

    if (!isOpen) return null;

    return (
        <FloatingPanel id="desktop-computer" title="Desk Computer" subtitle="Workspace files + Office Mail" width={980} defaultDock="right" defaultY={60} zIndex={22}>
            <div style={{ display: 'grid', gap: tokens.spacing.sm }}>
                <SectionHeader
                    title="Office Mail"
                    subtitle="Outlook-style inbox for agent directives + file handoff"
                    action={<Toolbar><Button onClick={loadWorkspaceFiles}>Refresh Files</Button><Button onClick={requestMailSync}>Refresh Mail</Button><Button onClick={onClose}>Close</Button></Toolbar>}
                />

                <Panel tone="muted" style={{ padding: tokens.spacing.sm }}>
                    <Toolbar style={{ marginBottom: tokens.spacing.xs }}>
                        <select value={targetAgent} onChange={(e) => setTargetAgent(e.target.value)} style={{ ...controlRoomStyles.input, width: 190 }}>
                            {agentOptions.map((agent) => (
                                <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                        </select>
                        <input
                            value={mailSubject}
                            onChange={(e) => setMailSubject(e.target.value)}
                            placeholder="Subject"
                            style={{ ...controlRoomStyles.input, flex: 1 }}
                        />
                    </Toolbar>
                    <textarea
                        value={mailBody}
                        onChange={(e) => setMailBody(e.target.value)}
                        rows={3}
                        placeholder="Give instructions, context, expected output, and deadline..."
                        style={{ ...controlRoomStyles.input, resize: 'vertical', marginBottom: tokens.spacing.xs }}
                    />
                    <Toolbar style={{ marginBottom: tokens.spacing.xs }}>
                        <Button type="button" onClick={attachSelectedFile}>Attach Selected File</Button>
                        <Button type="button" tone="primary" onClick={sendMail}>Send Email</Button>
                        {error && <div style={{ fontSize: tokens.typography.micro, color: tokens.color.danger }}>{error}</div>}
                    </Toolbar>
                    {mailAttachments.length > 0 && (
                        <Toolbar>
                            {mailAttachments.map((entry) => (
                                <Chip key={entry.path} tone="accent" onClick={() => setMailAttachments((prev) => prev.filter((item) => item.path !== entry.path))}>
                                    {entry.name} ×
                                </Chip>
                            ))}
                        </Toolbar>
                    )}
                </Panel>

                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr', gap: tokens.spacing.sm, minHeight: 430 }}>
                    <Panel tone="muted" style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: tokens.spacing.sm, padding: tokens.spacing.sm }}>
                        <div style={{ border: `1px solid ${tokens.color.borderSoft}`, borderRadius: tokens.radius.md, overflow: 'auto', ...controlRoomStyles.scroll }}>
                            {groupedFiles.length === 0 ? (
                                <div style={{ padding: 10, opacity: 0.7 }}>No files available.</div>
                            ) : (
                                groupedFiles.map((file) => {
                                    const isSelected = selectedPath === file.path;
                                    return (
                                        <button
                                            key={file.path}
                                            onClick={() => openFile(file.path)}
                                            style={{
                                                width: '100%',
                                                textAlign: 'left',
                                                padding: '7px 10px',
                                                border: 'none',
                                                borderBottom: `1px solid ${tokens.color.borderSoft}`,
                                                background: isSelected ? tokens.color.accentSoft : 'transparent',
                                                color: tokens.color.textPrimary,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <div style={{ fontSize: 12 }}>📄 {file.path}</div>
                                            {file.size !== undefined && <div style={{ fontSize: 10, color: tokens.color.textMuted }}>{file.size} bytes</div>}
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        <div style={{ border: `1px solid ${tokens.color.borderSoft}`, borderRadius: tokens.radius.md, padding: 10, overflow: 'auto', ...controlRoomStyles.scroll }}>
                            <div style={{ fontSize: 11, color: tokens.color.textSecondary, marginBottom: 8 }}>
                                {selectedFile ? `Preview: ${selectedFile.path}` : 'Preview'}
                            </div>
                            {renderPreviewContent(preview, loadingPreview, error)}
                        </div>
                    </Panel>

                    <Panel tone="muted" style={{ padding: tokens.spacing.sm, display: 'flex', flexDirection: 'column' }}>
                        <SectionHeader title="Inbox" subtitle={`Threaded agent mailbox (${filteredMail.length})`} />
                        <div style={{ overflowY: 'auto', display: 'grid', gap: tokens.spacing.xs, ...controlRoomStyles.scroll }}>
                            {filteredMail.length === 0 && (
                                <div style={{ fontSize: tokens.typography.caption, color: tokens.color.textMuted }}>
                                    No emails yet for this agent. Send instructions above.
                                </div>
                            )}
                            {filteredMail.map((mail) => {
                                const isOutgoing = mail.from === 'You';
                                return (
                                    <div key={mail.id} style={{ ...controlRoomStyles.panelMuted, padding: tokens.spacing.sm, borderLeft: `3px solid ${isOutgoing ? tokens.color.accent : tokens.color.success}` }}>
                                        <div style={{ fontSize: tokens.typography.caption, fontWeight: 700 }}>
                                            {isOutgoing ? 'You →' : `${mail.from} →`} {mail.to}
                                        </div>
                                        <div style={{ fontSize: tokens.typography.micro, color: tokens.color.textSecondary }}>
                                            {mail.subject} • {new Date(mail.createdAt).toLocaleTimeString()}
                                        </div>
                                        <div style={{ marginTop: 4, fontSize: tokens.typography.caption }}>{mail.body}</div>
                                        {mail.attachments.length > 0 && (
                                            <Toolbar style={{ marginTop: 6 }}>
                                                {mail.attachments.map((attachment) => (
                                                    <Chip key={`${mail.id}:${attachment.path}`} tone="default">📎 {attachment.name}</Chip>
                                                ))}
                                            </Toolbar>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Panel>
                </div>
            </div>
        </FloatingPanel>
    );
}

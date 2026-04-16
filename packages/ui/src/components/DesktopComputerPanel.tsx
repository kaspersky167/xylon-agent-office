import React, { useEffect, useMemo, useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { getColyseusRoom } from '../game/Game';
import { UIEvents, eventBus } from '../events';

type PreviewKind = 'text' | 'markdown' | 'json' | 'html' | 'unsupported';

interface DesktopFileItem {
    path: string;
    type?: 'file' | 'directory';
    size?: number;
    updatedAt?: string;
}

interface DesktopFilePreview {
    path: string;
    type?: string;
    content?: string;
    encoding?: string;
    downloadUrl?: string;
    externalUrl?: string;
}

interface DesktopComputerPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

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
    if (error) return <div style={{ color: '#ffadad' }}>{error}</div>;
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
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [preview, setPreview] = useState<DesktopFilePreview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editorValue, setEditorValue] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [recipient, setRecipient] = useState('frontend');
    const [shareInstructions, setShareInstructions] = useState('');

    const groupedFiles = useMemo(() => {
        return [...files].sort((a, b) => a.path.localeCompare(b.path));
    }, [files]);

    const selectedFile = selectedPath ? files.find((item) => item.path === selectedPath) : undefined;

    useEffect(() => {
        const onFileList = (event: Event) => {
            const payload = (event as CustomEvent).detail;
            const incoming = Array.isArray(payload)
                ? payload
                : Array.isArray(payload?.files)
                    ? payload.files
                    : [];

            setFiles(incoming.map((item: any) => ({
                path: String(item?.path ?? ''),
                type: item?.type === 'directory' ? 'directory' : 'file',
                size: typeof item?.size === 'number' ? item.size : undefined,
                updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : undefined
            })).filter((item: DesktopFileItem) => item.path));
        };

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

        eventBus.addEventListener(UIEvents.desktopFilesSync, onFileList);
        eventBus.addEventListener(UIEvents.desktopFilePreview, onFilePreview);
        eventBus.addEventListener(UIEvents.desktopFileError, onFileError);

        return () => {
            eventBus.removeEventListener(UIEvents.desktopFilesSync, onFileList);
            eventBus.removeEventListener(UIEvents.desktopFilePreview, onFilePreview);
            eventBus.removeEventListener(UIEvents.desktopFileError, onFileError);
        };
    }, [selectedPath]);

    const requestFileList = () => {
        const room = getColyseusRoom();
        if (!room) {
            setError('Room is not connected yet.');
            return;
        }
        setError(null);
        room.send('file-list', { request: true });
    };

    useEffect(() => {
        if (!isOpen) return;
        requestFileList();
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

    const sendTopAction = (action: 'share-agent' | 'share-ceo' | 'mark-review') => {
        if (!selectedPath) {
            setError('Select a file first.');
            return;
        }
        const room = getColyseusRoom();
        if (!room) {
            setError('Room is not connected yet.');
            return;
        }

        const messageType = action === 'mark-review' ? 'file-mark-review' : 'file-share';
        const audience = action === 'share-agent' ? 'agent' : action === 'share-ceo' ? 'ceo' : undefined;
        room.send(messageType, {
            path: selectedPath,
            ...(audience ? { audience } : {}),
            ...(action === 'share-agent' ? { recipient } : {}),
            ...(shareInstructions ? { instructions: shareInstructions } : {})
        });
    };

    const saveFile = () => {
        if (!selectedPath) {
            setError('Select a file first.');
            return;
        }
        const room = getColyseusRoom();
        if (!room) {
            setError('Room is not connected yet.');
            return;
        }
        setError(null);
        room.send('file-save', { path: selectedPath, content: editorValue });
        setIsDirty(false);
    };

    if (!isOpen) return null;

    return (
        <FloatingPanel
            id="desktop-computer"
            title="Desk Computer"
            subtitle="Workspace files"
            width={760}
            defaultDock="right"
            defaultY={72}
            zIndex={22}
        >
            <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => sendTopAction('share-agent')}>Share with agent</button>
                    <button onClick={() => sendTopAction('share-ceo')}>Share with CEO</button>
                    <button onClick={() => sendTopAction('mark-review')}>Mark for review</button>
                    <button onClick={requestFileList}>Refresh</button>
                    <button onClick={onClose}>Close</button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 11, opacity: 0.8 }}>
                        Agent:
                        <select value={recipient} onChange={(event) => setRecipient(event.target.value)} style={{ marginLeft: 6 }}>
                            <option value="frontend">Frontend Dev</option>
                            <option value="backend">Backend Architect</option>
                            <option value="devops">DevOps Automator</option>
                            <option value="security">Security Engineer</option>
                            <option value="shepherd">Project Shepherd</option>
                            <option value="reality">Reality Checker</option>
                            <option value="evidence">Evidence Collector</option>
                            <option value="seo">SEO Specialist</option>
                            <option value="sales">Sales Outreach</option>
                            <option value="proposal">Proposal Strategist</option>
                        </select>
                    </label>
                    <input
                        value={shareInstructions}
                        onChange={(event) => setShareInstructions(event.target.value)}
                        placeholder="Review instructions for agent/CEO..."
                        style={{ flex: 1, minWidth: 260 }}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, minHeight: 350 }}>
                    <div style={{ border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, overflow: 'auto', maxHeight: 430 }}>
                        {groupedFiles.length === 0 ? (
                            <div style={{ padding: 10, opacity: 0.7 }}>No files available.</div>
                        ) : (
                            groupedFiles.map((file) => {
                                const isSelected = selectedPath === file.path;
                                const isFolder = file.type === 'directory';
                                return (
                                    <button
                                        key={file.path}
                                        onClick={() => !isFolder && openFile(file.path)}
                                        style={{
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '7px 10px',
                                            border: 'none',
                                            borderBottom: '1px solid rgba(255,255,255,0.08)',
                                            background: isSelected ? 'rgba(130, 167, 255, 0.25)' : 'transparent',
                                            color: '#f2f7ff',
                                            cursor: isFolder ? 'default' : 'pointer',
                                            opacity: isFolder ? 0.8 : 1
                                        }}
                                    >
                                        <div style={{ fontSize: 12 }}>{isFolder ? '📁' : '📄'} {file.path}</div>
                                        {file.size !== undefined && !isFolder && (
                                            <div style={{ fontSize: 10, opacity: 0.65 }}>{file.size} bytes</div>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div style={{ border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 10, overflow: 'auto', maxHeight: 430, background: 'rgba(10, 12, 28, 0.65)' }}>
                        <div style={{ fontSize: 11, opacity: 0.68, marginBottom: 8 }}>
                            {selectedFile ? `Preview: ${selectedFile.path}` : 'Preview'}
                        </div>
                        {(() => {
                            const previewKind = preview ? inferPreviewKind(preview.path, preview.type) : 'unsupported';
                            const editable = Boolean(preview) && ['text', 'markdown', 'json', 'html'].includes(previewKind);
                            if (!editable) return renderPreviewContent(preview, loadingPreview, error);
                            return (
                                <div style={{ display: 'grid', gap: 8 }}>
                                    <textarea
                                        value={editorValue}
                                        onChange={(event) => {
                                            setEditorValue(event.target.value);
                                            setIsDirty(true);
                                        }}
                                        style={{
                                            width: '100%',
                                            minHeight: 290,
                                            resize: 'vertical',
                                            borderRadius: 6,
                                            border: '1px solid rgba(255,255,255,0.18)',
                                            background: 'rgba(6,8,20,0.8)',
                                            color: '#e8efff',
                                            padding: 10,
                                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                            fontSize: 12
                                        }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ fontSize: 11, opacity: 0.65 }}>
                                            {isDirty ? 'Unsaved changes' : 'Saved'}
                                        </div>
                                        <button onClick={saveFile} disabled={!isDirty || loadingPreview}>Save file</button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </FloatingPanel>
    );
}

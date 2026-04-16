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
    const [completedFiles, setCompletedFiles] = useState<DesktopFileItem[]>([]);

    const groupedFiles = useMemo(() => [...files].sort((a, b) => a.path.localeCompare(b.path)), [files]);
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
            setPreview({
                path: String(payload?.path ?? selectedPath ?? ''),
                type: typeof payload?.type === 'string' ? payload.type : undefined,
                content: typeof payload?.content === 'string' ? payload.content : '',
                encoding: typeof payload?.encoding === 'string' ? payload.encoding : undefined,
                downloadUrl: typeof payload?.downloadUrl === 'string' ? payload.downloadUrl : undefined,
                externalUrl: typeof payload?.externalUrl === 'string' ? payload.externalUrl : undefined
            });
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

    const loadCompletedFiles = async () => {
        try {
            const response = await fetch('/api/completed-work');
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
            setCompletedFiles(Array.isArray(payload?.files) ? payload.files : []);
        } catch (err: any) {
            setError(err?.message || 'Could not load completed work files.');
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        requestFileList();
        loadCompletedFiles();
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
        room.send(messageType, { path: selectedPath, ...(audience ? { audience } : {}) });
    };

    if (!isOpen) return null;

    return (
        <FloatingPanel id="desktop-computer" title="Desk Computer" subtitle="Workspace files" width={760} defaultDock="right" defaultY={72} zIndex={22}>
            <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => sendTopAction('share-agent')}>Share with agent</button>
                    <button onClick={() => sendTopAction('share-ceo')}>Share with CEO</button>
                    <button onClick={() => sendTopAction('mark-review')}>Mark for review</button>
                    <button onClick={requestFileList}>Refresh Files</button>
                    <button onClick={loadCompletedFiles}>Refresh Completed Work</button>
                    <button onClick={onClose}>Close</button>
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 10, background: 'rgba(10, 12, 28, 0.55)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                        Completed Work ({completedFiles.length})
                    </div>
                    {completedFiles.length === 0 ? (
                        <div style={{ fontSize: 11, opacity: 0.7 }}>No completed snapshots yet.</div>
                    ) : (
                        <div style={{ display: 'grid', gap: 5, maxHeight: 120, overflowY: 'auto' }}>
                            {completedFiles.slice(0, 8).map((item) => (
                                <div key={item.path} style={{ fontSize: 11, opacity: 0.85 }}>📄 {item.path}</div>
                            ))}
                        </div>
                    )}
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
                                            width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none',
                                            borderBottom: '1px solid rgba(255,255,255,0.08)',
                                            background: isSelected ? 'rgba(130, 167, 255, 0.25)' : 'transparent',
                                            color: '#f2f7ff', cursor: isFolder ? 'default' : 'pointer', opacity: isFolder ? 0.8 : 1
                                        }}
                                    >
                                        <div style={{ fontSize: 12 }}>{isFolder ? '📁' : '📄'} {file.path}</div>
                                        {file.size !== undefined && !isFolder && <div style={{ fontSize: 10, opacity: 0.65 }}>{file.size} bytes</div>}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div style={{ border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 10, overflow: 'auto', maxHeight: 430, background: 'rgba(10, 12, 28, 0.65)' }}>
                        <div style={{ fontSize: 11, opacity: 0.68, marginBottom: 8 }}>
                            {selectedFile ? `Preview: ${selectedFile.path}` : 'Preview'}
                        </div>
                        {renderPreviewContent(preview, loadingPreview, error)}
                    </div>
                </div>
            </div>
        </FloatingPanel>
    );
}

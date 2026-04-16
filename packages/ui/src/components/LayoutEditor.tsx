import React, { useEffect, useState } from 'react';
import { getColyseusRoom } from '../game/Game';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';

interface FurnitureItem {
    id: string;
    type: 'desk' | 'plant' | 'bookshelf' | 'coffee_machine' | 'table' | 'chair' | 'whiteboard';
    x: number;
    y: number;
    label?: string;
}

const FURNITURE_PALETTE: { type: FurnitureItem['type']; emoji: string; label: string }[] = [
    { type: 'desk', emoji: '🖥️', label: 'Desk' },
    { type: 'plant', emoji: '🌿', label: 'Plant' },
    { type: 'bookshelf', emoji: '📚', label: 'Bookshelf' },
    { type: 'coffee_machine', emoji: '☕', label: 'Coffee' },
    { type: 'table', emoji: '🪑', label: 'Table' },
    { type: 'chair', emoji: '💺', label: 'Chair' },
    { type: 'whiteboard', emoji: '📝', label: 'Board' }
];

export function LayoutEditor() {
    const [items, setItems] = useState<FurnitureItem[]>([]);
    const [selected, setSelected] = useState<FurnitureItem['type']>('desk');

    useEffect(() => {
        const syncHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { items?: FurnitureItem[] };
            setItems(Array.isArray(detail?.items) ? detail.items : []);
        };
        eventBus.addEventListener('layout-sync', syncHandler);
        return () => eventBus.removeEventListener('layout-sync', syncHandler);
    }, []);

    return (
        <FloatingPanel id="layout-editor" title="Layout Editor" subtitle="Preview furniture layout" width={320} defaultDock="left" defaultY={140}>
            <div style={{ display: 'grid', gap: 8 }}>
                <select value={selected} onChange={(e) => setSelected(e.target.value as FurnitureItem['type'])}>
                    {FURNITURE_PALETTE.map((item) => (
                        <option key={item.type} value={item.type}>{item.emoji} {item.label}</option>
                    ))}
                </select>
                <button onClick={() => {
                    const room = getColyseusRoom();
                    room?.send('layout-add-item', { type: selected });
                }}>Add Selected Item</button>
                <div style={{ fontSize: 11, opacity: 0.75 }}>Items: {items.length}</div>
            </div>
        </FloatingPanel>
    );
}

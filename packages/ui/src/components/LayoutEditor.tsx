import React, { useEffect, useState } from 'react';
import { getColyseusRoom } from '../game/Game';
import { eventBus } from '../events';

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
    { type: 'whiteboard', emoji: '📝', label: 'Board' },
];

const ZONE_BOUNDS: Record<'main' | 'ceo_office', { min: number; max: number; minY: number; maxY: number }> = {
    main: { min: 2, max: 36, minY: 2, maxY: 36 },
    ceo_office: { min: 28, max: 35, minY: 27, maxY: 33 }
};

export function LayoutEditor() {
    const [isOpen, setIsOpen] = useState(false);
    const [items, setItems] = useState<FurnitureItem[]>([]);
    const [zoneId, setZoneId] = useState<'main' | 'ceo_office'>('main');
    const [itemsByZone, setItemsByZone] = useState<Record<'main' | 'ceo_office', FurnitureItem[]>>({ main: [], ceo_office: [] });
    const [selected, setSelected] = useState<FurnitureItem['type']>('desk');
    const [moveMode, setMoveMode] = useState(true);

    useEffect(() => {
        const syncHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { items: FurnitureItem[]; zoneId?: 'main' | 'ceo_office'; layoutByZone?: Record<'main' | 'ceo_office', FurnitureItem[]> };
            const nextZone = detail?.zoneId === 'ceo_office' ? 'ceo_office' : 'main';
            const nextByZone = detail?.layoutByZone || {
                main: nextZone === 'main' ? (detail?.items || []) : itemsByZone.main,
                ceo_office: nextZone === 'ceo_office' ? (detail?.items || []) : itemsByZone.ceo_office
            };
            setZoneId(nextZone);
            setItemsByZone({
                main: (nextByZone.main || []).map((item, idx) => ({
                    ...item,
                    id: item.id || `item_sync_main_${idx}`,
                    label: item.label || FURNITURE_PALETTE.find((f) => f.type === item.type)?.label
                })),
                ceo_office: (nextByZone.ceo_office || []).map((item, idx) => ({
                    ...item,
                    id: item.id || `item_sync_ceo_${idx}`,
                    label: item.label || FURNITURE_PALETTE.find((f) => f.type === item.type)?.label
                }))
            });
            setItems((nextByZone[nextZone] || []).map((item, idx) => ({
                ...item,
                id: item.id || `item_sync_${idx}`,
                label: item.label || FURNITURE_PALETTE.find((f) => f.type === item.type)?.label
            })));
        };
        const movedHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { items: FurnitureItem[]; zoneId?: 'main' | 'ceo_office' };
            if (!Array.isArray(detail?.items)) return;
            const nextZone = detail?.zoneId === 'ceo_office' ? 'ceo_office' : zoneId;
            setItemsByZone((prev) => ({ ...prev, [nextZone]: detail.items }));
            setItems(detail.items as FurnitureItem[]);
        };
        const zoneHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { zoneId?: 'main' | 'ceo_office' };
            const nextZone = detail?.zoneId === 'ceo_office' ? 'ceo_office' : 'main';
            setZoneId(nextZone);
            setItems(itemsByZone[nextZone] || []);
        };
        eventBus.addEventListener('layout-sync', syncHandler);
        eventBus.addEventListener('layout-item-moved', movedHandler);
        eventBus.addEventListener('zone-state', zoneHandler);
        return () => {
            eventBus.removeEventListener('layout-sync', syncHandler);
            eventBus.removeEventListener('layout-item-moved', movedHandler);
            eventBus.removeEventListener('zone-state', zoneHandler);
        };
    }, [itemsByZone, zoneId]);

    useEffect(() => {
        eventBus.dispatchEvent(new CustomEvent('layout-preview-update', { detail: { items } }));
    }, [items]);

    useEffect(() => {
        eventBus.dispatchEvent(new CustomEvent('layout-edit-mode', { detail: { enabled: isOpen && moveMode } }));
    }, [isOpen, moveMode]);

    const addItem = () => {
        const newItem: FurnitureItem = {
            id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            type: selected,
            x: Math.floor(Math.random() * (ZONE_BOUNDS[zoneId].max - ZONE_BOUNDS[zoneId].min + 1)) + ZONE_BOUNDS[zoneId].min,
            y: Math.floor(Math.random() * (ZONE_BOUNDS[zoneId].maxY - ZONE_BOUNDS[zoneId].minY + 1)) + ZONE_BOUNDS[zoneId].minY,
            label: FURNITURE_PALETTE.find(f => f.type === selected)?.label
        };
        setItems(prev => [...prev, newItem]);
        setItemsByZone(prev => ({ ...prev, [zoneId]: [...(prev[zoneId] || []), newItem] }));
    };

    const removeItem = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
        setItemsByZone(prev => ({ ...prev, [zoneId]: (prev[zoneId] || []).filter(i => i.id !== id) }));
    };

    const nudgeItem = (id: string, dx: number, dy: number) => {
        setItems(prev => prev.map((item) => {
            if (item.id !== id) return item;
            return {
                ...item,
                x: Math.max(ZONE_BOUNDS[zoneId].min, Math.min(ZONE_BOUNDS[zoneId].max, item.x + dx)),
                y: Math.max(ZONE_BOUNDS[zoneId].minY, Math.min(ZONE_BOUNDS[zoneId].maxY, item.y + dy))
            };
        }));
        setItemsByZone(prev => ({
            ...prev,
            [zoneId]: (prev[zoneId] || []).map((item) => item.id === id ? {
                ...item,
                x: Math.max(ZONE_BOUNDS[zoneId].min, Math.min(ZONE_BOUNDS[zoneId].max, item.x + dx)),
                y: Math.max(ZONE_BOUNDS[zoneId].minY, Math.min(ZONE_BOUNDS[zoneId].maxY, item.y + dy))
            } : item)
        }));
    };

    const saveLayout = () => {
        const room = getColyseusRoom();
        if (room) {
            room.send('save-layout', { name: 'default', zoneId, layout: items, layoutByZone: itemsByZone });
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                style={{
                    position: 'absolute', left: 20, bottom: 80,
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    backgroundColor: '#6c5ce7', color: 'white',
                    cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
                    boxShadow: '0 4px 12px rgba(108,92,231,0.4)',
                    zIndex: 10
                }}
            >
                🏗️ Layout Editor
            </button>
        );
    }

    return (
        <div style={{
            position: 'absolute', left: 20, bottom: 20, width: 280,
            backgroundColor: 'rgba(10,10,30,0.95)', color: 'white',
            padding: 16, borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            border: '1px solid rgba(108,92,231,0.3)',
            maxHeight: '40vh', display: 'flex', flexDirection: 'column',
            zIndex: 20
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: '14px' }}>🏗️ Office Layout Editor</h3>
                <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#9aa3cf' }}>
                Editing zone: <strong style={{ color: '#fff' }}>{zoneId === 'main' ? 'Main Floor' : 'CEO Office'}</strong>
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', marginBottom: 8, color: '#c9cff8' }}>
                <input type="checkbox" checked={moveMode} onChange={(e) => setMoveMode(e.target.checked)} />
                Drag items with mouse on canvas
            </label>

            {/* Furniture Palette */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {FURNITURE_PALETTE.map(f => (
                    <button
                        key={f.type}
                        onClick={() => setSelected(f.type)}
                        style={{
                            padding: '4px 8px', borderRadius: 6, border: 'none',
                            backgroundColor: selected === f.type ? '#6c5ce7' : '#2d2d4d',
                            color: 'white', cursor: 'pointer', fontSize: '11px'
                        }}
                    >
                        {f.emoji} {f.label}
                    </button>
                ))}
            </div>

            <button onClick={addItem} style={{
                padding: '6px', borderRadius: 6, border: 'none',
                backgroundColor: '#00b894', color: 'white', cursor: 'pointer',
                fontSize: '11px', fontWeight: 'bold', marginBottom: 8
            }}>
                + Add {FURNITURE_PALETTE.find(f => f.type === selected)?.label}
            </button>

            {/* Item List */}
            <div style={{ flex: 1, overflowY: 'auto', fontSize: '11px', marginBottom: 8 }}>
                {items.length === 0 && (
                    <p style={{ color: '#555', fontStyle: 'italic', margin: 0 }}>
                        Select furniture type and click Add to place items.
                    </p>
                )}
                {items.map(item => (
                    <div key={item.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '4px 6px', marginBottom: 2, borderRadius: 4,
                        backgroundColor: 'rgba(255,255,255,0.05)'
                    }}>
                        <span>{FURNITURE_PALETTE.find(f => f.type === item.type)?.emoji} {item.label} ({Math.round(item.x)},{Math.round(item.y)})</span>
                        <div style={{ display: 'flex', gap: 2 }}>
                            <button onClick={() => nudgeItem(item.id, -1, 0)} style={{ background: 'none', border: 'none', color: '#8ecae6', cursor: 'pointer', fontSize: '11px' }}>◀</button>
                            <button onClick={() => nudgeItem(item.id, 1, 0)} style={{ background: 'none', border: 'none', color: '#8ecae6', cursor: 'pointer', fontSize: '11px' }}>▶</button>
                            <button onClick={() => nudgeItem(item.id, 0, -1)} style={{ background: 'none', border: 'none', color: '#8ecae6', cursor: 'pointer', fontSize: '11px' }}>▲</button>
                            <button onClick={() => nudgeItem(item.id, 0, 1)} style={{ background: 'none', border: 'none', color: '#8ecae6', cursor: 'pointer', fontSize: '11px' }}>▼</button>
                            <button onClick={() => removeItem(item.id)} style={{
                                background: 'none', border: 'none', color: '#e17055',
                                cursor: 'pointer', fontSize: '12px'
                            }}>🗑</button>
                        </div>
                    </div>
                ))}
            </div>

            <button onClick={saveLayout} style={{
                padding: '8px', borderRadius: 6, border: 'none',
                backgroundColor: '#6c5ce7', color: 'white', cursor: 'pointer',
                fontSize: '12px', fontWeight: 'bold'
            }}>
                💾 Save Layout
            </button>
        </div>
    );
}

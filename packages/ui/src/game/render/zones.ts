import Phaser from 'phaser';
import { COLORS, GRID_SIZE_PX, LAYOUT, TEXT, TILE_SIZE } from '../theme';

export type OfficeZone = {
    id: string;
    name: string;
    icon?: string;
    bounds: { x: number; y: number; w: number; h: number };
    floorColor: number;
    wallColor: number;
    wallWidth: number;
    wallAlpha: number;
    labelColor: string;
    doorGap?: { x: number; y: number; w: number; h: number; fill?: number };
};

export const OFFICE_ZONES: OfficeZone[] = [
    {
        id: 'meeting',
        name: 'Meeting Area',
        icon: '🏢',
        bounds: LAYOUT.meeting,
        floorColor: COLORS.floorMeeting,
        wallColor: COLORS.wallMeeting,
        wallWidth: 3,
        wallAlpha: 0.9,
        labelColor: '#b8a9d4',
        doorGap: { x: 192, y: 188, w: 40, h: 6, fill: COLORS.floorWorkArea }
    },
    {
        id: 'collaboration',
        name: 'Collab Area',
        icon: '💡',
        bounds: LAYOUT.collaboration,
        floorColor: COLORS.floorCollaboration,
        wallColor: COLORS.wallCollaboration,
        wallWidth: 3,
        wallAlpha: 0.9,
        labelColor: '#e8a87c',
        doorGap: { x: 280, y: 160, w: 40, h: 6, fill: COLORS.floorWorkArea }
    },
    {
        id: 'pantry',
        name: 'Coffee & Pantry',
        icon: '☕',
        bounds: LAYOUT.pantry,
        floorColor: COLORS.pantryTileA,
        wallColor: COLORS.wallPantry,
        wallWidth: 2,
        wallAlpha: 0.7,
        labelColor: '#7fcdaa',
        doorGap: { x: 350, y: 410, w: 4, h: 40, fill: COLORS.floorWorkArea }
    },
    {
        id: 'pods',
        name: 'Pods',
        bounds: { x: 0, y: 0, w: 0, h: 0 },
        floorColor: 0,
        wallColor: 0,
        wallWidth: 0,
        wallAlpha: 0,
        labelColor: '#ffffff'
    },
    {
        id: 'executive-office',
        name: 'Executive Office',
        bounds: {
            x: LAYOUT.executiveOfficeTiles.x1 * TILE_SIZE,
            y: LAYOUT.executiveOfficeTiles.y1 * TILE_SIZE,
            w: (LAYOUT.executiveOfficeTiles.x2 - LAYOUT.executiveOfficeTiles.x1) * TILE_SIZE,
            h: (LAYOUT.executiveOfficeTiles.y2 - LAYOUT.executiveOfficeTiles.y1) * TILE_SIZE
        },
        floorColor: COLORS.executiveFill,
        wallColor: COLORS.executiveWall,
        wallWidth: 3,
        wallAlpha: 0.9,
        labelColor: '#ff9f80'
    }
];

export function drawOfficeBase(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(COLORS.floorBase, 1);
    g.fillRect(0, 0, GRID_SIZE_PX, GRID_SIZE_PX);

    g.fillStyle(COLORS.floorWorkArea, 1);
    g.fillRect(LAYOUT.inset, LAYOUT.inset, GRID_SIZE_PX - LAYOUT.inset * 2, GRID_SIZE_PX - LAYOUT.inset * 2);

    for (const zone of OFFICE_ZONES) {
        if (zone.id === 'pods' || zone.id === 'executive-office') continue;
        if (zone.id === 'pantry') {
            for (let tx = 0; tx < 11; tx++) {
                for (let ty = 0; ty < 11; ty++) {
                    g.fillStyle((tx + ty) % 2 === 0 ? COLORS.pantryTileA : COLORS.pantryTileB, 1);
                    g.fillRect(zone.bounds.x + tx * TILE_SIZE, zone.bounds.y + ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                }
            }
            continue;
        }
        g.fillStyle(zone.floorColor, 1);
        g.fillRect(zone.bounds.x, zone.bounds.y, zone.bounds.w, zone.bounds.h);
    }
}

export function drawZoneFrames(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    for (const zone of OFFICE_ZONES) {
        if (zone.id === 'pods') continue;
        if (zone.wallWidth <= 0) continue;
        g.lineStyle(zone.wallWidth, zone.wallColor, zone.wallAlpha);
        g.strokeRect(zone.bounds.x, zone.bounds.y, zone.bounds.w, zone.bounds.h);

        if (zone.doorGap) {
            g.fillStyle(zone.doorGap.fill ?? COLORS.floorWorkArea, 1);
            g.fillRect(zone.doorGap.x, zone.doorGap.y, zone.doorGap.w, zone.doorGap.h);
        }

        if (zone.icon) {
            scene.add
                .text(zone.bounds.x + zone.bounds.w / 2, zone.bounds.y + 14, `${zone.icon} ${zone.name}`, {
                    ...TEXT.roomLabel,
                    color: zone.labelColor
                })
                .setOrigin(0.5);
        }
    }
}

export function drawSubtleGrid(g: Phaser.GameObjects.Graphics) {
    g.lineStyle(1, COLORS.grid, 0.12);
    g.beginPath();
    for (let i = 0; i <= GRID_SIZE_PX; i += TILE_SIZE) {
        g.moveTo(i, 0).lineTo(i, GRID_SIZE_PX);
        g.moveTo(0, i).lineTo(GRID_SIZE_PX, i);
    }
    g.strokePath();
}

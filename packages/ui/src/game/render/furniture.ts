import Phaser from 'phaser';
import { COLORS, LAYOUT, TEXT, TILE_SIZE } from '../theme';

export type PodZone = {
    label: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: number;
};

const POD_ZONES: PodZone[] = [
    { label: 'ENGINEERING', x1: 3, y1: 8, x2: 11, y2: 16, color: COLORS.podEngineering },
    { label: 'OPS · STRATEGY', x1: 15, y1: 8, x2: 23, y2: 16, color: COLORS.podOps },
    { label: 'GROWTH', x1: 27, y1: 8, x2: 35, y2: 13, color: COLORS.podGrowth }
];

export function drawFurniture(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    drawMeetingFurniture(g);
    drawCollaborationFurniture(g);
    drawWorkstations(scene, g);
    drawPantryFurniture(scene, g);
    drawDecorations(scene, g);
    drawPodZones(scene, g, POD_ZONES);
    drawExecutiveOffice(scene, g);
    drawMeetingTableMarker(scene, g);
    drawBillboard(scene, g);
}

function drawMeetingFurniture(g: Phaser.GameObjects.Graphics) {
    g.fillStyle(COLORS.woodMid, 1);
    g.fillRect(72, 80, 120, 60);
    g.fillStyle(COLORS.woodLight, 1);
    g.fillRect(76, 84, 112, 52);

    const chairs = [
        [92, 72], [132, 72], [172, 72],
        [92, 148], [132, 148], [172, 148],
        [64, 100], [64, 128],
        [200, 100], [200, 128]
    ];
    for (const [cx, cy] of chairs) {
        g.fillStyle(COLORS.chair, 1);
        g.fillCircle(cx, cy, 6);
        g.fillStyle(0x5a5a7a, 1);
        g.fillCircle(cx, cy, 4);
    }

    g.fillStyle(COLORS.neutralLight, 1);
    g.fillRect(48, 36, 60, 30);
    g.lineStyle(2, COLORS.slate, 1);
    g.strokeRect(48, 36, 60, 30);

    g.lineStyle(1, COLORS.accentBlue, 0.6);
    g.beginPath();
    g.moveTo(54, 46); g.lineTo(70, 42); g.lineTo(85, 50); g.lineTo(100, 44);
    g.strokePath();

    g.lineStyle(1, COLORS.accentRed, 0.6);
    g.beginPath();
    g.moveTo(54, 54); g.lineTo(75, 58); g.lineTo(95, 52);
    g.strokePath();
}

function drawCollaborationFurniture(g: Phaser.GameObjects.Graphics) {
    drawStandingDeskWithLaptop(g, 300, 70);
    drawStandingDeskWithLaptop(g, 410, 70);

    g.fillStyle(COLORS.wallCollaboration, 0.6);
    g.fillCircle(320, 150, 14);
    g.fillStyle(COLORS.accentGold, 0.6);
    g.fillCircle(370, 155, 14);
    g.fillStyle(COLORS.accentPurple, 0.6);
    g.fillCircle(430, 148, 14);
}

function drawStandingDeskWithLaptop(g: Phaser.GameObjects.Graphics, x: number, y: number) {
    g.fillStyle(COLORS.woodDark, 1);
    g.fillRect(x, y, 48, 28);
    g.fillStyle(0x6a4e38, 1);
    g.fillRect(x + 2, y + 2, 44, 24);

    const lx = x + 12;
    const ly = y + 6;
    g.fillStyle(COLORS.slate, 1);
    g.fillRect(lx, ly, 16, 10);
    g.fillStyle(COLORS.charcoal, 1);
    g.fillRect(lx + 1, ly + 1, 14, 8);
    g.fillStyle(COLORS.slate, 1);
    g.fillRect(lx - 1, ly + 10, 18, 3);
}

function drawWorkstations(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    const stations = [
        { x: 64, y: 240, label: "💻 Alice's Desk", occupied: true },
        { x: 64, y: 320, label: "💻 Bob's Desk", occupied: true },
        { x: 64, y: 400, label: '💻 Vacant', occupied: false }
    ];

    for (const station of stations) {
        drawWorkstation(scene, g, station.x, station.y, station.label, station.occupied);
    }
}

function drawWorkstation(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, x: number, y: number, label: string, occupied: boolean) {
    g.fillStyle(COLORS.woodDark, 1);
    g.fillRect(x, y, 56, 28);
    g.fillStyle(COLORS.woodMid, 1);
    g.fillRect(x + 2, y + 2, 52, 24);

    g.fillStyle(COLORS.charcoal, 1);
    g.fillRect(x + 6, y + 3, 22, 14);
    g.fillStyle(occupied ? COLORS.occupiedScreen : COLORS.charcoal, 1);
    g.fillRect(x + 8, y + 5, 18, 10);
    g.fillStyle(COLORS.slate, 1);
    g.fillRect(x + 14, y + 17, 10, 3);
    g.fillRect(x + 10, y + 20, 18, 2);

    g.fillStyle(COLORS.neutralMid, 1);
    g.fillRect(x + 6, y + 22, 18, 4);
    g.fillRect(x + 28, y + 22, 5, 4);

    g.fillStyle(0xffeaa7, 1);
    g.fillRect(x + 36, y + 6, 12, 16);
    g.lineStyle(1, COLORS.accentGold, 0.8);
    g.beginPath();
    g.moveTo(x + 38, y + 10); g.lineTo(x + 46, y + 10);
    g.moveTo(x + 38, y + 14); g.lineTo(x + 46, y + 14);
    g.moveTo(x + 38, y + 18); g.lineTo(x + 44, y + 18);
    g.strokePath();

    g.fillStyle(COLORS.accentBlue, 1);
    g.fillRect(x + 50, y + 8, 2, 12);

    g.fillStyle(COLORS.accentRed, 1);
    g.fillCircle(x + 37, y + 24, 3);
    g.fillStyle(COLORS.charcoal, 1);
    g.fillCircle(x + 37, y + 24, 1.5);

    g.fillStyle(COLORS.charcoal, 1);
    g.fillCircle(x + 22, y + 38, 8);
    g.fillStyle(occupied ? COLORS.accentPurple : COLORS.chair, 1);
    g.fillCircle(x + 22, y + 38, 6);

    scene.add.text(x + 28, y - 6, label, TEXT.workstationLabel).setOrigin(0.5);
}

function drawPantryFurniture(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    g.fillStyle(COLORS.woodDark, 1);
    g.fillRect(370, 380, 80, 20);
    g.fillStyle(COLORS.woodMid, 1);
    g.fillRect(372, 382, 76, 16);

    g.fillStyle(COLORS.charcoal, 1);
    g.fillRect(380, 370, 20, 24);
    g.fillStyle(COLORS.slate, 1);
    g.fillRect(382, 372, 16, 12);
    g.fillStyle(COLORS.accentRed, 1);
    g.fillCircle(390, 390, 2);

    g.fillStyle(COLORS.neutralLight, 1);
    g.fillRect(410, 372, 20, 16);
    g.fillStyle(COLORS.charcoal, 1);
    g.fillRect(412, 374, 12, 12);
    g.fillStyle(COLORS.wallPantry, 1);
    g.fillRect(427, 376, 2, 2);

    g.fillStyle(COLORS.woodDark, 1);
    g.fillRect(380, 440, 40, 30);
    g.fillStyle(COLORS.woodMid, 1);
    g.fillRect(382, 442, 36, 26);
    g.fillStyle(COLORS.accentGold, 1);
    g.fillCircle(392, 452, 4);
    g.fillStyle(COLORS.wallCollaboration, 1);
    g.fillCircle(400, 450, 3);
    g.fillStyle(COLORS.wallPantry, 1);
    g.fillCircle(408, 454, 4);

    g.fillStyle(COLORS.chair, 1);
    g.fillCircle(375, 445, 5);
    g.fillCircle(375, 460, 5);
    g.fillCircle(425, 445, 5);
    g.fillCircle(425, 460, 5);

    g.fillStyle(COLORS.occupiedScreen, 0.6);
    g.fillRect(470, 380, 12, 24);
    g.fillStyle(COLORS.neutralLight, 1);
    g.fillRect(468, 404, 16, 16);
    g.fillStyle(COLORS.occupiedScreen, 0.4);
    g.fillRect(470, 382, 8, 16);
    scene.add.text(476, 424, '💧', { fontSize: '8px' }).setOrigin(0.5);
}

function drawDecorations(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    [
        [24, 210], [140, 210], [250, 210], [530, 380], [24, 500], [550, 200]
    ].forEach(([x, y]) => drawPlant(g, x, y));

    g.fillStyle(COLORS.woodDark, 1);
    g.fillRect(540, 50, 40, 80);
    g.fillStyle(COLORS.woodMid, 1);
    g.fillRect(542, 52, 36, 18);
    g.fillRect(542, 72, 36, 18);
    g.fillRect(542, 92, 36, 18);

    const bookColors = [COLORS.accentRed, COLORS.accentBlue, COLORS.accentGold, COLORS.wallPantry, COLORS.accentPurple, COLORS.wallCollaboration];
    for (let b = 0; b < 6; b++) g.fillStyle(bookColors[b], 1).fillRect(544 + b * 5, 54, 4, 14);
    for (let b = 0; b < 5; b++) g.fillStyle(bookColors[b + 1], 1).fillRect(544 + b * 6, 74, 4, 14);

    g.fillStyle(COLORS.neutralLight, 1);
    g.fillRect(540, 140, 30, 18);
    g.fillStyle(COLORS.neutralMid, 1);
    g.fillRect(542, 142, 26, 10);
    g.fillStyle(COLORS.charcoal, 1);
    g.fillRect(545, 155, 6, 2);
    scene.add.text(555, 164, '🖨️', { fontSize: '8px' }).setOrigin(0.5);

    g.fillStyle(COLORS.accentPurple, 0.15);
    g.fillRect(200, 240, 120, 80);
    g.lineStyle(1, COLORS.accentPurple, 0.3);
    g.strokeRect(200, 240, 120, 80);
}

function drawPlant(g: Phaser.GameObjects.Graphics, px: number, py: number) {
    g.fillStyle(0x8b4513, 1);
    g.fillRect(px - 5, py, 10, 8);
    g.fillStyle(0xa0522d, 1);
    g.fillRect(px - 4, py + 1, 8, 6);
    g.fillStyle(0x3e2723, 1);
    g.fillRect(px - 3, py, 6, 2);
    g.fillStyle(COLORS.accentGreen, 1);
    g.fillCircle(px, py - 4, 6);
    g.fillStyle(COLORS.accentMint, 1);
    g.fillCircle(px - 3, py - 6, 4);
    g.fillCircle(px + 4, py - 5, 4);
}

function drawPodZones(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, zones: PodZone[]) {
    for (const zone of zones) {
        const px = zone.x1 * TILE_SIZE;
        const py = zone.y1 * TILE_SIZE;
        const pw = (zone.x2 - zone.x1) * TILE_SIZE;
        const ph = (zone.y2 - zone.y1) * TILE_SIZE;
        g.fillStyle(zone.color, 0.1);
        g.fillRect(px, py, pw, ph);
        g.lineStyle(2, zone.color, 0.55);
        g.strokeRect(px, py, pw, ph);
        scene.add.text(px + 6, py + 4, zone.label, TEXT.podLabel).setDepth(2).setAlpha(0.75);
    }
}

function drawExecutiveOffice(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    const { x1, y1, x2, y2, doorY } = LAYOUT.executiveOfficeTiles;
    const x = x1 * TILE_SIZE;
    const y = y1 * TILE_SIZE;
    const w = (x2 - x1) * TILE_SIZE;
    const h = (y2 - y1) * TILE_SIZE;

    g.fillStyle(COLORS.executiveFill, 0.85);
    g.fillRect(x, y, w, h);
    g.lineStyle(3, COLORS.executiveWall, 0.9);
    g.strokeRect(x, y, w, h);
    g.fillStyle(0x16213e, 1);
    g.fillRect(x - 2, doorY * TILE_SIZE - 4, 4, 8);

    scene.add.text(x + 6, y + 4, 'CEO OFFICE', { ...TEXT.podLabel, color: '#ff9f80' }).setDepth(2);

    g.fillStyle(COLORS.woodMid, 1);
    g.fillRect(32 * TILE_SIZE - 12, 30 * TILE_SIZE - 8, 24, 16);
    g.fillStyle(COLORS.charcoal, 1);
    g.fillRect(32 * TILE_SIZE - 8, 30 * TILE_SIZE - 6, 10, 6);
}

function drawMeetingTableMarker(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    const x = 20 * TILE_SIZE;
    const y = 22 * TILE_SIZE;
    g.fillStyle(COLORS.woodMid, 1);
    g.fillRect(x - 28, y - 12, 56, 24);
    g.lineStyle(1, 0x000000, 0.4);
    g.strokeRect(x - 28, y - 12, 56, 24);
    scene.add
        .text(x, y + 16, 'MEETING TABLE', TEXT.furnitureLabel)
        .setOrigin(0.5, 0)
        .setDepth(2)
        .setAlpha(0.7);
}

function drawBillboard(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics) {
    const bbX = 20 * TILE_SIZE;
    const bbY = 2 * TILE_SIZE;
    g.fillStyle(0xffffff, 1);
    g.fillRect(bbX - 80, bbY - 18, 160, 42);
    g.lineStyle(2, COLORS.accentPurple, 1);
    g.strokeRect(bbX - 80, bbY - 18, 160, 42);

    if (scene.textures.exists('xylon-logo')) {
        const logo = scene.add.image(bbX, bbY + 3, 'xylon-logo');
        logo.setDisplaySize(150, 31);
        logo.setDepth(3);
    } else {
        scene.add
            .text(bbX, bbY + 3, 'Xylon Devs', {
                fontSize: '16px',
                color: '#111827',
                fontStyle: 'bold',
                fontFamily: 'Arial'
            })
            .setOrigin(0.5)
            .setDepth(3);
    }

    g.fillStyle(COLORS.slate, 1);
    g.fillRect(bbX - 60, bbY + 24, 4, 10);
    g.fillRect(bbX + 56, bbY + 24, 4, 10);
}

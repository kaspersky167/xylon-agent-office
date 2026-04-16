import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import { OfficeState, AgentState } from './schema';
import { UIEvents, emitUIEvent, eventBus } from '../events';

let activeRoom: Colyseus.Room<OfficeState> | undefined;

export function getColyseusRoom() {
    return activeRoom;
}

function resolveWsEndpoint(): string {
    if (typeof window !== 'undefined') {
        const queryWs = new URLSearchParams(window.location.search).get('ws');
        if (queryWs && queryWs.trim()) {
            window.localStorage.setItem('agent-office:ws-url', queryWs.trim());
            return queryWs.trim();
        }
        const savedWs = window.localStorage.getItem('agent-office:ws-url');
        if (savedWs && savedWs.trim()) return savedWs.trim();
    }
    const globalEndpoint = typeof window !== 'undefined'
        ? (window as any).__AGENT_OFFICE_WS_URL as string | undefined
        : undefined;
    if (globalEndpoint && globalEndpoint.trim()) return globalEndpoint.trim();
    if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.hostname}:3000`;
    }
    return 'ws://localhost:3000';
}

export class OfficeScene extends Phaser.Scene {
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private room?: Colyseus.Room;
    private agentSprites: Map<string, Phaser.GameObjects.Container> = new Map();
    private statusText!: Phaser.GameObjects.Text;
    private selectedFollowTarget: Phaser.GameObjects.Container | null = null;
    private cinematicFollowTarget: Phaser.GameObjects.Container | null = null;
    private selectedAgentId: string | null = null;
    private hoveredAgentId: string | null = null;
    private cinematicMode = true;
    private cinematicReleaseAt = 0;
    private customLayoutLayer?: Phaser.GameObjects.Container;
    private layoutItems: Array<{ id: string; type: string; x: number; y: number; label?: string }> = [];
    private layoutEditMode = false;
    private layoutDragItemId: string | null = null;
    private gridSize = 40 * 16;
    private heldMoveKeys: Set<'left' | 'right' | 'up' | 'down'> = new Set();
    private agentUiSnapshot: Map<string, { name: string; action: string; status: string }> = new Map();
    private agentSelectionRing: Map<string, Phaser.GameObjects.Graphics> = new Map();

    constructor() {
        super('OfficeScene');
    }

    preload() {
        for (let i = 0; i <= 5; i++) {
            this.load.spritesheet(`char_${i}`, `/assets/characters/char_${i}.png`, {
                frameWidth: 16,
                frameHeight: 32
            });
        }
        // Phaser supports SVG via `load.svg`
        this.load.svg('xylon-logo', '/xylon-logo.svg', { width: 300, height: 62 });
    }

    create() {
        try {
            console.log("Phaser create() started");
            this.statusText = this.add.text(10, 10, 'Colyseus Sync: Connecting...', { color: '#ffffaa', fontSize: '14px' });
            this.statusText.setScrollFactor(0);
            this.statusText.setDepth(100);

            let hasAnims = false;

            const anims = this.anims;
            for (let i = 0; i <= 5; i++) {
                const charKey = `char_${i}`;
                if (!this.textures.exists(charKey)) continue;
                anims.create({ key: `${charKey}-walk-down`, frames: anims.generateFrameNumbers(charKey, { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
                anims.create({ key: `${charKey}-walk-up`, frames: anims.generateFrameNumbers(charKey, { start: 7, end: 9 }), frameRate: 8, repeat: -1 });
                anims.create({ key: `${charKey}-walk-right`, frames: anims.generateFrameNumbers(charKey, { start: 14, end: 16 }), frameRate: 8, repeat: -1 });
                hasAnims = true;
            }

            console.log("Animations created: ", hasAnims);

            const gridSize = this.gridSize;
            const g = this.add.graphics();

            // ═══════════════════════════════════════════
            //  FLOORING
            // ═══════════════════════════════════════════

            // Main office floor (warm grey carpet)
            g.fillStyle(0x2d2d3d, 1);
            g.fillRect(0, 0, gridSize, gridSize);

            // Work area floor (slightly lighter)
            g.fillStyle(0x33334a, 1);
            g.fillRect(16, 16, gridSize - 32, gridSize - 32);

            // Meeting room carpet (purple-tinted)
            g.fillStyle(0x352a45, 1);
            g.fillRect(32, 32, 200, 160);

            // Collab area carpet (warm orange-tinted)
            g.fillStyle(0x3d3025, 1);
            g.fillRect(280, 32, 200, 160);

            // Coffee area tiles (subtle checkerboard)
            for (let tx = 0; tx < 11; tx++) {
                for (let ty = 0; ty < 11; ty++) {
                    g.fillStyle((tx + ty) % 2 === 0 ? 0x2a3a2a : 0x253025, 1);
                    g.fillRect(350 + tx * 16, 350 + ty * 16, 16, 16);
                }
            }

            // ═══════════════════════════════════════════
            //  WALLS & PARTITIONS
            // ═══════════════════════════════════════════

            // Meeting room walls
            g.lineStyle(3, 0x6c5ce7, 0.9);
            g.strokeRect(32, 32, 200, 160);
            // Door gap (bottom-right of meeting room)
            g.fillStyle(0x33334a, 1);
            g.fillRect(192, 188, 40, 6);

            // Collab area walls
            g.lineStyle(3, 0xe17055, 0.9);
            g.strokeRect(280, 32, 200, 160);
            // Door gap
            g.fillStyle(0x33334a, 1);
            g.fillRect(280, 160, 40, 6);

            // Coffee area border
            g.lineStyle(2, 0x00b894, 0.7);
            g.strokeRect(350, 350, 176, 176);
            // Door gap
            g.fillStyle(0x33334a, 1);
            g.fillRect(350, 410, 4, 40);

            // Room labels
            this.add.text(132, 46, '🏢 Meeting Room', { fontSize: '10px', color: '#b8a9d4' }).setOrigin(0.5);
            this.add.text(380, 46, '💡 Collab Area', { fontSize: '10px', color: '#e8a87c' }).setOrigin(0.5);
            this.add.text(438, 364, '☕ Coffee & Pantry', { fontSize: '10px', color: '#7fcdaa' }).setOrigin(0.5);

            // ═══════════════════════════════════════════
            //  MEETING ROOM FURNITURE
            // ═══════════════════════════════════════════

            // Large meeting table
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(72, 80, 120, 60);
            g.fillStyle(0x7d5c3e, 1);
            g.fillRect(76, 84, 112, 52); // table top highlight

            // Chairs around meeting table (pixel circles)
            const chairColor = 0x4a4a6a;
            const chairs = [[92, 72], [132, 72], [172, 72], // top row
            [92, 148], [132, 148], [172, 148], // bottom row
            [64, 100], [64, 128], // left
            [200, 100], [200, 128]]; // right
            chairs.forEach(([cx, cy]) => {
                g.fillStyle(chairColor, 1);
                g.fillCircle(cx, cy, 6);
                g.fillStyle(0x5a5a7a, 1);
                g.fillCircle(cx, cy, 4);
            });

            // Whiteboard on meeting room wall
            g.fillStyle(0xdfe6e9, 1);
            g.fillRect(48, 36, 60, 30);
            g.lineStyle(2, 0x636e72, 1);
            g.strokeRect(48, 36, 60, 30);
            // Whiteboard scribbles
            g.lineStyle(1, 0x0984e3, 0.6);
            g.beginPath();
            g.moveTo(54, 46); g.lineTo(70, 42); g.lineTo(85, 50); g.lineTo(100, 44);
            g.strokePath();
            g.lineStyle(1, 0xd63031, 0.6);
            g.beginPath();
            g.moveTo(54, 54); g.lineTo(75, 58); g.lineTo(95, 52);
            g.strokePath();

            // ═══════════════════════════════════════════
            //  COLLAB AREA FURNITURE
            // ═══════════════════════════════════════════

            // Standing desks (2 side by side)
            g.fillStyle(0x5a3e28, 1);
            g.fillRect(300, 70, 48, 28);
            g.fillStyle(0x6a4e38, 1);
            g.fillRect(302, 72, 44, 24);

            g.fillStyle(0x5a3e28, 1);
            g.fillRect(410, 70, 48, 28);
            g.fillStyle(0x6a4e38, 1);
            g.fillRect(412, 72, 44, 24);

            // Laptops on standing desks
            const drawLaptop = (lx: number, ly: number) => {
                g.fillStyle(0x636e72, 1);
                g.fillRect(lx, ly, 16, 10); // screen
                g.fillStyle(0x2d3436, 1);
                g.fillRect(lx + 1, ly + 1, 14, 8);
                g.fillStyle(0x636e72, 1);
                g.fillRect(lx - 1, ly + 10, 18, 3); // keyboard
            };
            drawLaptop(312, 76);
            drawLaptop(424, 76);

            // Bean bags / lounge chairs in collab
            g.fillStyle(0xe17055, 0.6);
            g.fillCircle(320, 150, 14);
            g.fillStyle(0xfdcb6e, 0.6);
            g.fillCircle(370, 155, 14);
            g.fillStyle(0x6c5ce7, 0.6);
            g.fillCircle(430, 148, 14);

            // ═══════════════════════════════════════════
            //  WORK DESKS (with chairs in front)
            // ═══════════════════════════════════════════

            const drawWorkstation = (x: number, y: number, label: string, occupied: boolean) => {
                // Desk surface
                g.fillStyle(0x5a3e28, 1);
                g.fillRect(x, y, 56, 28);
                g.fillStyle(0x6d4c2e, 1);
                g.fillRect(x + 2, y + 2, 52, 24);

                // Monitor
                g.fillStyle(0x2d3436, 1);
                g.fillRect(x + 6, y + 3, 22, 14); // bezel
                g.fillStyle(occupied ? 0x74b9ff : 0x2d3436, 1);
                g.fillRect(x + 8, y + 5, 18, 10); // screen glow
                g.fillStyle(0x636e72, 1);
                g.fillRect(x + 14, y + 17, 10, 3); // stand
                g.fillRect(x + 10, y + 20, 18, 2); // base

                // Keyboard
                g.fillStyle(0xb2bec3, 1);
                g.fillRect(x + 6, y + 22, 18, 4);

                // Mouse
                g.fillStyle(0xb2bec3, 1);
                g.fillRect(x + 28, y + 22, 5, 4);

                // Notepad
                g.fillStyle(0xffeaa7, 1);
                g.fillRect(x + 36, y + 6, 12, 16);
                g.lineStyle(1, 0xfdcb6e, 0.8);
                g.beginPath();
                g.moveTo(x + 38, y + 10); g.lineTo(x + 46, y + 10);
                g.moveTo(x + 38, y + 14); g.lineTo(x + 46, y + 14);
                g.moveTo(x + 38, y + 18); g.lineTo(x + 44, y + 18);
                g.strokePath();

                // Pen
                g.fillStyle(0x0984e3, 1);
                g.fillRect(x + 50, y + 8, 2, 12);

                // Coffee mug
                g.fillStyle(0xd63031, 1);
                g.fillCircle(x + 37, y + 24, 3);
                g.fillStyle(0x2d3436, 1);
                g.fillCircle(x + 37, y + 24, 1.5);

                // Office chair (below desk)
                g.fillStyle(0x2d3436, 1);
                g.fillCircle(x + 22, y + 38, 8);
                g.fillStyle(occupied ? 0x6c5ce7 : 0x4a4a6a, 1);
                g.fillCircle(x + 22, y + 38, 6);

                // Label
                this.add.text(x + 28, y - 6, label, { fontSize: '8px', color: '#a0a0c0' }).setOrigin(0.5);
            };

            drawWorkstation(64, 240, '💻 Alice\'s Desk', true);
            drawWorkstation(64, 320, '💻 Bob\'s Desk', true);
            drawWorkstation(64, 400, '💻 Vacant', false);

            // ═══════════════════════════════════════════
            //  COFFEE & PANTRY AREA
            // ═══════════════════════════════════════════

            // Counter
            g.fillStyle(0x5a3e28, 1);
            g.fillRect(370, 380, 80, 20);
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(372, 382, 76, 16);

            // Coffee machine
            g.fillStyle(0x2d3436, 1);
            g.fillRect(380, 370, 20, 24);
            g.fillStyle(0x636e72, 1);
            g.fillRect(382, 372, 16, 12);
            g.fillStyle(0xd63031, 1);
            g.fillCircle(390, 390, 2); // power light

            // Microwave
            g.fillStyle(0xdfe6e9, 1);
            g.fillRect(410, 372, 20, 16);
            g.fillStyle(0x2d3436, 1);
            g.fillRect(412, 374, 12, 12);
            g.fillStyle(0x00b894, 1);
            g.fillRect(427, 376, 2, 2); // light

            // Small table with snacks
            g.fillStyle(0x5a3e28, 1);
            g.fillRect(380, 440, 40, 30);
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(382, 442, 36, 26);
            // Fruit bowl
            g.fillStyle(0xfdcb6e, 1);
            g.fillCircle(392, 452, 4);
            g.fillStyle(0xe17055, 1);
            g.fillCircle(400, 450, 3);
            g.fillStyle(0x00b894, 1);
            g.fillCircle(408, 454, 4);

            // Chairs around snack table
            g.fillStyle(0x4a4a6a, 1);
            g.fillCircle(375, 445, 5);
            g.fillCircle(375, 460, 5);
            g.fillCircle(425, 445, 5);
            g.fillCircle(425, 460, 5);

            // Water cooler
            g.fillStyle(0x74b9ff, 0.6);
            g.fillRect(470, 380, 12, 24);
            g.fillStyle(0xdfe6e9, 1);
            g.fillRect(468, 404, 16, 16);
            g.fillStyle(0x74b9ff, 0.4);
            g.fillRect(470, 382, 8, 16); // water level
            this.add.text(476, 424, '💧', { fontSize: '8px' }).setOrigin(0.5);

            // ═══════════════════════════════════════════
            //  DECORATIONS
            // ═══════════════════════════════════════════

            // Potted plants
            const drawPlant = (px: number, py: number) => {
                // Pot
                g.fillStyle(0x8b4513, 1);
                g.fillRect(px - 5, py, 10, 8);
                g.fillStyle(0xa0522d, 1);
                g.fillRect(px - 4, py + 1, 8, 6);
                // Soil
                g.fillStyle(0x3e2723, 1);
                g.fillRect(px - 3, py, 6, 2);
                // Leaves
                g.fillStyle(0x27ae60, 1);
                g.fillCircle(px, py - 4, 6);
                g.fillStyle(0x2ecc71, 1);
                g.fillCircle(px - 3, py - 6, 4);
                g.fillCircle(px + 4, py - 5, 4);
            };

            drawPlant(24, 210);   // near desks
            drawPlant(140, 210);  // between meeting room and desks
            drawPlant(250, 210);  // center
            drawPlant(530, 380);  // near coffee area
            drawPlant(24, 500);   // bottom left
            drawPlant(550, 200);  // right side

            // Bookshelf on right wall
            g.fillStyle(0x5a3e28, 1);
            g.fillRect(540, 50, 40, 80);
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(542, 52, 36, 18); // shelf 1
            g.fillRect(542, 72, 36, 18); // shelf 2
            g.fillRect(542, 92, 36, 18); // shelf 3
            // Books
            const bookColors = [0xd63031, 0x0984e3, 0xfdcb6e, 0x00b894, 0x6c5ce7, 0xe17055];
            for (let b = 0; b < 6; b++) {
                g.fillStyle(bookColors[b], 1);
                g.fillRect(544 + b * 5, 54, 4, 14);
            }
            for (let b = 0; b < 5; b++) {
                g.fillStyle(bookColors[b + 1], 1);
                g.fillRect(544 + b * 6, 74, 4, 14);
            }

            // Printer
            g.fillStyle(0xdfe6e9, 1);
            g.fillRect(540, 140, 30, 18);
            g.fillStyle(0xb2bec3, 1);
            g.fillRect(542, 142, 26, 10);
            g.fillStyle(0x2d3436, 1);
            g.fillRect(545, 155, 6, 2); // paper slot
            this.add.text(555, 164, '🖨️', { fontSize: '8px' }).setOrigin(0.5);

            // Welcome mat / rug at center
            g.fillStyle(0x6c5ce7, 0.15);
            g.fillRect(200, 240, 120, 80);
            g.lineStyle(1, 0x6c5ce7, 0.3);
            g.strokeRect(200, 240, 120, 80);

            // ═══════════════════════════════════════════
            //  XYLON DEVS STATIC LAYOUT — pods, CEO office, billboard
            // ═══════════════════════════════════════════
            const tile = 16;
            const drawPod = (label: string, x1: number, y1: number, x2: number, y2: number, color: number) => {
                const px = x1 * tile, py = y1 * tile, pw = (x2 - x1) * tile, ph = (y2 - y1) * tile;
                g.fillStyle(color, 0.10);
                g.fillRect(px, py, pw, ph);
                g.lineStyle(2, color, 0.55);
                g.strokeRect(px, py, pw, ph);
                this.add.text(px + 6, py + 4, label, {
                    fontSize: '9px', color: '#ffffff', fontStyle: 'bold'
                }).setDepth(2).setAlpha(0.75);
            };

            // Engineering pod (4 desks): Frontend+Backend+DevOps+Security — roughly (3..10, 8..16)
            drawPod('ENGINEERING', 3, 8, 11, 16, 0x0984e3);
            // Ops / Strategy pod (4 desks): Shepherd+Reality+Evidence+SEO — (15..22, 8..16)
            drawPod('OPS · STRATEGY', 15, 8, 23, 16, 0x00b894);
            // Growth pod (2 desks): Sales+Proposal — (27..34, 8..13)
            drawPod('GROWTH', 27, 8, 35, 13, 0xfdcb6e);

            // CEO private office — thicker walls, solid fill, door gap
            const ceoX1 = 27, ceoY1 = 26, ceoX2 = 36, ceoY2 = 34;
            g.fillStyle(0x2d2d5a, 0.85);
            g.fillRect(ceoX1 * tile, ceoY1 * tile, (ceoX2 - ceoX1) * tile, (ceoY2 - ceoY1) * tile);
            g.lineStyle(3, 0xe74c3c, 0.9);
            // top wall
            g.strokeRect(ceoX1 * tile, ceoY1 * tile, (ceoX2 - ceoX1) * tile, (ceoY2 - ceoY1) * tile);
            // "door" gap on the left wall (draw a blue rect over part of the left edge)
            g.fillStyle(0x16213e, 1);
            g.fillRect(ceoX1 * tile - 2, 30 * tile - 4, 4, 8);
            this.add.text(ceoX1 * tile + 6, ceoY1 * tile + 4, 'CEO OFFICE', {
                fontSize: '9px', color: '#ff9f80', fontStyle: 'bold'
            }).setDepth(2);
            // A desk inside the CEO office (visual)
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(32 * tile - 12, 30 * tile - 8, 24, 16);
            g.fillStyle(0x2d3436, 1);
            g.fillRect(32 * tile - 8, 30 * tile - 6, 10, 6);

            // Meeting table (center-bottom-ish) — subtle outline to make it obvious
            const mt = this.furnitureTargetPx(20, 22);
            g.fillStyle(0x6d4c2e, 1);
            g.fillRect(mt.x - 28, mt.y - 12, 56, 24);
            g.lineStyle(1, 0x000000, 0.4);
            g.strokeRect(mt.x - 28, mt.y - 12, 56, 24);
            this.add.text(mt.x, mt.y + 16, 'MEETING TABLE', {
                fontSize: '8px', color: '#dfe6f3'
            }).setOrigin(0.5, 0).setDepth(2).setAlpha(0.7);

            // ─── XYLON DEVS BILLBOARD (top of the office, near the whiteboard) ───
            const bbX = 20 * tile, bbY = 2 * tile;
            // Dark billboard backing with purple frame
            g.fillStyle(0xffffff, 1);
            g.fillRect(bbX - 80, bbY - 18, 160, 42);
            g.lineStyle(2, 0x6c5ce7, 1);
            g.strokeRect(bbX - 80, bbY - 18, 160, 42);
            if (this.textures.exists('xylon-logo')) {
                const logo = this.add.image(bbX, bbY + 3, 'xylon-logo');
                // Fit to billboard (original SVG is 300x62 → scale to ~150x31)
                logo.setDisplaySize(150, 31);
                logo.setDepth(3);
            } else {
                // Fallback text if SVG failed to load
                this.add.text(bbX, bbY + 3, 'Xylon Devs', {
                    fontSize: '16px', color: '#111827', fontStyle: 'bold', fontFamily: 'Arial'
                }).setOrigin(0.5).setDepth(3);
            }
            // Small "legs" underneath to make it billboard-shaped
            g.fillStyle(0x636e72, 1);
            g.fillRect(bbX - 60, bbY + 24, 4, 10);
            g.fillRect(bbX + 56, bbY + 24, 4, 10);

            // ═══════════════════════════════════════════
            //  SUBTLE GRID (very faint)
            // ═══════════════════════════════════════════
            g.lineStyle(1, 0x444466, 0.12);
            g.beginPath();
            for (let i = 0; i <= gridSize; i += 16) {
                g.moveTo(i, 0).lineTo(i, gridSize);
                g.moveTo(0, i).lineTo(gridSize, i);
            }
            g.strokePath();

            this.cameras.main.setBackgroundColor('#16213e');
            this.cameras.main.setZoom(2);
            this.cameras.main.centerOn(gridSize / 2, gridSize / 2);
            this.cameras.main.setBounds(0, 0, gridSize, gridSize);
            this.customLayoutLayer = this.add.container(0, 0);
            this.customLayoutLayer.setDepth(4);

            if (this.input.keyboard) {
                this.cursors = this.input.keyboard.createCursorKeys();
            }

            eventBus.addEventListener('cinematic-toggle', (e: Event) => {
                const detail = (e as CustomEvent).detail as { enabled: boolean };
                this.cinematicMode = Boolean(detail?.enabled);
                if (!this.cinematicMode) {
                    this.cinematicReleaseAt = 0;
                }
            });
            eventBus.addEventListener('layout-preview-update', (e: Event) => {
                const detail = (e as CustomEvent).detail as { items: Array<{ id: string; type: string; x: number; y: number; label?: string }> };
                this.layoutItems = Array.isArray(detail?.items) ? detail.items : [];
                this.renderCustomLayout(this.layoutItems);
            });
            eventBus.addEventListener('layout-edit-mode', (e: Event) => {
                const detail = (e as CustomEvent).detail as { enabled: boolean };
                this.layoutEditMode = Boolean(detail?.enabled);
                if (!this.layoutEditMode) this.layoutDragItemId = null;
            });

            this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
                if (!this.layoutEditMode || !this.layoutDragItemId || !pointer.isDown) return;
                const gx = Phaser.Math.Clamp(Math.round(pointer.worldX / 16), 2, 36);
                const gy = Phaser.Math.Clamp(Math.round(pointer.worldY / 16), 2, 36);
                this.layoutItems = this.layoutItems.map((item) =>
                    item.id === this.layoutDragItemId ? { ...item, x: gx, y: gy } : item
                );
                this.renderCustomLayout(this.layoutItems);
                eventBus.dispatchEvent(new CustomEvent('layout-item-moved', { detail: { items: this.layoutItems } }));
            });
            this.input.on('pointerup', () => {
                this.layoutDragItemId = null;
            });
            this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
                const nextZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 1, 3);
                this.cameras.main.setZoom(nextZoom);
            });

            const toMoveDirection = (event: KeyboardEvent): 'left' | 'right' | 'up' | 'down' | null => {
                const key = (event.key || '').toLowerCase();
                const code = (event.code || '').toLowerCase();
                if (key === 'arrowleft' || key === 'a' || code === 'arrowleft' || code === 'keya') return 'left';
                if (key === 'arrowright' || key === 'd' || code === 'arrowright' || code === 'keyd') return 'right';
                if (key === 'arrowup' || key === 'w' || code === 'arrowup' || code === 'keyw') return 'up';
                if (key === 'arrowdown' || key === 's' || code === 'arrowdown' || code === 'keys') return 'down';
                return null;
            };

            const keyDownHandler = (event: KeyboardEvent) => {
                const dir = toMoveDirection(event);
                if (!dir) return;
                const active = document.activeElement as HTMLElement | null;
                const isEditable = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.isContentEditable;
                if (isEditable) return;
                this.heldMoveKeys.add(dir);
                event.preventDefault();
            };
            const keyUpHandler = (event: KeyboardEvent) => {
                const dir = toMoveDirection(event);
                if (!dir) return;
                this.heldMoveKeys.delete(dir);
            };
            window.addEventListener('keydown', keyDownHandler, { capture: true });
            window.addEventListener('keyup', keyUpHandler, { capture: true });
            document.addEventListener('keydown', keyDownHandler, { capture: true });
            document.addEventListener('keyup', keyUpHandler, { capture: true });
            window.addEventListener('blur', () => this.heldMoveKeys.clear());
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
                window.removeEventListener('keydown', keyDownHandler, true);
                window.removeEventListener('keyup', keyUpHandler, true);
                document.removeEventListener('keydown', keyDownHandler, true);
                document.removeEventListener('keyup', keyUpHandler, true);
                this.heldMoveKeys.clear();
            });

            this.connectToServer();
        } catch (e) {
            console.error("CRITICAL PHASER ERROR", e);
        }
    }

    async connectToServer() {
        try {
            console.log("Connecting to Colyseus...");
            const wsEndpoint = resolveWsEndpoint();
            this.statusText.setText(`Colyseus Sync: Connecting to ${wsEndpoint}...`).setColor('#ffffaa');
            const client = new Colyseus.Client(wsEndpoint);
            this.room = await client.joinOrCreate('office');

            console.log("Room joined successfully!", this.room.sessionId);
            this.statusText.setText('Colyseus Sync: Connected (Waiting for state...)').setColor('#aaffaa');

            // Wait for the first actual state payload from the server before reading
            this.room.onStateChange.once((state: any) => {
                activeRoom = this.room as Colyseus.Room<OfficeState>;
                console.log("First state payload arrived!", state.toJSON());
                console.log("Agents map size:", state.agents?.size);
                this.statusText.setText('Colyseus Sync: Active!').setColor('#00ff00');

                // Bind chat bus
                this.room!.onMessage('chat', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('chat-message', { detail: message }));
                });
                this.room!.onMessage('task-update', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('task-update', { detail: message }));
                });
                this.room!.onMessage('tasks-sync', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('tasks-sync', { detail: message }));
                });
                this.room!.onMessage('highlight-event', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('highlight-event', { detail: message }));
                    if (this.cinematicMode && message?.agentId) {
                        this.focusAgentTemporarily(message.agentId);
                    }
                });
                this.room!.onMessage('scenario-event', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('scenario-event', { detail: message }));
                });
                this.room!.onMessage('relationship-update', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('relationship-update', { detail: message }));
                });
                this.room!.onMessage('approvals-sync', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('approvals-sync', { detail: message }));
                });
                this.room!.onMessage('meeting-state', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('meeting-state', { detail: message }));
                });
                this.room!.onMessage('fast-track-state', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('fast-track-state', { detail: message }));
                });
                this.room!.onMessage('completed-work-sync', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('completed-work-sync', { detail: message }));
                });
                this.room!.onMessage('layout-sync', (message: any) => {
                    this.layoutItems = Array.isArray(message?.layout) ? message.layout : [];
                    this.renderCustomLayout(this.layoutItems);
                    eventBus.dispatchEvent(new CustomEvent('layout-sync', { detail: { items: this.layoutItems } }));
                });
                this.room!.onMessage('file-list', (message: any) => {
                    emitUIEvent(UIEvents.desktopFilesSync, message);
                });
                this.room!.onMessage('file-preview', (message: any) => {
                    emitUIEvent(UIEvents.desktopFilePreview, message);
                });
                this.room!.onMessage('file-error', (message: any) => {
                    emitUIEvent(UIEvents.desktopFileError, message);
                });

                this.room!.send('file-list', { request: true });
                this.room!.send('request-completed-work', {});

                state.agents.onAdd((agent: AgentState, sessionId: string) => {
                    console.log(`[Colyseus] Agent added: ${agent.name} at (${agent.x}, ${agent.y})`);
                    const container = this.add.container(agent.x * 16, agent.y * 16);

                    let sprite;
                    const hash = Math.abs((sessionId || agent.name).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0));
                    const charKey = `char_${hash % 6}`;
                    const labelColor = ['#60a5fa', '#c4b5fd', '#34d399', '#f472b6', '#f59e0b', '#f87171'][hash % 6];

                    if (this.textures.exists(charKey)) {
                        sprite = this.add.sprite(0, -8, charKey, 0);
                    } else {
                        sprite = this.add.rectangle(0, -8, 16, 32, 0x3a86ff);
                    }

                    // Thought bubble (word-wrapped)
                    const thoughtBubble = this.add.text(0, -36, '', {
                        fontSize: '9px',
                        color: '#e0e0e0',
                        backgroundColor: '#1a1a3eee',
                        padding: { x: 5, y: 4 },
                        align: 'center',
                        wordWrap: { width: 130, useAdvancedWrap: true }
                    }).setOrigin(0.5, 1);
                    thoughtBubble.setVisible(false);

                    // Emote bubble (emoji above head)
                    const emoteBubble = this.add.text(8, -24, '', {
                        fontSize: '12px'
                    }).setOrigin(0.5);
                    emoteBubble.setVisible(false);

                    // Name label
                    const label = this.add.text(0, 16, agent.name, {
                        fontSize: '10px', color: '#ffffff',
                        backgroundColor: `${labelColor}66`, padding: { x: 3, y: 1 }
                    }).setOrigin(0.5, 0);

                    // Focus highlight ring (selected)
                    const focusRing = this.add.graphics();
                    focusRing.lineStyle(2, 0x6c5ce7, 0.9);
                    focusRing.strokeCircle(0, 0, 14);
                    focusRing.setVisible(false);
                    this.agentSelectionRing.set(sessionId, focusRing);

                    // Hover ring (temporary tint/outline)
                    const hoverRing = this.add.graphics();
                    hoverRing.lineStyle(1, 0xfbbf24, 0.95);
                    hoverRing.strokeCircle(0, 0, 16);
                    hoverRing.setVisible(false);

                    // Short-lived status chip for meaningful actions
                    const statusChip = this.add.text(0, -50, '', {
                        fontSize: '8px',
                        color: '#f3f4f6',
                        backgroundColor: '#0f172aee',
                        padding: { x: 4, y: 2 }
                    }).setOrigin(0.5, 1);
                    statusChip.setVisible(false);

                    container.add([hoverRing, focusRing, sprite, thoughtBubble, emoteBubble, statusChip, label]);
                    container.setSize(32, 48);
                    container.setInteractive({ useHandCursor: true });
                    this.agentSprites.set(sessionId, container);
                    this.agentUiSnapshot.set(sessionId, {
                        name: agent.name,
                        action: agent.action || 'idle',
                        status: this.composeAgentStatus(agent)
                    });

                    // --- SELECTION MODE: Click to follow ---
                    container.on('pointerover', () => {
                        this.hoveredAgentId = sessionId;
                        hoverRing.setVisible(this.selectedAgentId !== sessionId);
                        if ('setTint' in sprite) {
                            (sprite as Phaser.GameObjects.Sprite).setTint(0xfff1b3);
                        }
                        label.setStyle({ backgroundColor: `${labelColor}99` });
                        this.emitAgentUiEvent(UIEvents.agentHover, {
                            type: 'hover',
                            source: 'pointer',
                            agentId: sessionId,
                            selected: this.selectedAgentId === sessionId
                        });
                    });
                    container.on('pointerout', () => {
                        if (this.hoveredAgentId === sessionId) this.hoveredAgentId = null;
                        hoverRing.setVisible(false);
                        if ('clearTint' in sprite) {
                            (sprite as Phaser.GameObjects.Sprite).clearTint();
                        }
                        label.setStyle({ backgroundColor: `${labelColor}66` });
                        this.emitAgentUiEvent(UIEvents.agentHover, {
                            type: 'hover',
                            source: 'pointer',
                            agentId: null,
                            selected: false
                        });
                    });
                    container.on('pointerdown', () => {
                        const nextSelected = this.selectedAgentId === sessionId ? null : sessionId;
                        this.setSelectedAgent(nextSelected, 'pointer');
                        eventBus.dispatchEvent(new CustomEvent('agent-focus', {
                            detail: nextSelected ? { name: agent.name, id: sessionId } : null
                        }));
                    });

                    let prevX = agent.x;
                    let prevY = agent.y;
                    let lastAction = '';
                    let lastEmoteAt = 0;
                    let lastThoughtShown = '';
                    let lastThoughtAt = 0;
                    let lastStatusChipAt = 0;
                    let lastActivityKey = '';
                    const keyActionMap: Record<string, string> = {
                        work: 'Working',
                        talk: 'In conversation',
                        use_tool: 'Using tool',
                        think: 'Planning',
                        move: 'Moving'
                    };

                    agent.onChange(() => {
                        this.tweens.add({
                            targets: container,
                            x: agent.x * 16,
                            y: agent.y * 16,
                            duration: 100,
                            onComplete: () => {
                                if (sprite.type === 'Sprite') {
                                    (sprite as Phaser.GameObjects.Sprite).stop();
                                }
                            }
                        });

                        // Walk animation
                        if (sprite.type === 'Sprite') {
                            const s = sprite as Phaser.GameObjects.Sprite;
                            if (agent.x > prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(false); }
                            else if (agent.x < prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(true); }
                            else if (agent.y > prevY) { s.play(`${charKey}-walk-down`, true); }
                            else if (agent.y < prevY) { s.play(`${charKey}-walk-up`, true); }
                            else { s.stop(); }
                        }

                        // --- EMOTE BUBBLES based on action ---
                        const emoteMap: Record<string, string> = {
                            'work': '💻', 'talk': '💬', 'idle': '😌',
                            'use_tool': '🔧', 'move': '🚶', 'think': '💡'
                        };
                        const emote = emoteMap[agent.action] || '';
                        const now = Date.now();
                        const actionChanged = agent.action !== lastAction;
                        if (emote && actionChanged && now - lastEmoteAt > 2500 && agent.action !== 'idle') {
                            emoteBubble.setText(emote);
                            emoteBubble.setVisible(true);
                            this.time.delayedCall(1800, () => emoteBubble.setVisible(false));
                            lastEmoteAt = now;
                        } else if (agent.action === 'idle') {
                            emoteBubble.setVisible(false);
                        }

                        const keyActionLabel = keyActionMap[agent.action];
                        if (keyActionLabel && actionChanged && now - lastStatusChipAt > 1500) {
                            statusChip.setText(keyActionLabel);
                            statusChip.setVisible(true);
                            this.time.delayedCall(2000, () => statusChip.setVisible(false));
                            lastStatusChipAt = now;
                        }

                        // Thought bubble
                        const thought = (agent.thought || '').trim();
                        const meaningfulThought = thought.length >= 4 && thought !== lastThoughtShown && now - lastThoughtAt > 7000;
                        if (meaningfulThought) {
                            thoughtBubble.setText(thought);
                            thoughtBubble.setVisible(true);
                            this.time.delayedCall(4000, () => thoughtBubble.setVisible(false));
                            lastThoughtShown = thought;
                            lastThoughtAt = now;
                        } else if (!thought) {
                            thoughtBubble.setVisible(false);
                        }

                        const latestStatus = this.composeAgentStatus(agent);
                        this.agentUiSnapshot.set(sessionId, {
                            name: agent.name,
                            action: agent.action || 'idle',
                            status: latestStatus
                        });

                        // --- SYSTEM LOG EVENT ---
                        const activityKey = `${agent.action}:${thought}`;
                        if ((actionChanged || meaningfulThought) && activityKey !== lastActivityKey) {
                            eventBus.dispatchEvent(new CustomEvent('activity-log', {
                                detail: {
                                    agent: agent.name,
                                    action: agent.action,
                                    thought,
                                    time: new Date().toLocaleTimeString()
                                }
                            }));
                            lastActivityKey = activityKey;
                        }
                        eventBus.dispatchEvent(new CustomEvent('agent-telemetry', {
                            detail: {
                                id: sessionId,
                                name: agent.name,
                                mood: Number(agent.mood || 0),
                                reputation: Number(agent.reputation || 0),
                                riskLevel: Number(agent.riskLevel || 0),
                                momentum: Number(agent.momentum || 0),
                                action: agent.action
                            }
                        }));

                        lastAction = agent.action;
                        prevX = agent.x;
                        prevY = agent.y;
                    });
                });

                state.agents.onRemove((agent: AgentState, sessionId: string) => {
                    const sprite = this.agentSprites.get(sessionId);
                    if (sprite) {
                        sprite.destroy();
                        this.agentSprites.delete(sessionId);
                    }
                    this.agentUiSnapshot.delete(sessionId);
                    this.agentSelectionRing.delete(sessionId);
                    if (this.selectedAgentId === sessionId) {
                        this.setSelectedAgent(null, 'system');
                    }
                    if (this.cinematicFollowTarget === sprite) {
                        this.cinematicFollowTarget = null;
                    }
                });
            });

        } catch (e) {
            console.error(e);
            const wsEndpoint = resolveWsEndpoint();
            this.statusText.setText(`Colyseus Sync: Failed (${wsEndpoint})`).setColor('#ffaaaa');
        }
    }

    private getActiveFollowTarget() {
        return this.selectedFollowTarget ?? this.cinematicFollowTarget;
    }

    private composeAgentStatus(agent: AgentState) {
        const task = (agent.currentTask || '').trim();
        if (task) return task;
        const thought = (agent.thought || '').trim();
        if (thought) return thought;
        return (agent.action || 'idle').trim();
    }

    private emitAgentUiEvent(eventName: string, payload: {
        type: 'hover' | 'select' | 'focus';
        source: 'pointer' | 'selection' | 'cinematic' | 'system';
        agentId: string | null;
        selected?: boolean;
    }) {
        const snapshot = payload.agentId ? this.agentUiSnapshot.get(payload.agentId) : undefined;
        emitUIEvent(eventName, {
            ...payload,
            agentId: payload.agentId,
            agentName: snapshot?.name ?? null,
            action: snapshot?.action ?? null,
            status: snapshot?.status ?? null
        });
    }

    private setSelectedAgent(agentId: string | null, source: 'pointer' | 'system' = 'pointer') {
        this.selectedAgentId = agentId;
        this.selectedFollowTarget = agentId ? this.agentSprites.get(agentId) ?? null : null;
        this.agentSelectionRing.forEach((ring, id) => {
            ring.setVisible(Boolean(agentId) && id === agentId);
        });
        this.emitAgentUiEvent(UIEvents.agentSelect, {
            type: 'select',
            source: source === 'pointer' ? 'pointer' : 'system',
            agentId,
            selected: Boolean(agentId)
        });
        this.emitAgentUiEvent(UIEvents.agentFocus, {
            type: 'focus',
            source: 'selection',
            agentId,
            selected: Boolean(agentId)
        });
    }

    update() {
        if (this.cinematicReleaseAt > 0 && Date.now() > this.cinematicReleaseAt) {
            this.cinematicReleaseAt = 0;
            this.cinematicFollowTarget = null;
            this.emitAgentUiEvent(UIEvents.agentFocus, {
                type: 'focus',
                source: 'cinematic',
                agentId: this.selectedAgentId,
                selected: Boolean(this.selectedAgentId)
            });
        }
        const speed = 5;
        const manualPan =
            this.heldMoveKeys.size > 0 ||
            Boolean(this.cursors?.left.isDown) ||
            Boolean(this.cursors?.right.isDown) ||
            Boolean(this.cursors?.up.isDown) ||
            Boolean(this.cursors?.down.isDown);
        if (manualPan) {
            // User input should always win over cinematic follow.
            this.cinematicFollowTarget = null;
            this.cinematicReleaseAt = 0;
            if (this.cursors?.left.isDown || this.heldMoveKeys.has('left')) this.cameras.main.scrollX -= speed;
            if (this.cursors?.right.isDown || this.heldMoveKeys.has('right')) this.cameras.main.scrollX += speed;
            if (this.cursors?.up.isDown || this.heldMoveKeys.has('up')) this.cameras.main.scrollY -= speed;
            if (this.cursors?.down.isDown || this.heldMoveKeys.has('down')) this.cameras.main.scrollY += speed;
        }
        // If following an agent, smoothly track them
        const followTarget = this.getActiveFollowTarget();
        if (followTarget && !manualPan) {
            const cam = this.cameras.main;
            const targetX = followTarget.x - cam.width / (2 * cam.zoom);
            const targetY = followTarget.y - cam.height / (2 * cam.zoom);
            cam.scrollX += (targetX - cam.scrollX) * 0.08;
            cam.scrollY += (targetY - cam.scrollY) * 0.08;
        }
        const cam = this.cameras.main;
        const maxScrollX = Math.max(0, this.gridSize - cam.width / cam.zoom);
        const maxScrollY = Math.max(0, this.gridSize - cam.height / cam.zoom);
        cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, maxScrollX);
        cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, maxScrollY);
    }

    private focusAgentTemporarily(agentId: string) {
        const target = this.agentSprites.get(agentId);
        if (!target) return;
        this.cinematicFollowTarget = target;
        this.cinematicReleaseAt = Date.now() + 7000;
        this.emitAgentUiEvent(UIEvents.agentFocus, {
            type: 'focus',
            source: 'cinematic',
            agentId,
            selected: this.selectedAgentId === agentId
        });
    }

    private furnitureTargetPx(tx: number, ty: number) {
        return { x: tx * 16, y: ty * 16 };
    }

    private renderCustomLayout(items: Array<{ type: string; x: number; y: number; label?: string }>) {
        if (!this.customLayoutLayer) return;
        this.customLayoutLayer.removeAll(true);
        for (let index = 0; index < items.length; index++) {
            const source = items[index] as { id?: string; type: string; x: number; y: number; label?: string };
            const item = {
                ...source,
                id: source.id || `layout_${index}`
            };
            const x = Math.round(item.x) * 16;
            const y = Math.round(item.y) * 16;
            const group = this.add.container(x, y);
            const g = this.add.graphics();
            switch (item.type) {
                case 'plant':
                    g.fillStyle(0x8b4513, 1);
                    g.fillRect(-5, 0, 10, 8);
                    g.fillStyle(0x27ae60, 1);
                    g.fillCircle(0, -5, 6);
                    g.fillStyle(0x2ecc71, 1);
                    g.fillCircle(-3, -7, 4);
                    g.fillCircle(4, -6, 4);
                    break;
                case 'desk':
                    g.fillStyle(0x6d4c2e, 1);
                    g.fillRect(-12, -8, 24, 16);
                    g.fillStyle(0x2d3436, 1);
                    g.fillRect(-8, -6, 10, 6);
                    break;
                case 'bookshelf':
                    g.fillStyle(0x6d4c2e, 1);
                    g.fillRect(-8, -12, 16, 24);
                    g.fillStyle(0xfdcb6e, 1);
                    g.fillRect(-6, -8, 3, 6);
                    g.fillStyle(0x0984e3, 1);
                    g.fillRect(-2, -8, 3, 6);
                    g.fillStyle(0xe17055, 1);
                    g.fillRect(2, -8, 3, 6);
                    break;
                case 'coffee_machine':
                    g.fillStyle(0x2d3436, 1);
                    g.fillRect(-6, -8, 12, 16);
                    g.fillStyle(0xd63031, 1);
                    g.fillCircle(0, 4, 2);
                    break;
                case 'table':
                    g.fillStyle(0x6d4c2e, 1);
                    g.fillRect(-10, -6, 20, 12);
                    break;
                case 'chair':
                    g.fillStyle(0x4a4a6a, 1);
                    g.fillCircle(0, 0, 6);
                    break;
                case 'whiteboard':
                    g.fillStyle(0xdfe6e9, 1);
                    g.fillRect(-10, -6, 20, 12);
                    g.lineStyle(1, 0x636e72, 1);
                    g.strokeRect(-10, -6, 20, 12);
                    break;
                default:
                    g.fillStyle(0xb2bec3, 1);
                    g.fillRect(-6, -6, 12, 12);
            }
            group.add(g);
            if (item.label) {
                const label = this.add.text(0, 10, item.label.slice(0, 8), { fontSize: '8px', color: '#dfe6f3' }).setOrigin(0.5, 0);
                group.add(label);
            }
            group.setSize(22, 22);
            group.setInteractive(new Phaser.Geom.Rectangle(-11, -11, 22, 22), Phaser.Geom.Rectangle.Contains);
            group.on('pointerdown', () => {
                if (!this.layoutEditMode) return;
                this.layoutDragItemId = item.id;
            });
            this.customLayoutLayer.add(group);
        }
    }
}

export function setupPhaser(parentId: string) {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: parentId,
        width: window.innerWidth,
        height: window.innerHeight,
        scene: [OfficeScene],
        pixelArt: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
        },
        input: {
            keyboard: {
                capture: [] // Don't capture ANY keys globally — let React inputs work
            }
        }
    };

    const game = new Phaser.Game(config);

    // When ANY input/textarea/select is focused, fully disable Phaser keyboard
    // When they blur, re-enable it
    document.addEventListener('focusin', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard?.enabled && (game.input.keyboard.enabled = false);
        }
    });
    document.addEventListener('focusout', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard && (game.input.keyboard.enabled = true);
        }
    });

    return game;
}

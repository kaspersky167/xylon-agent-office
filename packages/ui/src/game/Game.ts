import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import { OfficeState, AgentState } from './schema';
import { UIEvents, emitUIEvent, eventBus } from '../events';
import { COLORS, GRID_SIZE_PX } from './theme';
import { drawOfficeBase, drawSubtleGrid, drawZoneFrames } from './render/zones';
import { drawFurniture } from './render/furniture';
import { AGENT_EMOTE_MAP, getAgentStyle } from './render/agents';

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
    private gridSize = GRID_SIZE_PX;
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

            const g = this.add.graphics();
            drawOfficeBase(g);
            drawZoneFrames(this, g);
            drawFurniture(this, g);
            drawSubtleGrid(g);

            this.cameras.main.setBackgroundColor(COLORS.background);
            this.cameras.main.setZoom(2);
            this.cameras.main.centerOn(this.gridSize / 2, this.gridSize / 2);
            this.cameras.main.setBounds(0, 0, this.gridSize, this.gridSize);
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
                    const { charKey, labelColor } = getAgentStyle(sessionId || agent.name);

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
                        eventBus.dispatchEvent(new CustomEvent('agent-state', {
                            detail: {
                                id: sessionId,
                                name: agent.name,
                                action: agent.action,
                                currentTask: agent.currentTask || '',
                                mood: Number(agent.mood || 0),
                                reputation: Number(agent.reputation || 0),
                                riskLevel: Number(agent.riskLevel || 0),
                                momentum: Number(agent.momentum || 0)
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

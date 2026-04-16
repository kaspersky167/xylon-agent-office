export const TILE_SIZE = 16;
export const GRID_TILES = 40;
export const GRID_SIZE_PX = GRID_TILES * TILE_SIZE;

export const LAYOUT = {
    inset: TILE_SIZE,
    roomBorderInset: TILE_SIZE * 2,
    meeting: { x: 32, y: 32, w: 200, h: 160 },
    collaboration: { x: 280, y: 32, w: 200, h: 160 },
    pantry: { x: 350, y: 350, w: 176, h: 176 },
    executiveOfficeTiles: { x1: 27, y1: 26, x2: 36, y2: 34, doorY: 30 }
} as const;

export const COLORS = {
    background: '#16213e',
    floorBase: 0x2d2d3d,
    floorWorkArea: 0x33334a,
    floorMeeting: 0x352a45,
    floorCollaboration: 0x3d3025,
    pantryTileA: 0x2a3a2a,
    pantryTileB: 0x253025,
    wallMeeting: 0x6c5ce7,
    wallCollaboration: 0xe17055,
    wallPantry: 0x00b894,
    woodDark: 0x5a3e28,
    woodMid: 0x6d4c2e,
    woodLight: 0x7d5c3e,
    charcoal: 0x2d3436,
    slate: 0x636e72,
    neutralLight: 0xdfe6e9,
    neutralMid: 0xb2bec3,
    accentBlue: 0x0984e3,
    accentPurple: 0x6c5ce7,
    accentRed: 0xd63031,
    accentGold: 0xfdcb6e,
    accentGreen: 0x27ae60,
    accentMint: 0x2ecc71,
    chair: 0x4a4a6a,
    occupiedScreen: 0x74b9ff,
    grid: 0x444466,
    podEngineering: 0x0984e3,
    podOps: 0x00b894,
    podGrowth: 0xfdcb6e,
    executiveWall: 0xe74c3c,
    executiveFill: 0x2d2d5a
} as const;

export const TEXT = {
    roomLabel: { fontSize: '10px' },
    podLabel: { fontSize: '9px', fontStyle: 'bold' as const, color: '#ffffff' },
    workstationLabel: { fontSize: '8px', color: '#a0a0c0' },
    furnitureLabel: { fontSize: '8px', color: '#dfe6f3' }
} as const;

import React from 'react';
import { controlRoomStyles, tokens } from '../../theme/tokens';

type PanelTone = 'default' | 'muted';

interface PanelProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
    tone?: PanelTone;
}

export function Panel({ children, style, tone = 'default' }: PanelProps) {
    const base = tone === 'muted' ? controlRoomStyles.panelMuted : controlRoomStyles.panel;
    return (
        <div style={{ ...base, padding: tokens.spacing.md, ...style }}>
            {children}
        </div>
    );
}

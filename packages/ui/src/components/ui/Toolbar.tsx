import React from 'react';
import { tokens } from '../../theme/tokens';

export function Toolbar({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{ display: 'flex', gap: tokens.spacing.xs, alignItems: 'center', flexWrap: 'wrap', ...style }}>
            {children}
        </div>
    );
}

import React from 'react';
import { tokens } from '../../theme/tokens';

interface ChipProps {
    children: React.ReactNode;
    tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
    onClick?: () => void;
}

const toneStyles = {
    default: { color: tokens.color.textSecondary, background: 'rgba(163,180,211,0.12)', borderColor: 'rgba(163,180,211,0.2)' },
    accent: { color: '#d8d0ff', background: tokens.color.accentSoft, borderColor: 'rgba(124,92,255,0.5)' },
    success: { color: '#c9ffe7', background: 'rgba(110,231,183,0.16)', borderColor: 'rgba(110,231,183,0.45)' },
    warning: { color: '#ffe7af', background: 'rgba(248,207,114,0.16)', borderColor: 'rgba(248,207,114,0.45)' },
    danger: { color: '#ffd3d3', background: 'rgba(255,154,154,0.14)', borderColor: 'rgba(255,154,154,0.42)' }
} as const;

export function Chip({ children, tone = 'default', onClick }: ChipProps) {
    const style = toneStyles[tone];
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                border: `1px solid ${style.borderColor}`,
                background: style.background,
                color: style.color,
                borderRadius: tokens.radius.pill,
                padding: '4px 9px',
                fontSize: tokens.typography.micro,
                cursor: onClick ? 'pointer' : 'default',
                boxShadow: tokens.shadow.chip
            }}
        >
            {children}
        </button>
    );
}

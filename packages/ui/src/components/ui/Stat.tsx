import React from 'react';
import { tokens } from '../../theme/tokens';

interface StatProps {
    label: string;
    value: string;
}

export function Stat({ label, value }: StatProps) {
    return (
        <div style={{
            border: `1px solid ${tokens.color.borderSoft}`,
            borderRadius: tokens.radius.sm,
            padding: `${tokens.spacing.xs}px ${tokens.spacing.sm}px`,
            background: 'rgba(12,18,38,0.75)'
        }}>
            <div style={{ fontSize: tokens.typography.micro, color: tokens.color.textMuted }}>{label}</div>
            <div style={{ fontSize: tokens.typography.caption, fontWeight: 700 }}>{value}</div>
        </div>
    );
}

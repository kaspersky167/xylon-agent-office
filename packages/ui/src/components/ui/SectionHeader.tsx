import React from 'react';
import { tokens } from '../../theme/tokens';

interface SectionHeaderProps {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: tokens.spacing.sm, marginBottom: tokens.spacing.sm }}>
            <div>
                <div style={{ fontSize: tokens.typography.heading, fontWeight: 700 }}>{title}</div>
                {subtitle && <div style={{ fontSize: tokens.typography.micro, color: tokens.color.textSecondary }}>{subtitle}</div>}
            </div>
            {action}
        </div>
    );
}

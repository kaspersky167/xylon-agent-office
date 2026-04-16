import React from 'react';
import { tokens } from '../../theme/tokens';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    tone?: 'primary' | 'neutral';
}

export function Button({ tone = 'neutral', style, ...props }: ButtonProps) {
    const isPrimary = tone === 'primary';
    return (
        <button
            {...props}
            style={{
                borderRadius: tokens.radius.sm,
                border: `1px solid ${isPrimary ? 'rgba(124,92,255,0.7)' : tokens.color.border}`,
                background: isPrimary ? 'linear-gradient(90deg, #6752ff, #8f7dff)' : 'rgba(18,25,52,0.95)',
                color: isPrimary ? '#ffffff' : tokens.color.textPrimary,
                padding: '6px 10px',
                fontSize: tokens.typography.caption,
                cursor: 'pointer',
                fontWeight: 600,
                ...style
            }}
        />
    );
}

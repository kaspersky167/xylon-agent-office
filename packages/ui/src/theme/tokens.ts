import React from 'react';

export const tokens = {
    color: {
        textPrimary: '#f4f8ff',
        textSecondary: '#a3b4d3',
        textMuted: '#7487aa',
        accent: '#7c5cff',
        accentSoft: 'rgba(124, 92, 255, 0.16)',
        border: 'rgba(168, 188, 255, 0.24)',
        borderSoft: 'rgba(168, 188, 255, 0.14)',
        surface: 'rgba(8, 12, 28, 0.90)',
        surfaceAlt: 'rgba(14, 20, 42, 0.9)',
        success: '#6ee7b7',
        warning: '#f8cf72',
        danger: '#ff9a9a',
        neutral: '#c8d3e6'
    },
    typography: {
        title: 15,
        heading: 13,
        body: 12,
        caption: 11,
        micro: 10
    },
    spacing: {
        xs: 4,
        sm: 8,
        md: 12,
        lg: 16
    },
    radius: {
        sm: 6,
        md: 10,
        lg: 14,
        pill: 999
    },
    shadow: {
        panel: '0 12px 32px rgba(0, 0, 0, 0.45)',
        chip: '0 2px 8px rgba(0, 0, 0, 0.24)'
    }
} as const;

export const controlRoomStyles = {
    panel: {
        backgroundColor: tokens.color.surface,
        color: tokens.color.textPrimary,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        boxShadow: tokens.shadow.panel,
        backdropFilter: 'blur(8px)'
    } as React.CSSProperties,
    panelMuted: {
        backgroundColor: tokens.color.surfaceAlt,
        border: `1px solid ${tokens.color.borderSoft}`,
        borderRadius: tokens.radius.md
    } as React.CSSProperties,
    input: {
        width: '100%',
        boxSizing: 'border-box',
        borderRadius: tokens.radius.sm,
        border: `1px solid ${tokens.color.border}`,
        backgroundColor: 'rgba(14, 20, 42, 0.96)',
        color: tokens.color.textPrimary,
        padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
        fontSize: tokens.typography.caption,
        outline: 'none'
    } as React.CSSProperties,
    scroll: {
        scrollbarWidth: 'thin' as const,
        scrollbarColor: `${tokens.color.border} transparent`
    }
};

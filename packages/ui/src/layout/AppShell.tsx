import React from 'react';

type ZoneTone = 'hud' | 'rail' | 'viewport' | 'inspector' | 'drawer';

export function AppShell({ children }: { children: React.ReactNode }) {
    return <div className="app-shell">{children}</div>;
}

export function AppShellZone({
    title,
    tone,
    children,
    className
}: {
    title: string;
    tone: ZoneTone;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={`app-shell-zone app-shell-zone--${tone}${className ? ` ${className}` : ''}`}>
            <header className="app-shell-zone__header">{title}</header>
            <div className="app-shell-zone__content">{children}</div>
        </section>
    );
}

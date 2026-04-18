import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Panel } from '../Panel';

describe('Panel smoke', () => {
    it('renders children in static markup', () => {
        const html = renderToStaticMarkup(
            <Panel>
                <span>Smoke panel</span>
            </Panel>
        );

        expect(html).toContain('Smoke panel');
        expect(html.startsWith('<div')).toBe(true);
    });
});

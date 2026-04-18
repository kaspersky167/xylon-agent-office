import path from 'path';
import { ExtensionRegistry } from '../extensions/registry';

describe('server module smoke', () => {
    it('initializes extension registry without binding a network server', async () => {
        const folder = path.resolve(__dirname, '../extensions/does-not-exist');
        const registry = await ExtensionRegistry.loadFromFolder(folder);

        expect(registry.list()).toEqual([]);
    });
});

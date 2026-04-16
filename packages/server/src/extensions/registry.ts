import path from 'path';
import { pathToFileURL } from 'url';
import { access, readdir } from 'fs/promises';
import {
    AfterToolCallContext,
    ApprovalRequestedContext,
    BeforeToolCallContext,
    BeforeToolCallResult,
    OfficeExtension,
    ScenarioStartContext,
    TaskCreatedContext,
} from './contracts';

const EXTENSION_FILE_PATTERN = /\.([cm]?js|ts)$/i;

const toExtension = (mod: any): OfficeExtension | null => {
    const candidate = mod?.default ?? mod?.extension ?? mod;
    if (!candidate || typeof candidate !== 'object' || typeof candidate.name !== 'string') {
        return null;
    }
    return candidate as OfficeExtension;
};

export class ExtensionRegistry {
    constructor(private readonly extensions: OfficeExtension[]) {}

    static async loadFromFolder(folderPath: string): Promise<ExtensionRegistry> {
        try {
            await access(folderPath);
        } catch {
            console.log(`[Extensions] Folder not found at ${folderPath}; continuing without extensions.`);
            return new ExtensionRegistry([]);
        }

        const entries = await readdir(folderPath, { withFileTypes: true });
        const files = entries
            .filter((entry) => entry.isFile() && EXTENSION_FILE_PATTERN.test(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));

        const loaded: OfficeExtension[] = [];
        for (const file of files) {
            const absolutePath = path.resolve(folderPath, file);
            try {
                const imported = await import(pathToFileURL(absolutePath).href);
                const extension = toExtension(imported);
                if (!extension) {
                    console.warn(`[Extensions] Skipped ${file}; module does not export a valid extension contract.`);
                    continue;
                }
                loaded.push(extension);
                console.log(`[Extensions] Loaded ${extension.name} (${file})`);
            } catch (error) {
                console.error(`[Extensions] Failed to load ${file}`, error);
            }
        }

        return new ExtensionRegistry(loaded);
    }

    list(): string[] {
        return this.extensions.map((extension) => extension.name);
    }

    async beforeToolCall(context: BeforeToolCallContext): Promise<BeforeToolCallResult> {
        for (const extension of this.extensions) {
            if (!extension.beforeToolCall) continue;
            const result = await extension.beforeToolCall(context);
            if (result?.handled) {
                return { handled: true };
            }
        }
        return { handled: false };
    }

    async afterToolCall(context: AfterToolCallContext): Promise<void> {
        for (const extension of this.extensions) {
            if (!extension.afterToolCall) continue;
            await extension.afterToolCall(context);
        }
    }

    async onTaskCreated(context: TaskCreatedContext): Promise<void> {
        for (const extension of this.extensions) {
            if (!extension.onTaskCreated) continue;
            await extension.onTaskCreated(context);
        }
    }

    async onApprovalRequested(context: ApprovalRequestedContext): Promise<void> {
        for (const extension of this.extensions) {
            if (!extension.onApprovalRequested) continue;
            await extension.onApprovalRequested(context);
        }
    }

    async onScenarioStart(context: ScenarioStartContext): Promise<void> {
        for (const extension of this.extensions) {
            if (!extension.onScenarioStart) continue;
            await extension.onScenarioStart(context);
        }
    }
}

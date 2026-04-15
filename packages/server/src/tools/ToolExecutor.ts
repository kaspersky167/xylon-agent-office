import { exec } from 'child_process';
import { tavily, type TavilyClient, type TavilySearchResponse } from '@tavily/core';

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

// Frugality guard — shared across all ToolExecutor instances in the process.
// Tavily charges 1 credit per basic search result (up to 5 results = 1 credit).
// We have a 1 000-credit budget. Hard-stop at 900 to leave a safety margin.
const TAVILY_HARD_LIMIT = 900;
let tavilyCreditsUsed = 0;

// Simple in-process dedup: skip a Tavily call if the same query was fired
// within the last 5 minutes. Agents often think the same thing independently.
const recentSearches = new Map<string, { result: string; ts: number }>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

export class ToolExecutor {
    private tavilyClient: TavilyClient | null = null;

    private getTavilyClient(): TavilyClient | null {
        if (this.tavilyClient) return this.tavilyClient;
        const apiKey = process.env.TAVILY_API_KEY;
        if (apiKey) {
            this.tavilyClient = tavily({ apiKey });
            return this.tavilyClient;
        }
        return null;
    }

    /** Exposed so OfficeRoom can log budget in chat on demand. */
    static getTavilyCreditsUsed(): number {
        return tavilyCreditsUsed;
    }

    async execute(toolName: string, params: any): Promise<ToolResult> {
        switch (toolName) {
            case 'code_execute':
                return this.executeCode(params.code, params.language || 'javascript');
            case 'web_search':
                return this.webSearch(params.query);
            case 'write_note':
                return this.writeNote(params.content);
            case 'read_file':
                return this.readFile(params.path);
            case 'write_file':
                return this.writeFile(params.path, params.content);
            case 'run_command':
                return this.runCommand(params.command);
            case 'check_health':
                return this.checkHealth(params.url);
            case 'fetch_url':
                return this.fetchUrl(params.url);
            default:
                return { success: false, output: '', error: `Unknown tool: ${toolName}` };
        }
    }

    private executeCode(code: string, language: string): Promise<ToolResult> {
        return new Promise((resolve) => {
            // Sandbox: only allow JS/TS, with timeout
            if (language !== 'javascript' && language !== 'js') {
                resolve({ success: false, output: '', error: `Only JavaScript is supported for sandboxed execution.` });
                return;
            }

            // Wrap in a timeout to prevent infinite loops
            const wrappedCode = `
                const __timeout = setTimeout(() => { process.exit(1); }, 5000);
                try {
                    const result = (function() { ${code} })();
                    if (result !== undefined) console.log(JSON.stringify(result));
                    clearTimeout(__timeout);
                } catch(e) {
                    console.error(e.message);
                    clearTimeout(__timeout);
                    process.exit(1);
                }
            `;

            exec(`node -e "${wrappedCode.replace(/"/g, '\\"')}"`, { timeout: 6000 }, (error, stdout, stderr) => {
                if (error) {
                    resolve({ success: false, output: stderr || error.message, error: error.message });
                } else {
                    resolve({ success: true, output: stdout.trim() });
                }
            });
        });
    }

    private async webSearch(query: string): Promise<ToolResult> {
        // Dedup — return cached result if the same query ran recently.
        const cacheKey = query.trim().toLowerCase();
        const cached = recentSearches.get(cacheKey);
        if (cached && Date.now() - cached.ts < DEDUP_WINDOW_MS) {
            console.log(`[Tavily] Dedup cache hit for: "${query}"`);
            return { success: true, output: `[cached] ${cached.result}` };
        }

        const client = this.getTavilyClient();
        if (client) {
            return this.webSearchTavily(query, client);
        }
        return this.webSearchDuckDuckGo(query);
    }

    private async webSearchTavily(query: string, client: TavilyClient): Promise<ToolResult> {
        // Hard-stop guard
        if (tavilyCreditsUsed >= TAVILY_HARD_LIMIT) {
            console.warn(`[Tavily] Hard limit reached (${tavilyCreditsUsed} credits). Falling back to DuckDuckGo.`);
            return this.webSearchDuckDuckGo(query);
        }

        try {
            // Use maxResults: 3 (not 5) to halve credit burn — still useful.
            const response = await client.search(query, { maxResults: 3 });

            tavilyCreditsUsed += 1;
            console.log(`[Tavily] Credits used: ${tavilyCreditsUsed} / ${TAVILY_HARD_LIMIT} | query: "${query}"`);

            const results = (response.results || [])
                .map((r: TavilySearchResponse['results'][number]) => `${r.title}: ${r.content}`)
                .join('\n\n');

            const output = results
                ? `Results:\n${results}`
                : `No results for "${query}".`;

            // Cache result for dedup
            recentSearches.set(query.trim().toLowerCase(), { result: output, ts: Date.now() });

            // Warn in logs when approaching limit
            if (tavilyCreditsUsed >= TAVILY_HARD_LIMIT - 50) {
                console.warn(`[Tavily] ⚠️  Approaching credit limit: ${tavilyCreditsUsed}/${TAVILY_HARD_LIMIT}`);
            }

            return { success: true, output };
        } catch (e: any) {
            return { success: false, output: '', error: `Tavily search failed: ${e.message}` };
        }
    }

    private async webSearchDuckDuckGo(query: string): Promise<ToolResult> {
        try {
            // Use a simple fetch to DuckDuckGo Instant Answer API (no API key needed)
            const encoded = encodeURIComponent(query);
            const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
            const data = await res.json();

            const abstract = data.Abstract || data.AbstractText || '';
            const relatedTopics = (data.RelatedTopics || []).slice(0, 3).map((t: any) => t.Text || '').join('; ');

            const output = abstract
                ? `Result: ${abstract}`
                : relatedTopics
                    ? `Related: ${relatedTopics}`
                    : `No direct results for "${query}".`;

            return { success: true, output };
        } catch (e: any) {
            return { success: false, output: '', error: `Search failed: ${e.message}` };
        }
    }

    private async writeNote(content: string): Promise<ToolResult> {
        // Simple in-memory note (could be extended to file I/O)
        console.log(`[ToolExecutor] Note: ${content}`);
        return { success: true, output: `Note saved: "${content.slice(0, 50)}..."` };
    }

    private async readFile(path: string): Promise<ToolResult> {
        const { readFile } = await import('fs/promises');
        try {
            if (path.includes('..') || path.startsWith('/')) {
                return { success: false, output: '', error: 'Path traversal not allowed.' };
            }
            const content = await readFile(path, 'utf-8');
            return { success: true, output: content.slice(0, 1000) };
        } catch (e: any) {
            return { success: false, output: '', error: e.message };
        }
    }

    private async writeFile(path: string, content: string): Promise<ToolResult> {
        const { writeFile, mkdir } = await import('fs/promises');
        const pathModule = await import('path');
        try {
            if (path.includes('..') || path.startsWith('/')) {
                return { success: false, output: '', error: 'Path traversal not allowed.' };
            }
            // Only allow writes inside the workspace data directory
            const safePath = pathModule.join('data', 'workspace', path);
            await mkdir(pathModule.dirname(safePath), { recursive: true });
            await writeFile(safePath, content, 'utf-8');
            return { success: true, output: `Written to ${safePath}` };
        } catch (e: any) {
            return { success: false, output: '', error: e.message };
        }
    }

    private runCommand(command: string): Promise<ToolResult> {
        return new Promise((resolve) => {
            // Allowlist of safe, read-only-style commands
            const allowed = [
                /^ls(\s|$)/, /^cat\s/, /^echo\s/, /^pwd$/,
                /^git (status|log|diff)(\s|$)/,
                /^docker (ps|images|stats)(\s|$)/,
                /^npm (list|outdated|audit)(\s|$)/,
                /^node -e\s/,
            ];
            const safe = allowed.some(pattern => pattern.test(command.trim()));
            if (!safe) {
                resolve({ success: false, output: '', error: `Command not in allowlist: "${command}"` });
                return;
            }
            exec(command, { timeout: 8000, cwd: 'data/workspace' }, (error, stdout, stderr) => {
                if (error) {
                    resolve({ success: false, output: stderr || error.message, error: error.message });
                } else {
                    resolve({ success: true, output: (stdout || stderr).trim().slice(0, 800) });
                }
            });
        });
    }

    // Fetch a public webpage and return cleaned visible text (first ~4 KB).
    // Useful for agents to actually read xylondevs.com, a prospect's site, etc.
    private async fetchUrl(url: string): Promise<ToolResult> {
        try {
            if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                return { success: false, output: '', error: 'URL must start with http:// or https://' };
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: { 'User-Agent': 'XylonAgent/1.0 (+https://xylondevs.com)' },
            });
            clearTimeout(timeout);
            if (!res.ok) {
                return { success: false, output: '', error: `HTTP ${res.status} ${res.statusText}` };
            }
            const raw = await res.text();
            // Very light HTML → text stripping (no external dep). Good enough for research.
            const text = raw
                .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                .replace(/<!--[\s\S]*?-->/g, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, ' ')
                .trim();
            // Try to grab <title> for extra context
            const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : '';
            const body = text.slice(0, 4000);
            return {
                success: true,
                output: `URL: ${url}\nTitle: ${title}\n\n${body}${text.length > 4000 ? '\n…(truncated)' : ''}`,
            };
        } catch (e: any) {
            return { success: false, output: '', error: `Fetch failed: ${e.message}` };
        }
    }

    private async checkHealth(url: string): Promise<ToolResult> {
        try {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return { success: false, output: '', error: 'URL must start with http:// or https://' };
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const start = Date.now();
            const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeout);
            const ms = Date.now() - start;
            return { success: true, output: `${url} → ${res.status} ${res.statusText} (${ms}ms)` };
        } catch (e: any) {
            return { success: false, output: '', error: `Health check failed: ${e.message}` };
        }
    }
}

import { exec } from "child_process";
import { createHash } from "crypto";
import {
  tavily,
  type TavilyClient,
  type TavilySearchResponse,
} from "@tavily/core";
import * as pathModule from "path";
import { evaluateToolPolicy, type ToolExecutionContext } from "./policy";

const MAX_READ_FILE_BYTES = 8 * 1024;
const MAX_READ_CHUNK_BYTES = 64 * 1024;
const MAX_LIST_FILES_RESULTS = 500;

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolAuditEntry {
  actorId: string;
  actorRole: string;
  toolName: string;
  paramsHash: string;
  result: string;
  approvalId?: string | null;
}

type ToolAuditLogger = (entry: ToolAuditEntry) => Promise<void> | void;

// Frugality guard — shared across all ToolExecutor instances in the process.
// Tavily charges 1 credit per basic search result (up to 5 results = 1 credit).
// We have a 1 000-credit budget. Hard-stop at 900 to leave a safety margin.
const TAVILY_HARD_LIMIT = 900;
let tavilyCreditsUsed = 0;

// Simple in-process dedup: skip a Tavily call if the same query was fired
// within the last 5 minutes. Agents often think the same thing independently.
const recentSearches = new Map<string, { result: string; ts: number }>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

interface SearchSource {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
}

interface ToolResearchPayload {
  query: string;
  retrievedAt: string;
  sources: SearchSource[];
  freshnessNotes: string;
}

export class ToolExecutor {
  private tavilyClient: TavilyClient | null = null;
  private auditLogger: ToolAuditLogger | null = null;

  constructor(options?: { auditLogger?: ToolAuditLogger }) {
    this.auditLogger = options?.auditLogger || null;
  }

  setAuditLogger(logger: ToolAuditLogger | null) {
    this.auditLogger = logger;
  }

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

  async execute(
    toolName: string,
    params: any,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const normalizedToolName = String(toolName || "").trim();
    const safeParams = params ?? {};
    const safeContext: ToolExecutionContext = {
      actorId: context?.actorId || "system",
      actorRole: context?.actorRole || "default",
      approvalId: context?.approvalId || null,
    };

    const policy = evaluateToolPolicy(
      normalizedToolName,
      safeParams,
      safeContext,
    );
    if (!policy.allowed) {
      const reasonCode = policy.reasonCode || "POLICY_REJECTED";
      const rejection: ToolResult = {
        success: false,
        output: "",
        error: `[${reasonCode}] ${policy.message || "Tool execution rejected by policy."}`,
      };
      await this.logAudit(
        normalizedToolName,
        safeParams,
        rejection,
        safeContext,
        reasonCode,
      );
      return rejection;
    }

    let result: ToolResult;
    try {
      switch (normalizedToolName) {
        case "code_execute":
          result = await this.executeCode(
            safeParams.code,
            safeParams.language || "javascript",
          );
          break;
        case "web_search":
          result = await this.webSearch(safeParams.query);
          break;
        case "write_note":
          result = await this.writeNote(safeParams.content);
          break;
        case "read_file":
          result = await this.readFile(safeParams.path);
          break;
        case "list_files":
          result = await this.listFiles(
            safeParams.path || ".",
            safeParams.recursive,
            safeParams.limit,
          );
          break;
        case "stat_file":
          result = await this.statFile(safeParams.path);
          break;
        case "read_file_chunk":
          result = await this.readFileChunk(
            safeParams.path,
            safeParams.offset,
            safeParams.length,
          );
          break;
        case "write_file":
          result = await this.writeFile(safeParams.path, safeParams.content);
          break;
        case "run_command":
          result = await this.runCommand(safeParams.command);
          break;
        case "check_health":
          result = await this.checkHealth(safeParams.url);
          break;
        case "fetch_url":
          result = await this.fetchUrl(safeParams.url);
          break;
        default:
          result = {
            success: false,
            output: "",
            error: `Unknown tool: ${normalizedToolName}`,
          };
          break;
      }
    } catch (e: any) {
      result = {
        success: false,
        output: "",
        error: e?.message || "Tool execution failed unexpectedly.",
      };
    }

    await this.logAudit(
      normalizedToolName,
      safeParams,
      result,
      safeContext,
      result.success ? "EXECUTED" : "EXECUTION_FAILED",
    );
    return result;
  }

  private hashParams(params: any): string {
    try {
      const canonical = JSON.stringify(this.sortObjectKeys(params ?? {}));
      return createHash("sha256").update(canonical).digest("hex");
    } catch {
      return createHash("sha256").update(String(params)).digest("hex");
    }
  }

  private sortObjectKeys(value: any): any {
    if (Array.isArray(value))
      return value.map((item) => this.sortObjectKeys(item));
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((acc: Record<string, any>, key) => {
          acc[key] = this.sortObjectKeys(value[key]);
          return acc;
        }, {});
    }
    return value;
  }

  private async logAudit(
    toolName: string,
    params: any,
    result: ToolResult,
    context: ToolExecutionContext,
    reasonCode: string,
  ): Promise<void> {
    if (!this.auditLogger) return;
    const outputSnippet = result.success
      ? `ok:${(result.output || "").slice(0, 500)}`
      : `error:${(result.error || result.output || "").slice(0, 500)}`;
    try {
      await this.auditLogger({
        actorId: context.actorId || "system",
        actorRole: context.actorRole || "default",
        toolName,
        paramsHash: this.hashParams(params),
        result: `${reasonCode}|${outputSnippet}`,
        approvalId: context.approvalId || null,
      });
    } catch (error) {
      console.error("[ToolExecutor] Failed to persist tool audit entry", error);
    }
  }

  private executeCode(code: string, language: string): Promise<ToolResult> {
    return new Promise((resolve) => {
      // Sandbox: only allow JS/TS, with timeout
      if (language !== "javascript" && language !== "js") {
        resolve({
          success: false,
          output: "",
          error: `Only JavaScript is supported for sandboxed execution.`,
        });
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

      exec(
        `node -e "${wrappedCode.replace(/"/g, '\\"')}"`,
        { timeout: 6000 },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              output: stderr || error.message,
              error: error.message,
            });
          } else {
            resolve({ success: true, output: stdout.trim() });
          }
        },
      );
    });
  }

  private async webSearch(query: string): Promise<ToolResult> {
    // Dedup — return cached result if the same query ran recently.
    const cacheKey = query.trim().toLowerCase();
    const cached = recentSearches.get(cacheKey);
    if (cached && Date.now() - cached.ts < DEDUP_WINDOW_MS) {
      console.log(`[Tavily] Dedup cache hit for: "${query}"`);
      try {
        const payload = JSON.parse(cached.result) as ToolResearchPayload;
        payload.freshnessNotes =
          `${payload.freshnessNotes} Cached result reused from ${payload.retrievedAt}.`.trim();
        return { success: true, output: JSON.stringify(payload) };
      } catch {
        return { success: true, output: cached.result };
      }
    }

    const client = this.getTavilyClient();
    if (client) {
      return this.webSearchTavily(query, client);
    }
    return this.webSearchDuckDuckGo(query);
  }

  private async webSearchTavily(
    query: string,
    client: TavilyClient,
  ): Promise<ToolResult> {
    // Hard-stop guard
    if (tavilyCreditsUsed >= TAVILY_HARD_LIMIT) {
      console.warn(
        `[Tavily] Hard limit reached (${tavilyCreditsUsed} credits). Falling back to DuckDuckGo.`,
      );
      return this.webSearchDuckDuckGo(query);
    }

    try {
      // Use maxResults: 3 (not 5) to halve credit burn — still useful.
      const response = await client.search(query, { maxResults: 3 });

      tavilyCreditsUsed += 1;
      console.log(
        `[Tavily] Credits used: ${tavilyCreditsUsed} / ${TAVILY_HARD_LIMIT} | query: "${query}"`,
      );

      const retrievedAt = new Date().toISOString();
      const sources: SearchSource[] = (response.results || [])
        .map((r: TavilySearchResponse["results"][number]) => ({
          url: r.url || "",
          title: r.title || "Untitled",
          snippet: r.content || "",
          ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}),
        }))
        .filter((source: SearchSource) =>
          Boolean(source.url || source.snippet),
        );

      const missingPublishDates = sources.filter(
        (source) => !source.publishedAt,
      ).length;
      const freshnessNotes =
        sources.length === 0
          ? `No Tavily results were returned for "${query}".`
          : missingPublishDates > 0
            ? `${missingPublishDates}/${sources.length} source(s) did not include a published date.`
            : "All sources include publish dates.";
      const output = JSON.stringify({
        query,
        retrievedAt,
        sources,
        freshnessNotes,
      } satisfies ToolResearchPayload);

      // Cache result for dedup
      recentSearches.set(query.trim().toLowerCase(), {
        result: output,
        ts: Date.now(),
      });

      // Warn in logs when approaching limit
      if (tavilyCreditsUsed >= TAVILY_HARD_LIMIT - 50) {
        console.warn(
          `[Tavily] ⚠️  Approaching credit limit: ${tavilyCreditsUsed}/${TAVILY_HARD_LIMIT}`,
        );
      }

      return { success: true, output };
    } catch (e: any) {
      return {
        success: false,
        output: "",
        error: `Tavily search failed: ${e.message}`,
      };
    }
  }

  private async webSearchDuckDuckGo(query: string): Promise<ToolResult> {
    try {
      // Use a simple fetch to DuckDuckGo Instant Answer API (no API key needed)
      const encoded = encodeURIComponent(query);
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`,
      );
      const data = await res.json();

      const related = (data.RelatedTopics || [])
        .flatMap((topic: any) => topic.Topics || topic)
        .filter((topic: any) => typeof topic?.Text === "string")
        .slice(0, 5);
      const sources: SearchSource[] = related.map((topic: any) => ({
        url: topic.FirstURL || data.AbstractURL || "https://duckduckgo.com",
        title: topic.Text?.split(" - ")[0]?.trim() || "DuckDuckGo Result",
        snippet: topic.Text || "",
      }));

      if (sources.length === 0 && (data.Abstract || data.AbstractText)) {
        sources.push({
          url: data.AbstractURL || `https://duckduckgo.com/?q=${encoded}`,
          title: data.Heading || query,
          snippet: data.Abstract || data.AbstractText,
        });
      }

      const output = JSON.stringify({
        query,
        retrievedAt: new Date().toISOString(),
        sources,
        freshnessNotes:
          "DuckDuckGo fallback used (no Tavily). Results may be less current and less complete; verify important facts with primary sources and publication dates.",
      } satisfies ToolResearchPayload);

      return { success: true, output };
    } catch (e: any) {
      return {
        success: false,
        output: "",
        error: `Search failed: ${e.message}`,
      };
    }
  }

  private getWorkspaceRoot(): string {
    return pathModule.resolve(
      process.env.AGENT_WORKSPACE_DIR || "data/workspace",
    );
  }

  private resolveWorkspacePath(
    workspaceRoot: string,
    targetPath: string,
  ): string {
    if (typeof targetPath !== "string" || targetPath.trim() === "") {
      throw new Error("Path is required.");
    }
    const resolvedTarget = pathModule.resolve(workspaceRoot, targetPath);
    const relativePath = pathModule.relative(workspaceRoot, resolvedTarget);
    if (relativePath.startsWith("..") || pathModule.isAbsolute(relativePath)) {
      throw new Error("Path traversal not allowed.");
    }
    return resolvedTarget;
  }

  private async writeNote(content: string): Promise<ToolResult> {
    // Simple in-memory note (could be extended to file I/O)
    console.log(`[ToolExecutor] Note: ${content}`);
    return {
      success: true,
      output: `Note saved: "${content.slice(0, 50)}..."`,
    };
  }

  private async readFile(path: string): Promise<ToolResult> {
    const { readFile } = await import("fs/promises");
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const safePath = this.resolveWorkspacePath(workspaceRoot, path);
      const content = await readFile(safePath, "utf-8");
      return { success: true, output: content.slice(0, MAX_READ_FILE_BYTES) };
    } catch (e: any) {
      return { success: false, output: "", error: e.message };
    }
  }

  private normalizeLimit(limit: unknown): number {
    if (limit === undefined || limit === null) return 200;
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("limit must be a positive number.");
    }
    return Math.min(Math.floor(parsed), MAX_LIST_FILES_RESULTS);
  }

  private async listFiles(
    targetPath: string,
    recursive = false,
    limit?: number,
  ): Promise<ToolResult> {
    const { readdir } = await import("fs/promises");
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const safePath = this.resolveWorkspacePath(workspaceRoot, targetPath);
      const maxItems = this.normalizeLimit(limit);
      const shouldRecurse = Boolean(recursive);
      const files: Array<{
        path: string;
        type: "file" | "directory" | "other";
      }> = [];
      const queue = [safePath];

      while (queue.length > 0 && files.length < maxItems) {
        const currentDir = queue.shift() as string;
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= maxItems) break;
          const absEntryPath = pathModule.join(currentDir, entry.name);
          const relPath = pathModule
            .relative(workspaceRoot, absEntryPath)
            .replace(/\\/g, "/");
          const itemType: "file" | "directory" | "other" = entry.isFile()
            ? "file"
            : entry.isDirectory()
              ? "directory"
              : "other";
          files.push({ path: relPath, type: itemType });
          if (shouldRecurse && entry.isDirectory()) {
            queue.push(absEntryPath);
          }
        }
      }

      return {
        success: true,
        output: JSON.stringify({
          root: pathModule.relative(workspaceRoot, safePath) || ".",
          recursive: shouldRecurse,
          limit: maxItems,
          truncated: files.length >= maxItems,
          entries: files,
        }),
      };
    } catch (e: any) {
      return { success: false, output: "", error: e.message };
    }
  }

  private async statFile(targetPath: string): Promise<ToolResult> {
    const { stat } = await import("fs/promises");
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const safePath = this.resolveWorkspacePath(workspaceRoot, targetPath);
      const details = await stat(safePath);
      return {
        success: true,
        output: JSON.stringify({
          path: pathModule
            .relative(workspaceRoot, safePath)
            .replace(/\\/g, "/"),
          size: details.size,
          isFile: details.isFile(),
          isDirectory: details.isDirectory(),
          mode: details.mode,
          createdAt: details.birthtime.toISOString(),
          modifiedAt: details.mtime.toISOString(),
          accessedAt: details.atime.toISOString(),
        }),
      };
    } catch (e: any) {
      return { success: false, output: "", error: e.message };
    }
  }

  private async readFileChunk(
    targetPath: string,
    offset: unknown,
    length: unknown,
  ): Promise<ToolResult> {
    const { open } = await import("fs/promises");
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const safePath = this.resolveWorkspacePath(workspaceRoot, targetPath);
      const parsedOffset = Number(offset ?? 0);
      const parsedLength = Number(length ?? 4096);
      if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        return {
          success: false,
          output: "",
          error: "offset must be a non-negative number.",
        };
      }
      if (!Number.isFinite(parsedLength) || parsedLength <= 0) {
        return {
          success: false,
          output: "",
          error: "length must be a positive number.",
        };
      }
      const safeLength = Math.min(
        Math.floor(parsedLength),
        MAX_READ_CHUNK_BYTES,
      );
      const fileHandle = await open(safePath, "r");
      try {
        const buffer = Buffer.alloc(safeLength);
        const { bytesRead } = await fileHandle.read(
          buffer,
          0,
          safeLength,
          Math.floor(parsedOffset),
        );
        return {
          success: true,
          output: JSON.stringify({
            path: pathModule
              .relative(workspaceRoot, safePath)
              .replace(/\\/g, "/"),
            offset: Math.floor(parsedOffset),
            length: safeLength,
            bytesRead,
            truncated: parsedLength > safeLength,
            data: buffer.subarray(0, bytesRead).toString("utf-8"),
          }),
        };
      } finally {
        await fileHandle.close();
      }
    } catch (e: any) {
      return { success: false, output: "", error: e.message };
    }
  }

  private async writeFile(
    filePath: string,
    content: string,
  ): Promise<ToolResult> {
    const { writeFile, mkdir } = await import("fs/promises");
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const safePath = this.resolveWorkspacePath(workspaceRoot, filePath);
      await mkdir(pathModule.dirname(safePath), { recursive: true });
      await writeFile(safePath, content, "utf-8");
      return { success: true, output: `Written to ${safePath}` };
    } catch (e: any) {
      return { success: false, output: "", error: e.message };
    }
  }

  private runCommand(command: string): Promise<ToolResult> {
    return new Promise((resolve) => {
      const workspaceRoot = this.getWorkspaceRoot();
      exec(
        command,
        { timeout: 8000, cwd: workspaceRoot },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              output: stderr || error.message,
              error: error.message,
            });
          } else {
            resolve({
              success: true,
              output: (stdout || stderr).trim().slice(0, 800),
            });
          }
        },
      );
    });
  }

  // Fetch a public webpage and return cleaned visible text (first ~4 KB).
  // Useful for agents to actually read xylondevs.com, a prospect's site, etc.
  private async fetchUrl(url: string): Promise<ToolResult> {
    try {
      if (!url || typeof url !== "string" || url.trim() === "") {
        return {
          success: false,
          output: "",
          error: "URL is required.",
        };
      }
      const normalizedUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)
        ? url.trim()
        : `https://${url.trim()}`;
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        return {
          success: false,
          output: "",
          error: "URL must use http:// or https://",
        };
      }

      const fetchWithTimeout = async (targetUrl: string): Promise<Response> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          return await fetch(targetUrl, {
            method: "GET",
            signal: controller.signal,
            redirect: "follow",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; XylonAgent/1.0; +https://xylondevs.com)",
              Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
        } finally {
          clearTimeout(timeout);
        }
      };

      let fetchTarget = normalizedUrl;
      let res: Response;
      try {
        res = await fetchWithTimeout(fetchTarget);
      } catch {
        // Some sites block non-browser fetches or fail TLS handshakes in server runtimes.
        // Use r.jina.ai text mirror as a best-effort fallback.
        fetchTarget = `https://r.jina.ai/http://${normalizedUrl.replace(/^https?:\/\//i, "")}`;
        res = await fetchWithTimeout(fetchTarget);
      }

      if (!res.ok) {
        return {
          success: false,
          output: "",
          error: `HTTP ${res.status} ${res.statusText} while fetching ${fetchTarget}`,
        };
      }
      const raw = await res.text();
      // Very light HTML → text stripping (no external dep). Good enough for research.
      const text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
      // Try to grab <title> for extra context
      const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";
      const body = text.slice(0, 4000);
      const publishedMatch = raw.match(
        /<meta[^>]+(?:property|name)=["'](?:article:published_time|pubdate|publish-date|datePublished)["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      );
      const publishedAt = publishedMatch?.[1];
      const truncated = text.length > 4000;
      const payload: ToolResearchPayload = {
        query: normalizedUrl,
        retrievedAt: new Date().toISOString(),
        sources: [
          {
            url: normalizedUrl,
            title: title || normalizedUrl,
            snippet: `${body}${truncated ? "\n…(truncated)" : ""}`,
            ...(publishedAt ? { publishedAt } : {}),
          },
        ],
        freshnessNotes: publishedAt
          ? "Publish date extracted from page metadata."
          : "No publish date found in page metadata; treat time-sensitive claims as uncertain.",
      };
      return {
        success: true,
        output: JSON.stringify(payload),
      };
    } catch (e: any) {
      const cause = e?.cause?.message ? ` (cause: ${e.cause.message})` : "";
      return {
        success: false,
        output: "",
        error: `Fetch failed: ${e?.message || "Unknown error"}${cause}`,
      };
    }
  }

  private async checkHealth(url: string): Promise<ToolResult> {
    try {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return {
          success: false,
          output: "",
          error: "URL must start with http:// or https://",
        };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const start = Date.now();
      const res = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const ms = Date.now() - start;
      return {
        success: true,
        output: `${url} → ${res.status} ${res.statusText} (${ms}ms)`,
      };
    } catch (e: any) {
      return {
        success: false,
        output: "",
        error: `Health check failed: ${e.message}`,
      };
    }
  }
}

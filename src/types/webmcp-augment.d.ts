/**
 * Declaration merge onto `webmcp-types@0.1.6`.
 *
 * The shipped typings declare `registerTool`, `getTools` and the `toolchange`
 * event, but omit `executeTool` — which TOOLS.md §3 documents and which the
 * Phase 5 command palette is built on. Without this, the human surface could
 * not call the same registry the agent calls, and the whole thesis would need a
 * second execute path. That duplication is exactly what CLAUDE.md forbids, so
 * the fix belongs in the type layer, not in the app.
 *
 * Delete this file if a future webmcp-types release declares `executeTool`.
 */

declare global {
  namespace WebMCP {
    interface ModelContext {
      /**
       * Execute a tool obtained from `getTools()`.
       *
       * @param tool The registered tool to invoke.
       * @param args Arguments as a **JSON string**, not an object. Verified
       *   against Chrome 152: passing an object throws
       *   `UnknownError: Failed to parse input arguments`.
       * @returns The tool's result **as a JSON string** — Chrome serializes
       *   whatever `execute` returned — or `null` on navigation (TOOLS.md §3).
       *   Use `parseToolResult()` from `lib/webmcpInterop` rather than reading
       *   this directly.
       */
      executeTool(
        tool: RegisteredTool,
        args: string,
        options?: { signal?: AbortSignal },
      ): Promise<string | null>;
    }
  }
}

export {};

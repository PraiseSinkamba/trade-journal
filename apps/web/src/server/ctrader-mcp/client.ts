import { z } from "zod";
import { createMCPClient, type CallToolResult, type MCPClient } from "@ai-sdk/mcp";
import { classifyMcpError, CTraderMcpSyncError } from "./errors";

export { z };

export interface CTraderMcpClientOptions {
  mode: "remote" | "local";
  endpoint: string;
  bearerToken?: string;
  authHeader?: string;
}

export class CTraderMcpClient {
  private raw: MCPClient | null = null;
  private initialized = false;

  constructor(private readonly options: CTraderMcpClientOptions) {}

  async initialize(): Promise<void> {
    const transport = {
      type: "http" as const,
      url: this.options.endpoint,
      headers: this.buildHeaders(),
    };
    try {
      this.raw = await createMCPClient({ transport });
      this.initialized = true;
    } catch (err) {
      throw classifyMcpError(err);
    }
  }

  async close(): Promise<void> {
    if (!this.raw) return;
    try {
      await this.raw.close();
    } finally {
      this.raw = null;
      this.initialized = false;
    }
  }

  async callTool<S extends z.ZodType<z.infer<S>, z.ZodTypeDef, unknown>>(
    name: string,
    args: Record<string, unknown>,
    schema: S,
    opts?: { signal?: AbortSignal },
  ): Promise<z.infer<S>> {
    if (!this.raw || !this.initialized) {
      throw new CTraderMcpSyncError("unknown", "MCP client not initialized");
    }
    try {
      const result = await this.raw.callTool({
        name,
        arguments: args,
        options: opts ? { signal: opts.signal } : undefined,
      });
      const data = this.extractResultData(result);
      return schema.parse(data);
    } catch (err) {
      if (err instanceof CTraderMcpSyncError) throw err;
      if (err instanceof z.ZodError) {
        throw new CTraderMcpSyncError(
          "parse",
          `cTrader MCP ${name} payload failed validation`,
          err,
        );
      }
      throw classifyMcpError(err);
    }
  }

  private extractResultData(result: CallToolResult): unknown {
    if (result.structuredContent !== undefined) {
      return result.structuredContent;
    }
    const contentResult = z.array(z.unknown()).safeParse(result.content);
    if (!contentResult.success) return result;
    const first = contentResult.data[0];
    if (
      first &&
      typeof first === "object" &&
      first !== null &&
      "text" in first &&
      typeof (first as { text: unknown }).text === "string"
    ) {
      const text = (first as { text: string }).text;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text as unknown;
      }
    }
    return result;
  }

  private buildHeaders(): Record<string, string> {
    if (this.options.mode === "remote" && this.options.bearerToken) {
      return { Authorization: `Bearer ${this.options.bearerToken}` };
    }
    if (this.options.authHeader) {
      return { Authorization: this.options.authHeader };
    }
    return {};
  }
}

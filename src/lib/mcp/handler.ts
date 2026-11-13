import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server";

function baseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Runs one stateless MCP request. Callers must have authenticated the request first. */
export async function handleMcp(req: Request): Promise<Response> {
  const server = createMcpServer({ baseUrl: baseUrl(req) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (e) {
    console.error("[mcp] request failed", e);
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }, { status: 500 });
  } finally {
    // JSON response mode resolves only after every response is ready, so it's safe to tear down here.
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}


import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkMcpAuth } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";

/**
 * Remote MCP endpoint for the "Nora HQ" custom connector in Claude.
 * Auth: Authorization: Bearer <MCP_TOKEN>. Stateless Streamable HTTP with JSON responses:
 * every POST gets a fresh server + transport, so it runs fine on serverless.
 * See docs/claude-connector.md.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function baseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function POST(req: Request): Promise<Response> {
  const denied = checkMcpAuth(req);
  if (denied) return denied;

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

/** Stateless server: no standalone SSE stream and no sessions to delete. */
function methodNotAllowed(req: Request): Response {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This MCP server is stateless: send JSON-RPC requests with POST." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function GET(req: Request): Promise<Response> {
  return methodNotAllowed(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return methodNotAllowed(req);
}

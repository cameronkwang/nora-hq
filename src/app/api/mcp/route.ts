import { checkMcpAuth } from "@/lib/mcp/auth";
import { handleMcp } from "@/lib/mcp/handler";

/**
 * Remote MCP endpoint for the "Nora HQ" custom connector in Claude.
 * Auth: Authorization: Bearer <MCP_TOKEN>. Stateless Streamable HTTP with JSON responses:
 * every POST gets a fresh server + transport, so it runs fine on serverless.
 * See docs/claude-connector.md.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


export async function POST(req: Request): Promise<Response> {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  return handleMcp(req);
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

import { checkMcpPathKey } from "@/lib/mcp/auth";
import { handleMcp } from "@/lib/mcp/handler";

/**
 * Same Nora HQ MCP server as /api/mcp, authenticated by a key in the URL instead of a header:
 *   https://<host>/api/mcp/k/<MCP_TOKEN>
 * For Claude connector screens where custom headers aren't available. Add it with "no authentication".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const denied = checkMcpPathKey((await params).key);
  if (denied) return denied;
  return handleMcp(req);
}

async function notAllowed(_req: Request, { params }: Ctx): Promise<Response> {
  const denied = checkMcpPathKey((await params).key);
  if (denied) return denied;
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Send JSON-RPC requests with POST." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const GET = notAllowed;
export const DELETE = notAllowed;

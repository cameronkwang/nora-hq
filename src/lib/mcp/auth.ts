import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check for /api/mcp. MCP_TOKEN is a long random secret (openssl rand -hex 32) that
 * Cameron pastes into the custom connector's "Authorization: Bearer <token>" request header.
 * Returns a Response to send back when the request is not allowed, or null when it is.
 */
export function checkMcpAuth(req: Request): Response | null {
  const expected = process.env.MCP_TOKEN?.trim();
  if (!expected) {
    return json(503, {
      error: "not_configured",
      message: "The Claude connector is turned off: set the MCP_TOKEN environment variable (openssl rand -hex 32) and redeploy. See docs/claude-connector.md.",
    });
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !safeEqual(match[1].trim(), expected)) {
    return json(
      401,
      { error: "unauthorized", message: "Missing or wrong bearer token. Send the header Authorization: Bearer <MCP_TOKEN>." },
      { "WWW-Authenticate": 'Bearer realm="nora-hq", error="invalid_token"' },
    );
  }
  return null;
}

/** Constant-time compare that doesn't leak length (both sides hashed to 32 bytes first). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

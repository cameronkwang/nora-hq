import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "./rules";
import { registerTools } from "./tools";
import type { Ctx } from "./queries";

/** A fresh MCP server per request (stateless Streamable HTTP — works on serverless). */
export function createMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: "nora-hq", title: "Nora HQ", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} } },
  );
  registerTools(server, ctx);
  return server;
}

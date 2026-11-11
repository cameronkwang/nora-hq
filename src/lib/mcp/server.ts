import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "./rules";
import { registerTools } from "./tools";
import { registerAskTools } from "./tools-asks";
import { registerLeadTools } from "./tools-leads";
import { registerCreatorTools } from "./tools-creator";
import { registerCollabTools } from "./tools-collab";
import type { Ctx } from "./queries";

/** A fresh MCP server per request (stateless Streamable HTTP — works on serverless). */
export function createMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: "nora-hq", title: "Nora HQ", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} } },
  );
  registerTools(server, ctx);
  registerAskTools(server);
  registerLeadTools(server);
  registerCreatorTools(server);
  registerCollabTools(server);
  return server;
}

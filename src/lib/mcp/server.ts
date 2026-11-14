import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "./rules";
import { registerTools } from "./tools";
import { registerAskTools } from "./tools-asks";
import { registerLeadTools } from "./tools-leads";
import { registerCreatorTools } from "./tools-creator";
import { registerCollabTools } from "./tools-collab";
import { registerDealTools } from "./tools-deals";
import { registerReplyTools } from "./tools-replies";
import { registerReportTools } from "./tools-reports";
import { registerIntakeTools } from "./tools-intake";
import { registerBusinessTools } from "./tools-business";
import { registerScheduleTools } from "./tools-schedule";
import { registerDropTools } from "./tools-drop";
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
  registerDealTools(server);
  registerReplyTools(server);
  registerReportTools(server);
  registerIntakeTools(server);
  registerBusinessTools(server, ctx);
  registerScheduleTools(server);
  registerDropTools(server, ctx);
  return server;
}

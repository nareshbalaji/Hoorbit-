#!/usr/bin/env node
// Local entry point — run this MCP server over stdio, the transport Claude
// Code / Claude Desktop use for locally-added custom MCP servers (no
// deployment or OAuth needed). See ../.mcp.json at the repo root.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../src/server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hoorbit Enterprise MCP — stdio transport ready (56 tools).");
}

main().catch((err) => {
  console.error("Fatal error starting Hoorbit MCP (stdio):", err);
  process.exit(1);
});

#!/usr/bin/env node
// Local entry point — run this MCP server over stdio, the transport Claude
// Code / Claude Desktop use for locally-added custom MCP servers (no
// deployment or OAuth needed). See ../.mcp.json at the repo root.
//
// Identity comes from the HOORBIT_TOKEN env var (a stdio process is
// inherently single-session, so auth is resolved once at startup, not per
// call). Without a valid token, the server still starts and lists tools
// (so it's self-documenting), but every tools/call is denied — see
// src/lib/auth.js.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../src/server.js";
import { resolveToken, ROLE_META } from "../src/lib/auth.js";

async function main() {
  const user = resolveToken(process.env.HOORBIT_TOKEN);
  const server = createServer(user);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (user) {
    console.error(`Hoorbit Enterprise MCP — stdio transport ready. Signed in as ${user.name} (${ROLE_META[user.role].label}).`);
  } else {
    console.error("Hoorbit Enterprise MCP — stdio transport ready. NO HOORBIT_TOKEN set: tools/list works, but every tools/call will be denied. Set HOORBIT_TOKEN in .mcp.json's env block — see mcp-server/README.md.");
  }
}

main().catch((err) => {
  console.error("Fatal error starting Hoorbit MCP (stdio):", err);
  process.exit(1);
});

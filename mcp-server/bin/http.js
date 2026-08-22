#!/usr/bin/env node
// Remote entry point — a real MCP Streamable HTTP endpoint (POST /mcp), run
// stateless (one server+transport per request) so it deploys cleanly to
// serverless hosts like Vercel. Also used locally via `npm start`.
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../src/server.js";
import { read } from "../src/db.js";
import { resolveToken } from "../src/lib/auth.js";
import { COMPANY, COPYRIGHT_LINE } from "../src/lib/constants.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

function bearerUser(req) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return resolveToken(token);
}

app.post("/mcp", async (req, res) => {
  try {
    // Stateless mode: a fresh server per request, so identity is resolved
    // from this request's own Authorization header — real per-call auth,
    // not a session established once and trusted forever.
    const user = bearerUser(req);
    const server = createServer(user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Streamable HTTP is stateless here — no server-initiated SSE stream, no session store.
app.get("/mcp", (req, res) => res.status(405).json({ error: "Method not allowed — this server runs stateless (POST only, no persistent SSE stream)." }));
app.delete("/mcp", (req, res) => res.status(405).json({ error: "Method not allowed — stateless server has no session to delete." }));

app.get("/health", (req, res) => res.json({ status: "healthy", service: "hoorbit-enterprise-mcp", transport: "streamable-http", timestamp: new Date().toISOString() }));

app.get("/", (req, res) => {
  res.json({
    service: "Hoorbit Enterprise Staffing Platform — MCP server",
    provider: COMPANY.legal_name,
    website: COMPANY.website,
    protocol: "Model Context Protocol (Streamable HTTP)",
    endpoint: "POST /mcp",
    note: "This is a real MCP endpoint, not a REST API — connect it with an MCP client (e.g. Claude's custom connector flow) rather than calling /tools/<name> directly.",
    auth: "Every request needs an 'Authorization: Bearer <token>' header. tools/list works unauthenticated for discovery; every tools/call is denied without a valid token. See mcp-server/README.md for the demo token directory.",
    developers_on_file: read("developers").length,
    projects_on_file: read("projects").length,
    copyright: COPYRIGHT_LINE,
  });
});

// Only bind a port when run directly (`node bin/http.js` / `npm start`).
// When imported by api/mcp.js on Vercel, the platform owns the HTTP server.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Hoorbit Enterprise MCP (Streamable HTTP) listening on port ${PORT}`);
    console.log(`POST http://localhost:${PORT}/mcp`);
  });
}

export default app;

// Verifies the remote transport (bin/http.js — the same code path Vercel
// runs via api/mcp.js) speaks real MCP over Streamable HTTP: spin up the
// Express app on an ephemeral port, connect the SDK's HTTP client, list
// tools, and call one.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Simulate the Vercel import path so bin/http.js doesn't also auto-bind :3000 —
// this test owns the only listen() call, on an ephemeral port.
process.env.VERCEL = "1";
const { default: app } = await import("../bin/http.js");

const server = app.listen(0, async () => {
  const port = server.address().port;
  try {
    const url = new URL(`http://127.0.0.1:${port}/mcp`);
    const transport = new StreamableHTTPClientTransport(url);
    const client = new Client({ name: "http-smoke-test", version: "1.0.0" });
    await client.connect(transport);

    const list = await client.listTools();
    console.log(`HTTP transport: tool count = ${list.tools.length}`);
    if (list.tools.length !== 56) throw new Error(`expected 56 tools, got ${list.tools.length}`);

    const result = await client.callTool({ name: "get_admin_dashboard", arguments: { currency: "USD" } });
    const parsed = JSON.parse(result.content[0].text);
    console.log("HTTP transport: get_admin_dashboard success =", parsed.success);
    if (!parsed.success) throw new Error("get_admin_dashboard did not succeed over HTTP transport");

    await client.close();
    console.log("HTTP TRANSPORT SMOKE TEST: PASS");
    server.close(() => process.exit(0));
  } catch (err) {
    console.error("HTTP TRANSPORT SMOKE TEST: FAIL", err);
    server.close(() => process.exit(1));
  }
});

import { logAudit } from "../db.js";

// Wraps a plain-JS-object-returning function into the MCP tool-callback shape,
// JSON-serializes the result as a single text content block, catches errors
// into isError responses, and (for mutating tools) writes an audit-trail entry
// so audit_trail / generate_compliance_report have something real to show.
export function defineTool(server, name, config, fn) {
  const { mutating, ...rest } = config;
  server.registerTool(name, rest, async (args) => {
    try {
      const result = await fn(args || {});
      if (mutating) {
        logAudit("mcp-client", name, mutating.entityType || null, (args && args[mutating.idParam]) || null, mutating.summary ? mutating.summary(args, result) : undefined);
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
    }
  });
}

export function notFound(entity, id) {
  const err = new Error(`${entity} not found: ${id}`);
  err.code = "NOT_FOUND";
  throw err;
}

import { logAudit } from "../db.js";
import { enforce } from "./auth.js";

// Wraps a plain-JS-object-returning function into the MCP tool-callback shape.
// Every call goes through enforce(user, name, args) first — real authz on the
// protocol layer, not just something a client UI chooses to hide. JSON-
// serializes the result as a single text content block, catches errors
// (auth or otherwise) into isError responses, and (for mutating tools)
// writes an audit-trail entry under the real authenticated actor.
export function defineTool(server, user, name, config, fn) {
  const { mutating, ...rest } = config;
  server.registerTool(name, rest, async (args) => {
    try {
      enforce(user, name, args);
      const result = await fn(args || {}, user);
      if (mutating) {
        const actor = user ? `${user.name} (${user.role})` : "unauthenticated";
        logAudit(actor, name, mutating.entityType || null, (args && args[mutating.idParam]) || null, mutating.summary ? mutating.summary(args, result) : undefined);
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const isAuthError = err.name === "AuthError";
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message, unauthorized: isAuthError || undefined }, null, 2) }], isError: true };
    }
  });
}

export function notFound(entity, id) {
  const err = new Error(`${entity} not found: ${id}`);
  err.code = "NOT_FOUND";
  throw err;
}

import { defineTool } from "../lib/toolkit.js";
import { ROLE_META, allowedTools } from "../lib/auth.js";

export function registerMetaTools(server, user) {
  defineTool(
    server,
    user,
    "whoami",
    {
      title: "Who am I",
      description: "Return the identity, role, and allowed-tool list for the currently authenticated bearer token.",
      inputSchema: {},
    },
    async (_a, u) => {
      if (!u) {
        return {
          success: false,
          authenticated: false,
          message: "No valid Hoorbit auth token provided. Pass one via the HOORBIT_TOKEN env var (stdio) or an 'Authorization: Bearer <token>' header (HTTP). See mcp-server/README.md for the demo token directory.",
        };
      }
      return {
        success: true,
        authenticated: true,
        name: u.name,
        role: u.role,
        role_label: ROLE_META[u.role].label,
        scope_description: ROLE_META[u.role].scope,
        linked_id: u.linkedId || null,
        allowed_tools: allowedTools(u.role),
      };
    }
  );
}

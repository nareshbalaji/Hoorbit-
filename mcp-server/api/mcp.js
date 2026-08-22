// Vercel serverless entry — re-exports the Express app so a single
// deployment serves POST /api/mcp (see ../vercel.json for the /mcp rewrite).
export { default } from "../bin/http.js";

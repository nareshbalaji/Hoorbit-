import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerRecruitmentTools } from "./tools/recruitment.js";
import { registerContractTools } from "./tools/contracts.js";
import { registerOnboardingTools } from "./tools/onboarding.js";
import { registerInsuranceTools } from "./tools/insurance.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerInvoicingTools } from "./tools/invoicing.js";
import { registerComplianceTools } from "./tools/compliance.js";
import { registerDashboardTools } from "./tools/dashboards.js";
import { registerSupportTools } from "./tools/support.js";

// `user` is the resolved-and-authenticated caller (see src/lib/auth.js),
// or null if no/invalid token was supplied. It's threaded into every tool
// registration so defineTool() can enforce real per-call authz — this is not
// optional middleware bolted on top, every tool call goes through it.
export function createServer(user) {
  const server = new McpServer(
    {
      name: "hoorbit-enterprise-mcp",
      version: "1.0.0",
      title: "Hoorbit Enterprise Staffing Platform",
    },
    {
      instructions:
        "Hoorbit LLC is a Delaware LLC that acts as prime contractor for AS400/iSeries and supply-chain " +
        "staffing engagements: it recruits developers, contracts and pays them, invoices the client company " +
        "for the assigned team plus a 5-10% commission, and manages onboarding/insurance/compliance in between. " +
        "Tools operate on a local JSON database seeded with illustrative demo data (not real people or companies). " +
        "Monetary amounts always carry an explicit currency code — never assume USD. Every document- or " +
        "money-producing tool returns a 'disclaimer' field; surface it to the user rather than dropping it. " +
        "Access is role-scoped by bearer token (see the whoami tool) — an employer/developer/recruiter/onboarding/" +
        "support caller will see 'unauthorized' errors on tools or records outside their role; that is expected " +
        "behavior, not a bug — call whoami first if a tool call is unexpectedly denied.",
    }
  );

  registerMetaTools(server, user);
  registerRecruitmentTools(server, user);
  registerContractTools(server, user);
  registerOnboardingTools(server, user);
  registerInsuranceTools(server, user);
  registerPayrollTools(server, user);
  registerInvoicingTools(server, user);
  registerComplianceTools(server, user);
  registerDashboardTools(server, user);
  registerSupportTools(server, user);

  return server;
}

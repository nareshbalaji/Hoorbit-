import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRecruitmentTools } from "./tools/recruitment.js";
import { registerContractTools } from "./tools/contracts.js";
import { registerOnboardingTools } from "./tools/onboarding.js";
import { registerInsuranceTools } from "./tools/insurance.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerInvoicingTools } from "./tools/invoicing.js";
import { registerComplianceTools } from "./tools/compliance.js";
import { registerDashboardTools } from "./tools/dashboards.js";
import { registerSupportTools } from "./tools/support.js";

export function createServer() {
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
        "money-producing tool returns a 'disclaimer' field; surface it to the user rather than dropping it.",
    }
  );

  registerRecruitmentTools(server);
  registerContractTools(server);
  registerOnboardingTools(server);
  registerInsuranceTools(server);
  registerPayrollTools(server);
  registerInvoicingTools(server);
  registerComplianceTools(server);
  registerDashboardTools(server);
  registerSupportTools(server);

  return server;
}

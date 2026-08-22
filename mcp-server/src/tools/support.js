import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, todayISO, nowISO } from "../lib/ids.js";
import { COMPANY, NO_REAL_MONEY_MOVES, NOT_LEGAL_ADVICE } from "../lib/constants.js";

const ROUTE_MAP = {
  payslip_issue: "HR — Payroll",
  contract_question: "HR — Compliance",
  project_question: "Project Manager",
  client_issue: "HR — Compliance",
  technical_support: "Support",
};

export function registerSupportTools(server, user) {
  defineTool(
    server,
    user,
    "send_notification",
    {
      title: "Send a notification",
      description: "Send (simulated) an email/SMS/push notification to a developer or client.",
      inputSchema: {
        to_type: z.enum(["developer", "client"]),
        to_id: z.string(),
        channel: z.enum(["email", "sms", "push"]).default("email"),
        subject: z.string(),
        message: z.string(),
      },
      mutating: { entityType: "notification", idParam: "to_id" },
    },
    async (a) => {
      const collection = a.to_type === "developer" ? "developers" : "clients";
      const record = findById(collection, a.to_id) || notFound(a.to_type, a.to_id);
      const recipient = a.to_type === "developer" ? record.email : record.contact_email;
      return { success: true, channel: a.channel, to: recipient, from: a.channel === "email" ? COMPANY.sender_email : "Hoorbit LLC", subject: a.subject, message: a.message, sent_at: nowISO(), note: NO_REAL_MONEY_MOVES };
    }
  );

  defineTool(
    server,
    user,
    "create_support_ticket",
    {
      title: "Create a support ticket",
      description: "File a support ticket from a developer or client. Auto-routed to the right Hoorbit team by category.",
      inputSchema: {
        from_type: z.enum(["developer", "client"]),
        from_id: z.string(),
        category: z.enum(["payslip_issue", "contract_question", "project_question", "client_issue", "technical_support"]),
        subject: z.string(),
        description: z.string().optional(),
      },
      mutating: { entityType: "ticket", idParam: "from_id" },
    },
    async (a) => {
      const collection = a.from_type === "developer" ? "developers" : "clients";
      const record = findById(collection, a.from_id) || notFound(a.from_type, a.from_id);
      const from_name = a.from_type === "developer" ? record.name : record.company_name;
      const ticket = {
        id: uid("tick"), from_type: a.from_type, from_id: a.from_id, from_name, category: a.category, subject: a.subject,
        description: a.description || "", status: "open", assigned_to: ROUTE_MAP[a.category] || "Support",
        created_at: todayISO(), updated_at: todayISO(), resolution_time_hrs: null,
      };
      update("tickets", (rows) => { rows.push(ticket); });
      return { success: true, ticket_id: ticket.id, assigned_to: ticket.assigned_to, status: "open" };
    }
  );

  defineTool(
    server,
    user,
    "generate_dispute_resolution",
    {
      title: "Generate a dispute-resolution plan",
      description: "Create a structured dispute record with a suggested resolution path (informational — not legal arbitration).",
      inputSchema: { ticket_id: z.string().optional(), parties: z.array(z.string()).min(1), issue: z.string(), proposed_resolution: z.string().optional() },
      mutating: { entityType: "dispute", idParam: "ticket_id" },
    },
    async (a) => {
      if (a.ticket_id) findById("tickets", a.ticket_id) || notFound("ticket", a.ticket_id);
      const steps = [
        "1. Both parties document their position in writing within 3 business days.",
        "2. Hoorbit's Project Manager reviews the contract/invoice/timesheet records relevant to the dispute.",
        "3. Hoorbit proposes a resolution based on the documented facts (see proposed_resolution below, if provided).",
        "4. If unresolved after 10 business days, escalate to the governing-law jurisdiction named in the relevant contract.",
      ];
      const dispute = { id: uid("dispute"), ticket_id: a.ticket_id || null, parties: a.parties, issue: a.issue, proposed_resolution: a.proposed_resolution || null, steps, created_at: nowISO() };
      return { success: true, dispute, disclaimer: NOT_LEGAL_ADVICE + " This is a suggested internal process, not legal mediation or arbitration." };
    }
  );
}

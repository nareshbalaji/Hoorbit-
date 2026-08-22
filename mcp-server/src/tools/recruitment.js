import { z } from "zod";
import { read, update, findById } from "../db.js";
import { defineTool, notFound } from "../lib/toolkit.js";
import { uid, todayISO } from "../lib/ids.js";
import { weightedMatchScore, skillMatchScore } from "../lib/match.js";
import { convert, fmtMoney } from "../lib/currency.js";
import { redactDeveloperProfileIfNeeded } from "../lib/auth.js";

export function registerRecruitmentTools(server, user) {
  defineTool(
    server,
    user,
    "post_job",
    {
      title: "Post a job / project seat",
      description:
        "Company posts a job opening. Creates (or reuses) a Hoorbit project engagement and returns the top auto-matched developers, ranked by skill overlap.",
      inputSchema: {
        company: z.string().describe("Hiring company name"),
        job_title: z.string(),
        description: z.string().optional(),
        required_skills: z.array(z.string()).min(1),
        location: z.string().default("Remote"),
        salary_min: z.number().positive(),
        salary_max: z.number().positive(),
        currency: z.string().default("USD"),
        team_size: z.number().int().positive().default(1),
        commission_rate: z.number().min(0.03).max(0.15).default(0.07),
      },
      mutating: { entityType: "project", idParam: "job_id", summary: (a, r) => `Posted "${a.job_title}" for ${a.company}` },
    },
    async (a) => {
      const clients = read("clients");
      let client = clients.find((c) => c.company_name.toLowerCase() === a.company.toLowerCase());
      if (!client) {
        client = { id: uid("client"), company_name: a.company, contact_name: "(not on file)", contact_email: "", contact_phone: "", country: "", preferred_currency: a.currency, industry: "", billing_address: "", since: todayISO(), status: "prospect" };
        update("clients", (rows) => { rows.push(client); });
      }

      const start = new Date();
      start.setDate(start.getDate() + 14);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 6);

      const project = {
        id: uid("project"),
        client_id: client.id,
        client_name: client.company_name,
        title: a.job_title,
        description: a.description || "",
        scope: "",
        budget: Math.round(a.salary_max * a.team_size * 6),
        budget_currency: a.currency,
        timeline: { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), status: "recruitment" },
        skills_required: a.required_skills,
        team_size_needed: a.team_size,
        team_assigned: [],
        location: a.location,
        commission_rate: a.commission_rate,
        timeline_status: "on_track",
        client_satisfaction: null,
        risks: [],
        created_at: todayISO(),
        started_at: null,
        salary_min: a.salary_min,
        salary_max: a.salary_max,
      };
      update("projects", (rows) => { rows.push(project); });

      const developers = read("developers");
      const matches = developers
        .map((d) => ({ developer_id: d.id, name: d.name, ...weightedMatchScore(d, project) }))
        .filter((m) => m.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 5);

      return {
        success: true,
        job_id: project.id,
        job_title: project.title,
        company: client.company_name,
        salary_range: `${fmtMoney(a.salary_min, a.currency)} - ${fmtMoney(a.salary_max, a.currency)}`,
        estimated_budget: fmtMoney(project.budget, a.currency),
        status: "open",
        top_matches: matches,
        notifications_sent: `Simulated: matching developers notified from info@hoorbit.com`,
      };
    }
  );

  defineTool(
    server,
    user,
    "search_developers",
    {
      title: "Search developers",
      description: "Search the developer bench by skill, location, minimum experience, and/or maximum monthly rate.",
      inputSchema: {
        skills: z.array(z.string()).default([]),
        location: z.string().optional(),
        min_experience_years: z.number().optional(),
        max_rate_monthly: z.number().optional(),
        max_rate_currency: z.string().default("USD"),
        status: z.enum(["active", "onboarding", "candidate", "any"]).default("any"),
      },
    },
    async (a) => {
      const developers = read("developers");
      const results = developers.filter((d) => {
        if (a.skills.length && !a.skills.some((s) => d.skills.some((ds) => ds.toLowerCase().includes(String(s).toLowerCase())))) return false;
        if (a.location && !d.location.toLowerCase().includes(a.location.toLowerCase())) return false;
        if (a.min_experience_years != null && d.experience_years < a.min_experience_years) return false;
        if (a.max_rate_monthly != null) {
          const rateInTarget = convert(d.current_rate_monthly, d.current_rate_currency, a.max_rate_currency);
          if (rateInTarget > a.max_rate_monthly) return false;
        }
        if (a.status !== "any" && d.status !== a.status) return false;
        return true;
      });
      return {
        success: true,
        count: results.length,
        developers: results.map((d) => ({
          id: d.id, name: d.name, skills: d.skills, years_experience: d.experience_years,
          location: d.location, availability: d.availability, status: d.status,
          rate: fmtMoney(d.current_rate_monthly, d.current_rate_currency) + "/mo",
        })),
      };
    }
  );

  defineTool(
    server,
    user,
    "apply_for_job",
    {
      title: "Apply for a job",
      description: "Developer applies to an open project. Computes a match score and creates a pipeline entry at the 'applied' stage.",
      inputSchema: {
        developer_id: z.string(),
        job_id: z.string().describe("Project id, as returned by post_job / search results"),
        expected_rate_monthly: z.number().optional(),
        expected_rate_currency: z.string().optional(),
        availability: z.string().default("Immediate"),
      },
      mutating: { entityType: "candidate", idParam: "developer_id" },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const project = findById("projects", a.job_id) || notFound("project", a.job_id);
      const match = weightedMatchScore(developer, project);

      const candidate = {
        id: uid("cand"),
        developer_id: developer.id,
        name: developer.name,
        project_id: project.id,
        stage: "applied",
        skills_match_pct: match.breakdown.skills_match_pct,
        interview_score: null,
        expected_rate_monthly: a.expected_rate_monthly || developer.current_rate_monthly,
        expected_rate_currency: a.expected_rate_currency || developer.current_rate_currency,
        applied_at: todayISO(),
        availability: a.availability,
        source: "application",
      };
      update("candidates", (rows) => { rows.push(candidate); });

      return { success: true, message: "Application submitted", candidate_id: candidate.id, developer_name: developer.name, job_title: project.title, company: project.client_name, match_score: match.score, status: "applied" };
    }
  );

  defineTool(
    server,
    user,
    "enable_auto_apply",
    {
      title: "Enable/disable auto-apply",
      description: "Toggle auto-apply for a developer. When enabled, immediately auto-applies them to every open project scoring 60+ that they haven't already applied to.",
      inputSchema: { developer_id: z.string(), enabled: z.boolean() },
      mutating: { entityType: "developer", idParam: "developer_id" },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      update("developers", (rows) => rows.map((d) => (d.id === a.developer_id ? { ...d, auto_apply_enabled: a.enabled } : d)));

      if (!a.enabled) return { success: true, developer_id: a.developer_id, auto_apply_enabled: false, auto_applied_to: [] };

      const projects = read("projects").filter((p) => ["recruitment", "onboarding"].includes(p.timeline.status) && p.team_assigned.length < p.team_size_needed);
      const existing = new Set(read("candidates").filter((c) => c.developer_id === a.developer_id).map((c) => c.project_id));
      const autoApplied = [];
      update("candidates", (rows) => {
        for (const project of projects) {
          if (existing.has(project.id)) continue;
          const match = weightedMatchScore(developer, project);
          if (match.score < 60) continue;
          const candidate = { id: uid("cand"), developer_id: developer.id, name: developer.name, project_id: project.id, stage: "applied", skills_match_pct: match.breakdown.skills_match_pct, interview_score: null, expected_rate_monthly: developer.current_rate_monthly, expected_rate_currency: developer.current_rate_currency, applied_at: todayISO(), availability: developer.availability, source: "auto_apply" };
          rows.push(candidate);
          autoApplied.push({ project_id: project.id, title: project.title, score: match.score });
        }
        return rows;
      });

      return { success: true, developer_id: a.developer_id, auto_apply_enabled: true, auto_applied_to: autoApplied };
    }
  );

  defineTool(
    server,
    user,
    "get_match_score",
    {
      title: "Get developer-job match score",
      description: "Calculate a 0-100 match score between a developer and a project, with the skills/experience/location breakdown that produced it.",
      inputSchema: { developer_id: z.string(), job_id: z.string() },
    },
    async (a) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const project = findById("projects", a.job_id) || notFound("project", a.job_id);
      const match = weightedMatchScore(developer, project);
      return {
        success: true,
        developer_name: developer.name,
        company: project.client_name,
        job_title: project.title,
        match_score: match.score,
        breakdown: match.breakdown,
        salary_fit: project.salary_max ? (convert(developer.current_rate_monthly, developer.current_rate_currency, project.budget_currency) <= project.salary_max ? "within range" : "above range") : "not specified",
      };
    }
  );

  defineTool(
    server,
    user,
    "get_developer_profile",
    {
      title: "Get full developer profile",
      description: "Full developer profile: contact info, skills, current contracts, payroll history summary, onboarding status, and pipeline applications.",
      inputSchema: { developer_id: z.string() },
    },
    async (a, user) => {
      const developer = findById("developers", a.developer_id) || notFound("developer", a.developer_id);
      const contracts = read("contracts").filter((c) => c.developer_id === a.developer_id);
      const payroll = read("payroll").filter((p) => p.developer_id === a.developer_id);
      const applications = read("candidates").filter((c) => c.developer_id === a.developer_id);
      const onboarding = read("onboarding").filter((o) => o.developer_id === a.developer_id);
      const insurance = read("insurance").filter((i) => i.developer_id === a.developer_id);
      const isPrivileged = user && (user.role === "pm" || (user.role === "developer" && user.linkedId === developer.id));
      return {
        success: true,
        developer: redactDeveloperProfileIfNeeded(user, developer),
        contracts,
        payroll_records: payroll.length,
        lifetime_net_pay_by_currency: isPrivileged ? payroll.reduce((acc, p) => { acc[p.currency] = (acc[p.currency] || 0) + p.net_pay; return acc; }, {}) : "[redacted — not visible to your role]",
        applications,
        onboarding,
        insurance,
      };
    }
  );

  defineTool(
    server,
    user,
    "bulk_import_developers",
    {
      title: "Bulk import developers",
      description: "Import multiple developers at once (e.g. from a CSV-derived array). Rows missing name/email/skills are rejected individually rather than failing the whole batch.",
      inputSchema: {
        developers: z.array(z.object({
          name: z.string(),
          email: z.string(),
          phone: z.string().optional(),
          location: z.string().optional(),
          skills: z.array(z.string()).optional(),
          experience_years: z.number().optional(),
          current_rate_monthly: z.number().optional(),
          current_rate_currency: z.string().optional(),
        })).min(1),
      },
      mutating: { entityType: "developer", idParam: null, summary: (a, r) => `Bulk-imported ${r.imported} developer(s)` },
    },
    async (a) => {
      const errors = [];
      const created = [];
      update("developers", (rows) => {
        a.developers.forEach((row, i) => {
          if (!row.name || !row.email || !row.skills || !row.skills.length) {
            errors.push({ index: i, row, error: "name, email, and at least one skill are required" });
            return;
          }
          const developer = {
            id: uid("dev"), name: row.name, email: row.email, phone: row.phone || "", location: row.location || "Remote", timezone: "UTC",
            skills: row.skills, experience_years: row.experience_years || 0, certifications: [], current_rate_monthly: row.current_rate_monthly || 0,
            current_rate_currency: row.current_rate_currency || "USD", availability: "Immediate", bank_account: "Pending KYC", tax_id: "Pending",
            background_check: "in_review", ratings: 0, total_earned_usd: 0, status: "candidate", auto_apply_enabled: false, profile_completeness: 45,
          };
          rows.push(developer);
          created.push(developer.id);
        });
        return rows;
      });
      return { success: true, imported: created.length, developer_ids: created, errors };
    }
  );

  defineTool(
    server,
    user,
    "create_candidate_pipeline",
    {
      title: "Create a sourced-candidate pipeline entry",
      description: "Recruiter manually adds a sourced candidate (who may not yet have a full developer profile) into a project's hiring pipeline.",
      inputSchema: {
        name: z.string(),
        project_id: z.string(),
        skills: z.array(z.string()).default([]),
        developer_id: z.string().optional(),
        expected_rate_monthly: z.number().optional(),
        expected_rate_currency: z.string().default("USD"),
        availability: z.string().default("Immediate"),
        initial_stage: z.enum(["applied", "shortlisted", "interviewed"]).default("applied"),
      },
      mutating: { entityType: "candidate", idParam: "project_id" },
    },
    async (a) => {
      const project = findById("projects", a.project_id) || notFound("project", a.project_id);
      const skillsPct = skillMatchScore(a.skills, project.skills_required);
      const candidate = {
        id: uid("cand"), developer_id: a.developer_id || null, name: a.name, project_id: project.id, stage: a.initial_stage,
        skills_match_pct: skillsPct, interview_score: null, expected_rate_monthly: a.expected_rate_monthly || null,
        expected_rate_currency: a.expected_rate_currency, applied_at: todayISO(), availability: a.availability, source: "sourced", skills: a.skills,
      };
      update("candidates", (rows) => { rows.push(candidate); });
      return { success: true, candidate_id: candidate.id, name: a.name, project: project.title, stage: candidate.stage, skills_match_pct: skillsPct };
    }
  );
}

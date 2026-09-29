import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { uid, nowISO } from "./lib/ids.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "data");
// Vercel's deployment bundle is read-only outside /tmp, so fall back there
// when running serverless. /tmp is ephemeral per container — fine for a demo,
// but not durable storage; a real deployment would use a real database.
const DEFAULT_DB_DIR = process.env.VERCEL ? "/tmp/hoorbit-database" : path.join(__dirname, "..", "database");
const DB_DIR = process.env.HOORBIT_DB_DIR || DEFAULT_DB_DIR;

export const COLLECTIONS = [
  "clients", "developers", "projects", "candidates", "interviews",
  "contracts", "onboarding", "payroll", "invoices", "insurance",
  "compliance", "audit_trail", "tickets",
  "trade_companies", "trade_rfqs", "trade_matches", "trade_deals",
];

function ensureSeeded() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  for (const name of COLLECTIONS) {
    const dest = path.join(DB_DIR, `${name}.json`);
    if (!fs.existsSync(dest)) {
      const src = path.join(SEED_DIR, `${name}.json`);
      const seed = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : "[]\n";
      fs.writeFileSync(dest, seed);
    }
  }
}
ensureSeeded();

export function resetDatabase() {
  for (const name of COLLECTIONS) {
    const src = path.join(SEED_DIR, `${name}.json`);
    const dest = path.join(DB_DIR, `${name}.json`);
    const seed = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : "[]\n";
    fs.writeFileSync(dest, seed);
  }
  return { reset: true, at: nowISO() };
}

export function read(name) {
  const file = path.join(DB_DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return [];
  }
}

export function write(name, data) {
  const file = path.join(DB_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return data;
}

// Convenience: load -> mutate via fn(collectionArray) -> save. fn may return a
// replacement array, or mutate in place and return undefined.
export function update(name, fn) {
  const data = read(name);
  const result = fn(data);
  write(name, result || data);
  return result || data;
}

export function findById(name, id) {
  return read(name).find((row) => row.id === id) || null;
}

export function logAudit(actor, action, entityType, entityId, details) {
  update("audit_trail", (rows) => {
    rows.unshift({ id: uid("audit"), actor: actor || "mcp-tool", action, entity_type: entityType, entity_id: entityId, at: nowISO(), details: details || null });
    return rows.slice(0, 500);
  });
}

export function dbDir() {
  return DB_DIR;
}

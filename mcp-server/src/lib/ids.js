let seq = 1000;

export function uid(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

export function monthLabel(offsetFromNow = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

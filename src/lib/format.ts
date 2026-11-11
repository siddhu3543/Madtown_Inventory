/** NFR-020: times in IST, dates like "16 Oct 2026", currency in Rs, plain English. */
const TZ = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const partsFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00+05:30" : d) : d;
  if (Number.isNaN(x.getTime())) return "—";
  return dateFmt.format(x).replace(/Sept/, "Sep");
}
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "—";
  return `${fmtDate(x)}, ${timeFmt.format(x)} IST`;
}
export function fmtRs(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  return "Rs " + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
/** IST calendar parts, used by jobs (09:00 IST reminders) */
export function istParts(d: Date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: +p.year,
    m: +p.month,
    d: +p.day,
    hh: +p.hour % 24,
    mm: +p.minute,
    dateKey: `${p.year}-${p.month}-${p.day}`,
    dow: new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay(),
  };
}
/** value for <input type="datetime-local"> in IST */
export function toIstInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  const p = istParts(x);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
}
/** parse datetime-local value as IST */
export function fromIstInput(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.length === 10 ? `${v}T18:00` : v;
  const d = new Date(`${s}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86400_000);
}

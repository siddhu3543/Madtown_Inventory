/** NFR-003 / AC-NFR-01: only @madtown.in accounts may sign in. Pure function, unit-tested. */
export function isAllowedEmail(email: string | null | undefined, domain = "madtown.in"): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || e.indexOf("@") !== at) return false;
  return e.slice(at + 1) === domain;
}

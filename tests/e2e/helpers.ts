import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
export const PW = "e2e-password-123";
export const U = {
  owner: "naveen@madtown.in",
  manager: "anand@madtown.in",
  team: "team.tester@madtown.in",
  team2: "team.tester2@madtown.in",
  dev: "siddharth.dev@madtown.in",
};
export async function login(page: Page, email: string, password = PW) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("scan-button")).toBeVisible();
}
export async function logout(page: Page) {
  await page.context().clearCookies();
}
export async function sql<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: "postgres://postgres@127.0.0.1:54322/madtown_e2e" });
  await c.connect();
  try {
    return (await c.query(q, p)).rows as T[];
  } finally {
    await c.end();
  }
}
/** a real JPEG for camera inputs */
export const PHOTO = "tests/e2e/photo.jpg";

/**
 * Fills the check-out form the way the desk does now that every borrower detail is mandatory (2026-11-24).
 * `borrower` is the option label, e.g. "Test Team Member (me)" or "Chiru (no login)". When the borrower's email or
 * phone is not on file the form asks for it; this fills those too.
 */
export async function fillCheckout(page: Page, o: { borrower: string; purpose?: string; condition?: string; email?: string; phone?: string }) {
  await page.getByTestId("borrower").selectOption({ label: o.borrower });
  const email = page.getByTestId("contact-email");
  const phone = page.getByTestId("contact-phone");
  if (await email.isVisible()) await email.fill(o.email ?? "borrower@example.com");
  if (await phone.isVisible()) await phone.fill(o.phone ?? "+91 98765 43210");
  await page.getByTestId("purpose").fill(o.purpose ?? "E2E shoot");
  await page.getByTestId("condition-out").selectOption(o.condition ?? "Good");
}

/** Fills the mandatory check-in answers: condition, damage yes/no, missing yes/no, return notes. */
export async function fillCheckin(page: Page, o: { condition?: string; notes?: string; damage?: "yes" | "no"; damageText?: string; missing?: "yes" | "no" } = {}) {
  await page.getByTestId("condition-in").selectOption(o.condition ?? "Good");
  await page.getByTestId(`damage-${o.damage ?? "no"}`).check();
  if (o.damage === "yes") await page.getByTestId("damage-description").fill(o.damageText ?? "Scratch on the body");
  await page.getByTestId(`missing-${o.missing ?? "no"}`).check();
  await page.getByTestId("checkin-notes").fill(o.notes ?? "No issues");
}

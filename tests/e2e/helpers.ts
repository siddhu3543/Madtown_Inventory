import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
export const PW = "e2e-password-123";
export const U = {
  owner: "naveen@madtown.in",
  manager: "anand@madtown.in",
  team: "team.tester@madtown.in",
  team2: "team.tester2@madtown.in",
  readonly: "accounts.tester@madtown.in",
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

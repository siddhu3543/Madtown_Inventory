import { test, expect } from "@playwright/test";
import { login, U } from "./helpers";

test("AC-QR-02 (emulated phone): MTMH_104 label opens its item page in under 2 seconds", async ({ page }) => {
  await login(page, U.team);
  await page.goto("/items"); // warm-up like a running app
  const t0 = Date.now();
  await page.goto("/i/MTMH_104");
  await expect(page.getByTestId("item-id")).toHaveText("MTMH_104");
  const ms = Date.now() - t0;
  console.log(`scan-to-item ${ms} ms`);
  expect(ms).toBeLessThan(2000);
});

test("FR-QR-006: manual ID fallback when a label is worn", async ({ page }) => {
  await login(page, U.team);
  await page.goto("/scan");
  await page.getByTestId("manual-id").fill("104");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/items\/MTMH_104/);
  await page.goto("/scan");
  await page.getByTestId("manual-id").fill("fx3");
  await expect(page.getByTestId("manual-matches")).toContainText("MTMH_101");
});

test("NFR-024 / NFR-011: text at least 16 px and touch targets at least 40 px on a phone; no horizontal scrolling", async ({ page }) => {
  await login(page, U.team);
  for (const u of ["/", "/items", "/items/MTMH_103", "/items/MTMH_103/checkout", "/scan"]) {
    await page.goto(u);
    const r = await page.evaluate(() => {
      const small = [...document.querySelectorAll("main p, main li, main label, main input, main select, main a.btn, main button")].filter(
        (e) => (e as HTMLElement).offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16 && !(e as HTMLElement).closest(".badge, .phase, code"),
      );
      const tiny = [...document.querySelectorAll("main .btn")].filter((e) => (e as HTMLElement).offsetParent && e.getBoundingClientRect().height < 40);
      return { small: small.length, tiny: tiny.length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
    expect(r, u).toEqual({ small: 0, tiny: 0, overflow: false });
  }
});

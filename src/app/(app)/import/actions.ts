"use server";
import { readFileSync } from "node:fs";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { act, str, type ActionState } from "@/lib/actions";
import { runImport, type ImportMode } from "@/lib/importer/apply";
import { AppError } from "@/lib/errors";

async function fileText(fd: FormData, k: string) {
  const f = fd.get(k);
  return f instanceof File && f.size ? await f.text() : null;
}

/** SCR-13: Owner (with Siddharth) runs import; dry-run is repeatable (MIG-015). */
export async function run(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const mode = str(fd, "mode") as ImportMode;
    if (!(u.role === "Owner" || (u.isDeveloper && mode === "dry-run"))) throw new AppError("NOT_ALLOWED", "Only the Owner runs a real import; the developer may run dry-runs");
    if (mode === "final" && !env.isProductionEnv) throw new AppError("NOT_ALLOWED", "Final import is for production only; use Apply on staging");
    const useFixture = str(fd, "source") === "fixture";
    const sheet1 = useFixture ? readFileSync("fixtures/sheet/Sheet1.csv", "utf8") : await fileText(fd, "sheet1");
    const toBuy = useFixture ? readFileSync("fixtures/sheet/To buy.csv", "utf8") : await fileText(fd, "tobuy");
    const unsorted = useFixture ? readFileSync("fixtures/sheet/Not yet sorted.csv", "utf8") : await fileText(fd, "unsorted");
    if (!sheet1 || !toBuy || !unsorted) throw new AppError("FILES_REQUIRED", "Upload all three CSV files (Sheet1, To buy, Not yet sorted)");
    const r = await runImport({
      sheet1,
      toBuy,
      unsorted,
      fileRules: JSON.parse(readFileSync("fixtures/mapping-rules.json", "utf8")),
      mode,
      startedBy: u.id,
      environment: env.appEnv,
      source: useFixture ? "fixtures/sheet (SYNTHETIC)" : "uploaded CSV export",
    });
    return { redirectTo: `/import/${r.runId}` };
  });
}
export async function addRule(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    let rule: unknown;
    try {
      rule = JSON.parse(str(fd, "rule"));
    } catch {
      throw new AppError("BAD_JSON", 'Rule must be valid JSON, e.g. {"custodian": true}');
    }
    await withUser(u.id, (c) =>
      c.query("insert into import_mapping_rules(target, rule, note, created_by) values ($1,$2,$3,auth.uid())", [str(fd, "target").trim(), rule, str(fd, "note") || null]),
    );
    return { message: "Rule saved; it applies on the next run.", revalidate: ["/import"] };
  });
}
export async function disableRule(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) => c.query("update import_mapping_rules set active = false where id = $1", [str(fd, "id")]));
    return { revalidate: ["/import"] };
  });
}

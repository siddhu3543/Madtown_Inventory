"use server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { env } from "@/lib/env";
import { act, str, type ActionState } from "@/lib/actions";
import { runImport, type ImportMode } from "@/lib/importer/apply";
import { collectSheets, missingTabs, type TabKey, type UploadedFile } from "@/lib/importer/workbook";
import type { Rules } from "@/lib/importer/plan";
import realRules from "@/lib/importer/mapping-rules.json";
import { AppError } from "@/lib/errors";

const MAX_BYTES = 8 * 1024 * 1024;

async function uploads(fd: FormData, field: string): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const f of fd.getAll(field)) {
    if (!(f instanceof File) || !f.size) continue;
    if (f.size > MAX_BYTES) throw new AppError("FILE_TOO_LARGE", `${f.name} is larger than 8 MB`);
    if (/\.xls$/i.test(f.name)) throw new AppError("OLD_EXCEL", `${f.name} is an old .xls file; in Excel use File > Save As > Excel Workbook (.xlsx)`);
    out.push({ name: f.name, data: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

/** SCR-13: Owner (with Siddharth) runs import; preview (dry-run) is repeatable. */
export async function run(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const mode = (str(fd, "mode") || "dry-run") as ImportMode;
    if (!["dry-run", "apply"].includes(mode)) throw new AppError("BAD_MODE", "Choose Preview or Import");
    if (!(u.role === "Admin" || (u.isDeveloper && mode === "dry-run"))) throw new AppError("NOT_ALLOWED", "Only an Admin runs a real import; the developer may run previews");
    const replace = str(fd, "replace") === "on";
    const useFixture = str(fd, "source") === "fixture" && !env.isProductionEnv;

    let sheets: { sheet1: string | null; toBuy: string | null; unsorted: string | null };
    let source: string;
    if (useFixture) {
      const dir = join(process.cwd(), "fixtures/sheet");
      sheets = {
        sheet1: readFileSync(join(dir, "Sheet1.csv"), "utf8"),
        toBuy: readFileSync(join(dir, "To buy.csv"), "utf8"),
        unsorted: readFileSync(join(dir, "Not yet sorted.csv"), "utf8"),
      };
      source = "fixtures/sheet (SYNTHETIC)";
    } else {
      const files: { file: UploadedFile; hint?: TabKey }[] = [
        ...(await uploads(fd, "workbook")).map((file) => ({ file })),
        ...(await uploads(fd, "sheet1")).map((file) => ({ file, hint: "sheet1" as const })),
        ...(await uploads(fd, "tobuy")).map((file) => ({ file, hint: "toBuy" as const })),
        ...(await uploads(fd, "unsorted")).map((file) => ({ file, hint: "unsorted" as const })),
      ];
      if (!files.length) throw new AppError("FILES_REQUIRED", "Choose the Excel workbook (or the three CSV files) first");
      let collected;
      try {
        collected = await collectSheets(files);
      } catch (e) {
        throw new AppError("BAD_FILE", (e as Error).message);
      }
      const missing = missingTabs(collected.sheets);
      if (missing.length)
        throw new AppError(
          "TABS_MISSING",
          `Could not find the ${missing.join(", ")} tab${missing.length > 1 ? "s" : ""}. ${collected.notes.join(". ")}. The workbook needs tabs named Sheet1, To buy and Not yet sorted (or tabs with the same column headers).`,
        );
      sheets = collected.sheets;
      source = `upload: ${files.map((f) => f.file.name).join(", ")}`;
    }
    let fileRules: Rules = realRules as unknown as Rules;
    if (useFixture) fileRules = JSON.parse(readFileSync(join(process.cwd(), "fixtures/mapping-rules.json"), "utf8"));
    const r = await runImport({
      sheet1: sheets.sheet1!,
      toBuy: sheets.toBuy!,
      unsorted: sheets.unsorted!,
      fileRules,
      mode,
      replace,
      startedBy: u.id,
      environment: env.appEnv,
      source,
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

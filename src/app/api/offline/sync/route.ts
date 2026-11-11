import { api } from "@/lib/api";
import { checkout, checkin } from "@/lib/services/loans";
import { withService } from "@/lib/db";
import { toAppError } from "@/lib/errors";
import { notify, managerEmails } from "@/lib/services/notifications";
import { fromIstInput } from "@/lib/format";

type Action = { client_uuid: string; kind: "checkout" | "checkin"; payload: Record<string, unknown>; created_at: string; label: string };

/** NFR-014: replay queued offline actions. Server time wins; rejections become sync_conflicts flagged to Managers. */
export const POST = api(async (u, req) => {
  const { actions } = (await req.json()) as { actions: Action[] };
  const results: { client_uuid: string; ok: boolean; error?: string; loan_id?: string }[] = [];
  for (const a of (actions ?? []).slice(0, 50)) {
    try {
      const p: Record<string, unknown> = { ...a.payload, client_uuid: a.client_uuid, offline: true };
      if (typeof p.quantity === "string") p.quantity = Number(p.quantity) || 1;
      if (typeof p.due_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.due_at)) p.due_at = fromIstInput(p.due_at);
      const r = a.kind === "checkout" ? await checkout(u, p) : await checkin(u, p);
      results.push({ client_uuid: a.client_uuid, ok: true, loan_id: r.loan_id });
    } catch (e) {
      const err = toAppError(e);
      await withService((c) =>
        c.query("insert into sync_conflicts(client_uuid, user_id, action, client_created_at, error_code, error) values ($1,$2,$3,$4,$5,$6)", [
          a.client_uuid,
          u.id,
          a,
          a.created_at,
          err.code,
          err.message,
        ]),
      );
      await notify({
        code: "SYNC-CONFLICT",
        dedupe: `SYNC:${a.client_uuid}`,
        to: await managerEmails(),
        subject: `Offline action rejected: ${a.label}`,
        text: `${u.name}'s offline action "${a.label}" (queued ${a.created_at}) was rejected: ${err.code} ${err.message}`,
      });
      results.push({ client_uuid: a.client_uuid, ok: false, error: err.code });
    }
  }
  return { results };
});

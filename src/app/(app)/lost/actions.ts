"use server";
import { requireUser } from "@/lib/auth";
import { withUser, callWorkflow } from "@/lib/db";
import { act, str, type ActionState } from "@/lib/actions";
import { notify, ownerEmails } from "@/lib/services/notifications";
export async function resolve(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const r = await withUser(u.id, (c) =>
      callWorkflow<{ status: string }>(c, "resolve_incident", {
        incident_id: str(fd, "incident_id"),
        resolution: str(fd, "resolution"),
        note: str(fd, "note"),
        claim_ref: str(fd, "claim_ref") || null,
        wishlist_id: str(fd, "wishlist_id") || null,
      }),
    );
    if (r.status === "Pending write-off")
      await notify({
        code: "WRITE-OFF",
        dedupe: null,
        to: await ownerEmails(),
        subject: "Write-off awaiting approval",
        text: `${u.name} proposes writing off an item: ${str(fd, "note")}`,
      });
    return { message: r.status === "Pending write-off" ? "Sent to the Owner for write-off approval." : "Resolved.", revalidate: ["/lost"] };
  });
}
export async function decide(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) => callWorkflow(c, "decide_writeoff", { incident_id: str(fd, "incident_id"), approve: str(fd, "d") === "approve", comment: str(fd, "comment") }));
    return { revalidate: ["/lost"] };
  });
}

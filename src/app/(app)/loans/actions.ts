"use server";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { act, str, type ActionState } from "@/lib/actions";
export async function resolveConflict(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) =>
      c.query("update sync_conflicts set resolved_at = now(), resolved_by = auth.uid(), resolution_note = $2 where id = $1", [str(fd, "id"), str(fd, "note")]),
    );
    return { revalidate: ["/loans"] };
  });
}

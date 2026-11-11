"use server";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { act, str, type ActionState } from "@/lib/actions";

export async function saveView(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const q = Object.fromEntries(new URLSearchParams(str(fd, "query")));
    await withUser(u.id, (c) =>
      c.query(
        `insert into saved_views(user_id, name, query) values (auth.uid(), $1, $2)
      on conflict (user_id, name) do update set query = excluded.query`,
        [str(fd, "name"), q],
      ),
    );
    return { message: "View saved", revalidate: ["/items"] };
  });
}
export async function deleteView(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, (c) => c.query("delete from saved_views where id = $1", [str(fd, "id")]));
    return { revalidate: ["/items"] };
  });
}

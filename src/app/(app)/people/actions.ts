"use server";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { act, str, bool, type ActionState } from "@/lib/actions";

export async function addPerson(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    await withUser(u.id, async (c) => {
      const p = await c.query("insert into people(name, person_type) values ($1,$2) returning id", [str(fd, "name"), str(fd, "person_type")]);
      if (str(fd, "email") || str(fd, "phone"))
        await c.query("insert into people_contacts(person_id, email, phone) values ($1, nullif($2,''), nullif($3,''))", [p.rows[0].id, str(fd, "email"), str(fd, "phone")]);
    });
    return { message: "Added.", revalidate: ["/people"] };
  });
}
export async function updatePerson(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const id = str(fd, "id");
    await withUser(u.id, async (c) => {
      await c.query("update people set name = $2, person_type = $3, active = $4, person_type_to_verify = $5, notes = nullif($6,'') where id = $1", [
        id,
        str(fd, "name"),
        str(fd, "person_type"),
        bool(fd, "active"),
        bool(fd, "type_to_verify"),
        str(fd, "notes"),
      ]);
      await c.query(
        `insert into people_contacts(person_id, email, phone) values ($1, nullif($2,''), nullif($3,''))
                     on conflict (person_id) do update set email = excluded.email, phone = excluded.phone`,
        [id, str(fd, "email"), str(fd, "phone")],
      );
    });
    return { message: "Saved.", revalidate: [`/people/${id}`] };
  });
}

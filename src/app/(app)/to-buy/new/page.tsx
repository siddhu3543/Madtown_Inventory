import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { propose } from "../actions";
export const metadata = { title: "Propose to-buy" };
export default async function NewToBuy({ searchParams }: { searchParams: Promise<{ related?: string; description?: string }> }) {
  const u = await requireUser(["Owner", "Manager", "Team member"]);
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Propose a purchase" phase={2} sub="The Owner approves or rejects; you will see the decision on the line." />
      <div className="card p-4">
        <ActionForm action={propose} className="grid gap-3 sm:grid-cols-2">
          <label className="field sm:col-span-2">
            <span>Item</span>
            <input name="item_description" className="input" required defaultValue={sp.description ?? ""} />
          </label>
          <label className="field sm:col-span-2">
            <span>Reason</span>
            <input name="reason" className="input" required />
          </label>
          <label className="field">
            <span>Related item IDs</span>
            <input name="related" className="input" defaultValue={sp.related ?? ""} placeholder="106 101" />
          </label>
          <label className="field">
            <span>Replaces or adds</span>
            <select name="replaces_or_adds" className="input">
              <option>Replaces</option>
              <option>Adds</option>
            </select>
          </label>
          <label className="field">
            <span>Note on replaces/adds</span>
            <input name="replaces_or_adds_note" className="input" placeholder="(case) and adds (missing accessories)" />
          </label>
          <label className="field">
            <span>Priority</span>
            <select name="priority" className="input">
              <option>High</option>
              <option defaultChecked>Medium</option>
              <option>Low</option>
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" className="input">
              <option>To buy</option>
              <option>To research</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="verify_first" /> Verify before buying (e.g. confirm count first)
          </label>
          <label className="field">
            <span>Verify what</span>
            <input name="verify_note" className="input" />
          </label>
          <label className="field sm:col-span-2">
            <span>Links</span>
            <input name="links" className="input" />
          </label>
          {u.financeVisible && (
            <label className="field">
              <span>Estimated cost (Rs)</span>
              <input name="estimated_cost" type="number" className="input" />
            </label>
          )}
          <label className="field sm:col-span-2">
            <span>Notes</span>
            <textarea name="notes" className="input" rows={2} />
          </label>
          <Submit>Propose</Submit>
        </ActionForm>
      </div>
    </>
  );
}

"use server";
import { requireUser } from "@/lib/auth";
import { act, type ActionState } from "@/lib/actions";
import { checkout } from "@/lib/services/loans";
import { checkoutFields } from "@/lib/checkout-form";

/** FR-CHK-001/010: borrower, borrower's email and phone, purpose, due date, condition, photos, quantity — all mandatory */
export async function doCheckout(_: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const u = await requireUser();
    const r = await checkout(u, checkoutFields(fd));
    return { redirectTo: `/loans/${r.loan_id}?new=1${r.warnings.length ? `&w=${encodeURIComponent(r.warnings.join(","))}` : ""}` };
  });
}

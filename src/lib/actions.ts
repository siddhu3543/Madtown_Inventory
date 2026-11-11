import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { toAppError } from "./errors";

export type ActionState = { ok?: boolean; error?: string; code?: string; message?: string; data?: Record<string, unknown> } | null;

/** Wrap a server action: maps workflow errors to friendly messages, optional redirect on success. */
export async function act(fn: () => Promise<{ redirectTo?: string; message?: string; data?: Record<string, unknown>; revalidate?: string[] } | void>): Promise<ActionState> {
  let res: Awaited<ReturnType<typeof fn>>;
  try {
    res = await fn();
  } catch (e) {
    const err = toAppError(e);
    if (err.code === "INTERNAL") console.error(JSON.stringify({ level: "error", msg: "action failed", err: err.message }));
    return { error: friendly(err.code, err.message), code: err.code };
  }
  for (const p of res?.revalidate ?? []) revalidatePath(p);
  if (res?.redirectTo) redirect(res.redirectTo);
  return { ok: true, message: res?.message, data: res?.data };
}

const FRIENDLY: Record<string, string> = {
  PHOTO_REQUIRED: "A photo is required: ",
  ALREADY_OUT: "Already checked out: ",
  INSUFFICIENT_QTY: "Not enough available: ",
  IN_REPAIR: "In repair: ",
  OVERDUE_BLOCKED: "Blocked: ",
  OVERDUE_NEEDS_REASON: "Override needed: ",
  KIT_INCOMPLETE: "Kit incomplete: ",
  RESERVED_CONFLICT: "Reserved: ",
};
function friendly(code: string, msg: string) {
  return (FRIENDLY[code] ?? "") + msg.charAt(0).toUpperCase() + msg.slice(1);
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const bool = (f: FormData, k: string) => ["on", "true", "1", "yes"].includes(str(f, k));
export const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" ? null : Number(v);
};
export const list = (f: FormData, k: string) => f.getAll(k).filter((x): x is string => typeof x === "string" && x !== "");

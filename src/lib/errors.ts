/** Workflow errors raised in PostgreSQL as "CODE: message" (app.fail) mapped to typed errors. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public detail?: string,
  ) {
    super(message);
  }
}
const STATUS: Record<string, number> = { NOT_ALLOWED: 403, NOT_AUTHENTICATED: 401, ITEM_NOT_FOUND: 404, LOAN_NOT_FOUND: 404, NOT_FOUND: 404 };
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as { message?: string; code?: string; constraint?: string };
  const msg = err?.message ?? String(e);
  const m = msg.match(/^([A-Z][A-Z_]+): (.*)$/s);
  if (m) return new AppError(m[1], m[2], STATUS[m[1]] ?? 400);
  if (err?.code === "42501") return new AppError("NOT_ALLOWED", `You do not have permission to do that. (${msg})`, 403, msg);
  if (err?.code === "23505" && err.constraint === "loan_lines_single_active") return new AppError("ALREADY_OUT", "This item is already checked out.", 409);
  if (err?.code === "23P01") return new AppError("RESERVED_CONFLICT", "That period overlaps an existing reservation.", 409);
  if (err?.code === "23514") return new AppError("CONSTRAINT", msg, 400);
  if (err?.code === "23505") return new AppError("DUPLICATE", msg, 409);
  if (err?.code === "23503") return new AppError("REFERENCE", msg, 400);
  if (err?.code === "22P02") return new AppError("BAD_INPUT", "Invalid value.", 400);
  return new AppError("INTERNAL", msg, 500);
}

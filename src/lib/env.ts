/** Typed environment access. Secrets only ever come from env (NFR-005). */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}
export const env = {
  get appEnv() {
    return process.env.APP_ENV ?? "local";
  },
  get databaseUrl() {
    return req("DATABASE_URL");
  },
  get authProvider() {
    return (process.env.AUTH_PROVIDER ?? "local") as "local" | "supabase";
  },
  get sessionSecret() {
    return req("SESSION_SECRET");
  },
  get cronSecret() {
    return req("CRON_SECRET");
  },
  get qrBaseUrl() {
    return (process.env.QR_BASE_URL ?? "https://inventory.madtown.in").replace(/\/$/, "");
  },
  get appBaseUrl() {
    return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  /** the configured value; adapters/storage.resolveStorageProvider decides what is actually used */
  get storageProvider() {
    return (process.env.STORAGE_PROVIDER ?? "local") as "local" | "drive" | "supabase";
  },
  get emailProvider() {
    return (process.env.EMAIL_PROVIDER ?? "outbox") as "outbox" | "resend";
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? "Madtown Inventory <inventory@madtown.in>";
  },
  get emailSandboxTo() {
    return process.env.EMAIL_SANDBOX_TO || null;
  },
  get mirrorProvider() {
    return (process.env.MIRROR_PROVIDER ?? "csv") as "csv" | "sheets";
  },
  get allowedDomain() {
    return "madtown.in";
  },
  get isProductionEnv() {
    return process.env.APP_ENV === "production";
  },
};

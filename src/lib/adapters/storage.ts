import "server-only";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * FR-PHO-004 / FR-PHO-008 / NFR-018 storage adapter. The database stores provider + file id + thumbnail ref,
 * never bytes. Drive is the production store (one folder per item); local disk for local/CI.
 * Adding R2 or Supabase Storage = implement this interface and set STORAGE_PROVIDER; no data changes.
 */
export interface StorageAdapter {
  readonly name: "local" | "drive" | "r2" | "supabase";
  put(folderKey: string, fileName: string, bytes: Buffer, mime: string): Promise<{ fileId: string; folderId: string }>;
  get(fileId: string): Promise<{ bytes: Buffer; mime: string }>;
  listFolder?(folderId: string): Promise<{ id: string; name: string; mime: string }[]>;
}

class LocalDiskStorage implements StorageAdapter {
  readonly name = "local" as const;
  private root = resolve(process.env.LOCAL_STORAGE_DIR ?? ".storage");
  async put(folderKey: string, fileName: string, bytes: Buffer) {
    const safe = folderKey.replace(/[^A-Za-z0-9_-]/g, "_");
    const dir = join(this.root, safe);
    const id = `${safe}/${randomUUID()}-${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(this.root, id), bytes);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EROFS" || code === "EACCES" || code === "EPERM")
        throw new Error("Photo storage is not set up on this server (its disk is read-only). An Admin must configure Supabase Storage.");
      throw e;
    }
    return { fileId: id, folderId: safe };
  }
  async get(fileId: string) {
    const p = resolve(this.root, fileId);
    if (!p.startsWith(this.root)) throw new Error("bad file id");
    return { bytes: await readFile(p), mime: fileId.endsWith(".webp") ? "image/webp" : fileId.endsWith(".pdf") ? "application/pdf" : "image/jpeg" };
  }
  async listFolder(folderId: string) {
    const dir = resolve(this.root, folderId);
    if (!dir.startsWith(this.root)) return [];
    try {
      return (await readdir(dir)).map((n) => ({ id: `${folderId}/${n}`, name: n, mime: "image/jpeg" }));
    } catch {
      return [];
    }
  }
}

/** Google Drive via a Workspace service account with access to a Madtown shared drive (A4, OQ-S-04). */
class GoogleDriveStorage implements StorageAdapter {
  readonly name = "drive" as const;
  private rootFolder = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "";
  private async token(): Promise<string> {
    const { GoogleAuth } = await import("google-auth-library");
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
    if (!raw || !this.rootFolder) throw new Error("Drive not configured: GOOGLE_SERVICE_ACCOUNT_JSON_B64 and GOOGLE_DRIVE_ROOT_FOLDER_ID are required");
    const auth = new GoogleAuth({ credentials: JSON.parse(Buffer.from(raw, "base64").toString("utf8")), scopes: ["https://www.googleapis.com/auth/drive"] });
    const t = await (await auth.getClient()).getAccessToken();
    if (!t.token) throw new Error("Drive token failed");
    return t.token;
  }
  private async api(path: string, init: RequestInit = {}) {
    const res = await fetch(`https://www.googleapis.com${path}`, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }
  private async folderFor(key: string): Promise<string> {
    const q = encodeURIComponent(`name='${key.replace(/'/g, "")}' and '${this.rootFolder}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await (await this.api(`/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json();
    if (found.files?.[0]?.id) return found.files[0].id;
    const created = await (
      await this.api(`/drive/v3/files?supportsAllDrives=true&fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: key, mimeType: "application/vnd.google-apps.folder", parents: [this.rootFolder] }),
      })
    ).json();
    return created.id;
  }
  async put(folderKey: string, fileName: string, bytes: Buffer, mime: string) {
    const folderId = await this.folderFor(folderKey);
    const boundary = "mt" + randomUUID();
    const meta = JSON.stringify({ name: fileName, parents: [folderId] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await (
      await this.api(`/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      })
    ).json();
    return { fileId: r.id as string, folderId };
  }
  async get(fileId: string) {
    const res = await this.api(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/jpeg" };
  }
  async listFolder(folderId: string) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType contains 'image/'`);
    const r = await (await this.api(`/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json();
    return (r.files ?? []).map((f: { id: string; name: string; mimeType: string }) => ({ id: f.id, name: f.name, mime: f.mimeType }));
  }
}

/**
 * Supabase Storage (2026-11-24): the deployment already runs on Supabase, so photos go to a private bucket there.
 * Uses the server-only service-role key; browsers never get bucket URLs — photos are served through /api/photos (RLS decides).
 * The bucket is created on first use if it does not exist.
 */
// Storage error wording varies by version: "Duplicate", "BucketAlreadyExists", "already_exists", "The specified bucket already exists."
const BUCKET_EXISTS = /already.?exists|duplicate/i;
// ... and "Bucket not found", "NoSuchBucket", "The specified bucket does not exist."
const NO_BUCKET = /bucket not found|nosuchbucket|bucket does not exist/i;
class SupabaseStorage implements StorageAdapter {
  readonly name = "supabase" as const;
  private base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  private key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  readonly bucket = process.env.SUPABASE_STORAGE_BUCKET || "item-photos";
  private bucketReady = false;
  static configured() {
    return !!((process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  private headers(extra: Record<string, string> = {}) {
    if (!this.base || !this.key) throw new Error("Supabase Storage not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }
  private objectPath(fileId: string) {
    return fileId.split("/").map(encodeURIComponent).join("/");
  }
  private async ensureBucket() {
    if (this.bucketReady) return;
    const res = await fetch(`${this.base}/storage/v1/bucket`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }),
    });
    // 200 = created; "already exists" comes back as 400 or 409 depending on the Supabase version
    if (!res.ok && !BUCKET_EXISTS.test(await res.text())) throw new Error(`Supabase Storage: could not create bucket "${this.bucket}" (${res.status})`);
    this.bucketReady = true;
  }
  async put(folderKey: string, fileName: string, bytes: Buffer, mime: string) {
    const folder = folderKey.replace(/[^A-Za-z0-9_-]/g, "_");
    const fileId = `${folder}/${randomUUID()}-${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const upload = () =>
      fetch(`${this.base}/storage/v1/object/${this.bucket}/${this.objectPath(fileId)}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": mime, "x-upsert": "true", "cache-control": "max-age=31536000" }),
        body: new Uint8Array(bytes),
      });
    let res = await upload();
    if (!res.ok) {
      const text = await res.text();
      if (!NO_BUCKET.test(text)) throw new Error(`Supabase Storage ${res.status}: ${text.slice(0, 300)}`);
      await this.ensureBucket();
      res = await upload();
      if (!res.ok) throw new Error(`Supabase Storage ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    this.bucketReady = true;
    return { fileId, folderId: folder };
  }
  async get(fileId: string) {
    const res = await fetch(`${this.base}/storage/v1/object/${this.bucket}/${this.objectPath(fileId)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Supabase Storage ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/jpeg" };
  }
  async listFolder(folderId: string) {
    const res = await fetch(`${this.base}/storage/v1/object/list/${this.bucket}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix: `${folderId}/`, limit: 200, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { name: string; metadata?: { mimetype?: string } }[];
    return rows.filter((r) => r.name && !r.name.startsWith("thumb-")).map((r) => ({ id: `${folderId}/${r.name}`, name: r.name, mime: r.metadata?.mimetype ?? "image/jpeg" }));
  }
}

/**
 * Which store new photos go to. Uploads used to fail on Vercel because the default was the local disk, which is read-only
 * there (EROFS). Rules: an explicit STORAGE_PROVIDER wins when it can work; on a serverless host the local disk can never
 * work, and Drive without its credentials cannot either — both fall back to Supabase Storage when Supabase is configured.
 */
export function resolveStorageProvider(e: Record<string, string | undefined> = process.env): { provider: "local" | "drive" | "supabase"; note: string | null } {
  const wanted = (e.STORAGE_PROVIDER ?? "").trim().toLowerCase();
  const serverless = !!(e.VERCEL || e.AWS_LAMBDA_FUNCTION_NAME || e.NETLIFY);
  const supabase = !!((e.NEXT_PUBLIC_SUPABASE_URL || e.SUPABASE_URL) && e.SUPABASE_SERVICE_ROLE_KEY);
  const drive = !!(e.GOOGLE_SERVICE_ACCOUNT_JSON_B64 && e.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  if (wanted === "supabase") return { provider: "supabase", note: null };
  if (wanted === "drive") {
    if (drive || !supabase) return { provider: "drive", note: null };
    return { provider: "supabase", note: "STORAGE_PROVIDER=drive but Google Drive credentials are not set; using Supabase Storage" };
  }
  if (wanted === "local" || wanted === "") {
    if (!serverless) return { provider: "local", note: null };
    if (supabase) return { provider: "supabase", note: wanted ? "STORAGE_PROVIDER=local cannot work on a serverless host (read-only disk); using Supabase Storage" : null };
    return { provider: "local", note: "No writable photo store: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or Google Drive) for uploads" };
  }
  return { provider: supabase ? "supabase" : "local", note: `Unknown STORAGE_PROVIDER "${wanted}"` };
}

let cached: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  if (!cached) {
    const { provider, note } = resolveStorageProvider();
    if (note) console.warn(`[storage] ${note}`);
    cached = storageFor(provider);
  }
  return cached;
}
/** Reads always go to the store a photo was written to (photos.provider), whatever new uploads use. */
export function storageFor(provider: string): StorageAdapter {
  if (provider === "drive") return new GoogleDriveStorage();
  if (provider === "supabase") return new SupabaseStorage();
  return new LocalDiskStorage();
}

import "server-only";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../env";

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
    await mkdir(dir, { recursive: true });
    const id = `${safe}/${randomUUID()}-${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    await writeFile(join(this.root, id), bytes);
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

let cached: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  if (!cached) cached = env.storageProvider === "drive" ? new GoogleDriveStorage() : new LocalDiskStorage();
  return cached;
}
export function storageFor(provider: string): StorageAdapter {
  if (provider === "drive") return new GoogleDriveStorage();
  return new LocalDiskStorage();
}

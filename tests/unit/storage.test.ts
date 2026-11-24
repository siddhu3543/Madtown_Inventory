/**
 * Photo uploads (2026-11-24): on Vercel the old default (local disk) is read-only, so every upload failed.
 * The resolver must never pick the local disk on a serverless host when Supabase is configured, and the Supabase
 * Storage adapter must talk the Storage API correctly (checked against a local mock of it).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveStorageProvider, storageFor } from "@/lib/adapters/storage";

const SB = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

describe("which photo store is used", () => {
  it("local machine: local disk, as before", () => {
    expect(resolveStorageProvider({}).provider).toBe("local");
    expect(resolveStorageProvider({ STORAGE_PROVIDER: "local", ...SB }).provider).toBe("local");
  });
  it("Vercel with Supabase: Supabase Storage, even when STORAGE_PROVIDER=local was left set", () => {
    expect(resolveStorageProvider({ VERCEL: "1", ...SB })).toEqual({ provider: "supabase", note: null });
    const r = resolveStorageProvider({ VERCEL: "1", STORAGE_PROVIDER: "local", ...SB });
    expect(r.provider).toBe("supabase");
    expect(r.note).toMatch(/read-only/);
  });
  it("Drive selected but not configured falls back to Supabase; configured Drive is kept", () => {
    expect(resolveStorageProvider({ VERCEL: "1", STORAGE_PROVIDER: "drive", ...SB }).provider).toBe("supabase");
    expect(resolveStorageProvider({ STORAGE_PROVIDER: "drive", GOOGLE_SERVICE_ACCOUNT_JSON_B64: "e30=", GOOGLE_DRIVE_ROOT_FOLDER_ID: "f", ...SB }).provider).toBe("drive");
  });
  it("Vercel without any writable store says what to configure", () => {
    expect(resolveStorageProvider({ VERCEL: "1" }).note).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("Supabase Storage adapter (against a mock Storage API)", () => {
  let server: Server;
  const buckets = new Set<string>();
  const objects = new Map<string, { body: Buffer; type: string }>();
  let alt = false; // answer with the other error wording Supabase uses
  const seen: { method: string; url: string; auth?: string; apikey?: string }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, apikey: req.headers.apikey as string });
        const json = (status: number, o: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(o));
        if (req.headers.apikey !== "service-key" || req.headers.authorization !== "Bearer service-key") return json(401, { message: "Invalid API key" });
        if (req.method === "POST" && req.url === "/storage/v1/bucket") {
          const { id } = JSON.parse(body.toString());
          if (buckets.has(id))
            return alt
              ? json(409, { statusCode: "409", code: "BucketAlreadyExists", error: "BucketAlreadyExists", message: "The specified bucket already exists." })
              : json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
          buckets.add(id);
          return json(200, { name: id });
        }
        const m = req.url!.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
        if (m && req.method === "POST") {
          if (!buckets.has(m[1]))
            return alt
              ? json(404, { statusCode: "404", code: "NoSuchBucket", error: "NoSuchBucket", message: "The specified bucket does not exist." })
              : json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
          objects.set(`${m[1]}/${decodeURIComponent(m[2])}`, { body, type: req.headers["content-type"]! });
          return json(200, { Key: `${m[1]}/${m[2]}` });
        }
        if (m && req.method === "GET") {
          const o = objects.get(`${m[1]}/${decodeURIComponent(m[2])}`);
          if (!o) return json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
          return res.writeHead(200, { "Content-Type": o.type }).end(o.body);
        }
        json(404, { message: "no route" });
      });
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });
  afterAll(() => {
    server.close();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("creates the private bucket on first upload, stores the photo, and reads it back", async () => {
    const a = storageFor("supabase");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const f = await a.put("MTMH_101", "check-out-abc.jpg", bytes, "image/jpeg");
    expect(f.folderId).toBe("MTMH_101");
    expect(f.fileId).toMatch(/^MTMH_101\/[0-9a-f-]{36}-check-out-abc\.jpg$/);
    expect(buckets.has("item-photos")).toBe(true);
    const back = await a.get(f.fileId);
    expect(back.mime).toBe("image/jpeg");
    expect(Buffer.compare(back.bytes, bytes)).toBe(0);
    // first attempt hit "Bucket not found", then the bucket was created, then the retry succeeded
    expect(seen.map((s) => `${s.method} ${s.url.split("/").slice(0, 5).join("/")}`)).toEqual([
      "POST /storage/v1/object/item-photos",
      "POST /storage/v1/bucket",
      "POST /storage/v1/object/item-photos",
      "GET /storage/v1/object/item-photos",
    ]);
  });
  it("a second adapter instance tolerates the bucket already existing", async () => {
    const f = await storageFor("supabase").put("order-1", "invoice.pdf", Buffer.from("%PDF"), "application/pdf");
    expect(objects.get(`item-photos/${f.fileId}`)?.type).toBe("application/pdf");
  });
  it("newer Storage wording (NoSuchBucket / BucketAlreadyExists) is understood too", async () => {
    alt = true;
    buckets.clear();
    const f = await storageFor("supabase").put("MTMH_102", "a.jpg", Buffer.from("y"), "image/jpeg");
    expect(objects.has(`item-photos/${f.fileId}`)).toBe(true);
    alt = false;
  });
  it("a wrong key surfaces the Storage error text (shown to the person uploading)", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "wrong";
    await expect(storageFor("supabase").put("MTMH_101", "x.jpg", Buffer.from("x"), "image/jpeg")).rejects.toThrow(/Supabase Storage 401: .*Invalid API key/);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });
});

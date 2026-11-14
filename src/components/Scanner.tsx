"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Keyboard, Search, VideoOff } from "lucide-react";

type Idx = { id: string; name: string; model_number: string | null; type: string; status: string; holder_label: string | null }[];

/** Parse a scanned value: our QR URLs (/i/MTMH_101, /k/KIT_001) or a bare ID. */
export function parseScan(text: string): { kind: "item" | "kit"; id: string } | null {
  const t = text.trim();
  const m = t.match(/\/(i|k)\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/);
  if (m) return { kind: m[1] === "k" ? "kit" : "item", id: decodeURIComponent(m[2]).toUpperCase() };
  if (/^MTMH_\d{3,}(-\d{2,})?$/i.test(t)) return { kind: "item", id: t.toUpperCase() };
  if (/^KIT_\d{3,}$/i.test(t)) return { kind: "kit", id: t.toUpperCase() };
  return null;
}

/** SCR-03 / FR-QR-002: camera view; FR-QR-006 manual fallback; NFR-013 works from cached index offline. */
export function Scanner({ walkthroughId }: { walkthroughId?: string } = {}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState<Idx>([]);
  const [active, setActive] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    fetch("/api/items/index")
      .then((r) => r.json())
      .then((j) => setIdx(j.items ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    let stop = () => {};
    (async () => {
      try {
        const go = (text: string) => {
          const p = parseScan(text);
          if (!p || done.current) return;
          done.current = true;
          if (navigator.vibrate) navigator.vibrate(60);
          router.push(walkthroughId ? `/walkthrough/${walkthroughId}?item=${p.id}#scan` : p.kind === "kit" ? `/kits/${p.id}?scanned=1` : `/items/${p.id}?scanned=1`);
        };
        const BD = (window as unknown as { BarcodeDetector?: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (BD) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          video.current!.srcObject = stream;
          await video.current!.play();
          const det = new BD({ formats: ["qr_code"] });
          let raf = 0;
          const loop = async () => {
            try {
              const r = await det.detect(video.current!);
              if (r[0]) go(r[0].rawValue);
            } catch {}
            raf = requestAnimationFrame(loop);
          };
          loop();
          stop = () => {
            cancelAnimationFrame(raf);
            stream.getTracks().forEach((t) => t.stop());
          };
        } else {
          const { BrowserQRCodeReader } = await import("@zxing/browser");
          const reader = new BrowserQRCodeReader();
          const ctl = await reader.decodeFromVideoDevice(undefined, video.current!, (res) => {
            if (res) go(res.getText());
          });
          stop = () => ctl.stop();
        }
      } catch (e) {
        setErr("Camera unavailable: " + ((e as Error).message || "permission denied") + ". Type the ID below instead.");
        setActive(false);
      }
    })();
    return () => stop();
  }, [active, router, walkthroughId]);

  const ql = q.trim().toLowerCase();
  const matches = ql
    ? idx
        .filter((i) => i.id.toLowerCase().includes(ql.replace(/^(\d{3})$/, "mtmh_$1")) || i.name.toLowerCase().includes(ql) || (i.model_number ?? "").toLowerCase().includes(ql))
        .slice(0, 20)
    : [];
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = parseScan(q) ?? (/^\d{3,}$/.test(q.trim()) ? { kind: "item" as const, id: `MTMH_${q.trim()}` } : null);
    const dest = (id: string, kit = false) => (walkthroughId ? `/walkthrough/${walkthroughId}?item=${id}#scan` : kit ? `/kits/${id}` : `/items/${id}`);
    if (p) router.push(dest(p.id, p.kind === "kit"));
    else if (matches[0]) router.push(dest(matches[0].id));
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="card relative overflow-hidden">
        {active ? (
          <div className="relative">
            <video ref={video} className="aspect-square w-full bg-black object-cover" muted playsInline data-testid="scanner-video" />
            {/* viewfinder frame */}
            <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgb(0_0_0/0.35)]" aria-hidden />
            <p className="absolute inset-x-0 bottom-3 text-center text-sm font-medium text-white drop-shadow">Align the QR code inside the frame</p>
          </div>
        ) : (
          <button
            className="flex w-full flex-col items-center justify-center gap-3 bg-[var(--color-brand)] px-6 py-12 text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--color-brand-hover)]"
            onClick={() => {
              setErr(null);
              done.current = false;
              setActive(true);
            }}
            data-testid="start-camera"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15">
              <Camera size={32} aria-hidden />
            </span>
            <span className="text-xl font-semibold">Start camera</span>
            <span className="text-sm opacity-80">Scan an item or kit QR label</span>
          </button>
        )}
      </div>
      {active && (
        <button className="btn btn-secondary" onClick={() => setActive(false)}>
          <VideoOff size={16} aria-hidden /> Stop camera
        </button>
      )}
      {err && (
        <p role="alert" className="alert alert-bad font-medium">
          <AlertCircle size={18} aria-hidden /> <span className="min-w-0">{err}</span>
        </p>
      )}
      <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
        <label className="field">
          <span className="flex items-center gap-2">
            <Keyboard size={16} aria-hidden /> Label worn or missing? Type the ID or name
          </span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 104, MTMH_104 or FX3" data-testid="manual-id" autoComplete="off" />
        </label>
        <button className="btn btn-primary">
          <Search size={16} aria-hidden /> Open
        </button>
        {matches.length > 0 && (
          <ul className="flex flex-col divide-y divide-[var(--color-line)] rounded-lg border border-[var(--color-line)]" data-testid="manual-matches">
            {matches.map((m) => (
              <li key={m.id} className="px-3 py-2.5">
                <a href={walkthroughId ? `/walkthrough/${walkthroughId}?item=${m.id}#scan` : `/items/${m.id}`} className="font-semibold">
                  {m.id} · {m.name}
                </a>{" "}
                <span className="muted block text-sm">
                  {m.status}
                  {m.holder_label ? ` · ${m.holder_label}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}

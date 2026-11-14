"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/** FR-CAT-010 / FR-QR-006: search as you type by ID, name, model, type, holder, status, condition. */
export function LiveSearch({ placeholder = "Search ID, name, model, holder…", autoFocus }: { placeholder?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (t.current) clearTimeout(t.current);
    },
    [],
  );
  function change(v: string) {
    setQ(v);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => {
      const p = new URLSearchParams(sp.toString());
      if (v) p.set("q", v);
      else p.delete("q");
      p.delete("page");
      router.replace(`?${p.toString()}`);
    }, 250);
  }
  return (
    <div className="relative">
      <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-muted)]" />
      <input
        className="input !pl-10 !pr-10"
        type="search"
        name="q"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="Search items"
        data-testid="item-search"
        onChange={(e) => change(e.target.value)}
      />
      {q && (
        <button type="button" className="btn btn-ghost btn-sm absolute top-1/2 right-1 -translate-y-1/2 !min-h-8 !w-8 !p-0" aria-label="Clear search" onClick={() => change("")}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}

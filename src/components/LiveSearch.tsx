"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
      router.replace(`?${p.toString()}`);
    }, 250);
  }
  return (
    <input
      className="input text-lg"
      type="search"
      name="q"
      value={q}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label="Search items"
      data-testid="item-search"
      onChange={(e) => change(e.target.value)}
    />
  );
}

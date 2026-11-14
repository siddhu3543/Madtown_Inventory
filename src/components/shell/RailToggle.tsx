"use client";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";

/** Collapses the desktop sidebar to an icon rail (remembered per browser via data-rail on <html>). */
export function RailToggle() {
  const [rail, setRail] = useState(false);
  useEffect(() => setRail(document.documentElement.dataset.rail === "1"), []);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm w-full justify-start"
      aria-pressed={rail}
      title={rail ? "Expand sidebar" : "Collapse sidebar"}
      onClick={() => {
        const next = !rail;
        setRail(next);
        if (next) document.documentElement.dataset.rail = "1";
        else delete document.documentElement.dataset.rail;
        try {
          if (next) localStorage.setItem("mt-rail", "1");
          else localStorage.removeItem("mt-rail");
        } catch {
          /* ignore */
        }
      }}
    >
      {rail ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
      <span className="rail-hide">Collapse</span>
    </button>
  );
}

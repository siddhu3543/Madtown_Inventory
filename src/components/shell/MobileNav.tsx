"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Menu, X } from "lucide-react";
import { SidebarNav, type NavGroup } from "./SidebarNav";

/** Mobile navigation drawer built on the native <dialog> (focus trap, Esc to close, backdrop). */
export function MobileNav({ groups, brand }: { groups: NavGroup[]; brand: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  useEffect(() => {
    ref.current?.close();
  }, [path]);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-icon lg:hidden" aria-label="Menu" data-testid="menu-button" onClick={() => ref.current?.showModal()}>
        <Menu size={22} aria-hidden />
      </button>
      <dialog
        ref={ref}
        className="drawer"
        aria-label="Navigation menu"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          {brand}
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close navigation" onClick={() => ref.current?.close()}>
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav groups={groups} onNavigate={() => ref.current?.close()} />
        </div>
      </dialog>
    </>
  );
}

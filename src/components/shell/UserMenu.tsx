"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { Avatar } from "@/components/ui";

type Theme = "light" | "dark" | "system";

function applyTheme(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === "system") localStorage.removeItem("mt-theme");
    else localStorage.setItem("mt-theme", t);
  } catch {
    /* ignore */
  }
}

/** Profile dropdown: identity, role, theme and sign-out. */
export function UserMenu({ name, email, role, developer }: { name: string; email: string; role: string; developer: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const t = localStorage.getItem("mt-theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const themes: [Theme, string, typeof Sun][] = [
    ["light", "Light", Sun],
    ["dark", "Dark", Moon],
    ["system", "System", Monitor],
  ];
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className="flex min-h-10 items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)]"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="user-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={name} />
        <span className="hidden text-sm font-semibold sm:inline">{name.split(" ")[0]}</span>
        <ChevronDown size={14} aria-hidden className="hidden text-[var(--color-muted)] sm:block" />
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 p-1.5 shadow-[var(--shadow-pop)]">
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={name} size={40} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name}</p>
              <p className="muted truncate text-sm">{email}</p>
            </div>
          </div>
          <p className="mx-2.5 mb-2 flex items-center gap-2 text-sm">
            <span className="muted">Role</span>
            <b data-testid="user-role" className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[var(--color-brand)]">
              {role}
            </b>
            {developer && <span className="muted">· developer</span>}
          </p>
          <div className="border-t border-[var(--color-line)] px-2.5 py-2.5">
            <p className="muted mb-1.5 text-xs font-semibold uppercase tracking-wider">Theme</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--color-wash)] p-1" role="group" aria-label="Theme">
              {themes.map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={theme === k}
                  onClick={() => {
                    setTheme(k);
                    applyTheme(k);
                  }}
                  className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium ${theme === k ? "bg-[var(--color-paper)] text-[var(--color-ink)] shadow-[var(--shadow-xs)]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"}`}
                >
                  <Icon size={14} aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>
          <form action="/api/auth/logout" method="post" className="border-t border-[var(--color-line)] pt-1.5">
            <button className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium hover:bg-[var(--color-wash)]">
              <LogOut size={16} aria-hidden /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

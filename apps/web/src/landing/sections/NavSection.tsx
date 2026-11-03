import type { JSX } from "react";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { label: "How it works", href: "#how"    },
  { label: "Agents",       href: "#agents" },
  { label: "Try it",       href: "#try"    },
  { label: "Trust",        href: "#trust"  },
] as const;

function KnotLogo(): JSX.Element {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {/* Simplified knot mark: two interlocking arcs */}
      <circle cx="16" cy="16" r="15" fill="#0f766e" opacity="0.15" />
      <path
        d="M10 20 C10 12, 22 12, 22 16 C22 20, 10 20, 10 24 C10 28, 22 28, 22 20"
        stroke="#14b8a6"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M22 12 C22 20, 10 20, 10 16 C10 12, 22 12, 22 8 C22 4, 10 4, 10 12"
        stroke="#0f766e"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

interface NavProps {
  onOpenDesk: () => void;
}

export function NavSection({ onOpenDesk }: NavProps): JSX.Element {
  const [open, setOpen] = useState(false);

  function scrollTo(href: string): void {
    setOpen(false);
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <header className="ln-nav" role="banner">
      <div className="ln-container">
        <nav
          className="flex items-center justify-between h-16"
          aria-label="Main navigation"
        >
          {/* Logo */}
          <a
            href="#"
            className="flex items-center gap-2.5 text-white font-semibold text-lg tracking-tight no-underline"
            aria-label="Untangle — go to top"
            onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          >
            <KnotLogo />
            <span>Untangle</span>
          </a>

          {/* Desktop links */}
          <ul className="hidden md:flex items-center gap-1 list-none m-0 p-0" role="list">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <button
                  onClick={() => scrollTo(link.href)}
                  className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white rounded-lg hover:bg-white/8 transition-colors cursor-pointer bg-transparent border-0 outline-offset-2 focus-visible:outline-2 focus-visible:outline-teal-400"
                >
                  {link.label}
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={onOpenDesk}
              className="ln-btn-primary text-sm py-2.5 px-5"
            >
              Live demo
            </button>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg text-slate-300 hover:text-white hover:bg-white/8 transition-colors bg-transparent border-0 cursor-pointer outline-offset-2 focus-visible:outline-2 focus-visible:outline-teal-400"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </nav>

        {/* Mobile menu */}
        {open && (
          <div
            id="mobile-nav"
            className="md:hidden border-t border-white/8 py-4 flex flex-col gap-1"
            role="menu"
          >
            {NAV_LINKS.map((link) => (
              <button
                key={link.href}
                role="menuitem"
                onClick={() => scrollTo(link.href)}
                className="text-left px-4 py-3 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/8 rounded-lg transition-colors bg-transparent border-0 cursor-pointer w-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-teal-400"
              >
                {link.label}
              </button>
            ))}
            <div className="mt-2 px-4">
              <button
                onClick={() => { setOpen(false); onOpenDesk(); }}
                className="ln-btn-primary w-full justify-center text-sm"
              >
                Live demo
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

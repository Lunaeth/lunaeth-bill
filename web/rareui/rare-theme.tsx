import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { ThemeSelector, type ThemeOption } from "./components/ui/theme-selector";
import { cn } from "./lib/utils";

export type RareThemeMode = "light" | "dark";
export type RareThemePreference = "system" | RareThemeMode;

function getSystemTheme(): RareThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyRareTheme(mode: RareThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
}

export function useRareTheme(storageKey: string, _defaultMode?: RareThemeMode) {
  const key = `${storageKey}-v2`;
  const [preference, setPreferenceState] = useState<RareThemePreference>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === "light" || saved === "dark" || saved === "system") return saved;
    } catch {
      // ignore storage errors
    }
    return "system";
  });

  const [systemTheme, setSystemTheme] = useState<RareThemeMode>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    setSystemTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: RareThemeMode = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    applyRareTheme(resolved);
  }, [resolved]);

  const setPreference = (next: RareThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === "system") {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, next);
      }
    } catch {
      // ignore storage errors
    }
  };

  return [resolved, setPreference, preference] as const;
}

export interface RareThemePopoverProps {
  value: RareThemeMode;
  preference?: RareThemePreference;
  onChange: (pref: RareThemePreference) => void;
  themes: ThemeOption[];
  align?: "left" | "right";
  direction?: "down" | "up";
  label?: string;
  className?: string;
}

export function RareThemePopover({
  value,
  preference = "system",
  onChange,
  themes,
  align = "right",
  direction = "down",
  label = "主题",
  className,
}: RareThemePopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number }>({
    left: 12,
    top: 60,
    width: 268,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const updatePosition = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 12;
      const width = Math.min(268, Math.max(220, vw - margin * 2));
      const preferredLeft = align === "right" ? rect.right - width : rect.left;
      const left = Math.max(margin, Math.min(preferredLeft, vw - width - margin));
      const openUp = direction === "up" || (direction === "down" && vh - rect.bottom < 190 && rect.top > 190);
      if (openUp) {
        setPos({ left, bottom: Math.max(margin, vh - rect.top + 8), width });
      } else {
        setPos({ left, top: Math.min(vh - margin, rect.bottom + 8), width });
      }
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, align, direction]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const buttonText = preference === "system" ? "自动" : value === "dark" ? "深色" : "浅色";

  return (
    <div ref={wrapRef} data-rare-root="" className={cn("relative inline-flex", className)}>
      <motion.button
        type="button"
        whileTap={reduced ? undefined : { scale: 0.96 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={preference === "system" ? "跟随设备深浅色（点击切换）" : label}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--rare-border,#dfe2d7)] bg-[var(--rare-surface,#ffffff)] px-2.5 text-xs font-medium text-[var(--rare-fg,#242d28)] shadow-2xs transition-colors hover:bg-[var(--rare-surface-2,#eeeee7)]"
      >
        {value === "dark" ? (
          <Moon className="size-3.5 text-[var(--rare-accent,#214e3d)]" />
        ) : (
          <Sun className="size-3.5 text-[var(--rare-accent,#214e3d)]" />
        )}
        <span>{buttonText}</span>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: pos.bottom !== undefined ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, y: pos.bottom !== undefined ? 4 : -4, scale: 0.97 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 32 }}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
            }}
            className="z-[95] rounded-2xl border border-[var(--rare-border,#dfe2d7)] bg-[var(--rare-surface,#ffffff)] p-3.5 shadow-[0_16px_42px_rgba(0,0,0,0.18)]"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2 text-xs font-medium text-[var(--rare-muted,#626c60)]">
              <span>外观主题</span>
              <button
                type="button"
                onClick={() => {
                  onChange("system");
                  setOpen(false);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                  preference === "system"
                    ? "border-[var(--rare-accent,#214e3d)] bg-[var(--rare-accent-soft,rgba(33,78,61,0.12))] text-[var(--rare-accent,#214e3d)]"
                    : "border-[var(--rare-border,#dfe2d7)] text-[var(--rare-muted,#626c60)] hover:text-[var(--rare-fg,#242d28)]",
                )}
              >
                <Monitor className="size-3" />
                <span>跟随设备</span>
              </button>
            </div>
            <ThemeSelector
              themes={themes}
              value={value}
              onChange={(next) => {
                if (next === "light" || next === "dark") {
                  onChange(next);
                  setOpen(false);
                }
              }}
              className="gap-3"
              itemClassName="flex-1 min-w-0"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

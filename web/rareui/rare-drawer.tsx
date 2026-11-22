import React, { useMemo, useRef, type ReactNode } from "react";
import { Drawer } from "vaul";
import useMeasure from "react-use-measure";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "./lib/utils";

export interface RareDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  viewKey?: string;
  trigger?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RareDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  viewKey = "default",
  trigger,
  children,
  className,
}: RareDrawerProps) {
  const [measureRef, bounds] = useMeasure();
  const previousHeightRef = useRef<number | null>(null);
  const reduced = useReducedMotion();

  const opacityDuration = useMemo(() => {
    const currentHeight = bounds.height;
    const prevHeight = previousHeightRef.current;
    previousHeightRef.current = currentHeight;
    if (!prevHeight) return 0.22;
    const diff = Math.abs(currentHeight - prevHeight);
    return Math.min(Math.max(diff / 500, 0.16), 0.28);
  }, [bounds.height]);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Drawer.Trigger asChild>{trigger}</Drawer.Trigger> : null}
      <Drawer.Portal>
        <Drawer.Overlay
          data-rare-root=""
          className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-[2px]"
        />
        <Drawer.Content
          data-rare-root=""
          className={cn(
            "fixed inset-x-3 bottom-3 z-[95] mx-auto max-w-[480px] overflow-hidden rounded-[24px] border border-[var(--rare-border,#dfe2d7)] bg-[var(--rare-surface,#ffffff)] text-[var(--rare-fg,#18181b)] shadow-[0_20px_60px_rgba(0,0,0,0.28)] outline-none",
            className,
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[var(--rare-border,#dfe2d7)]" />
          <motion.div
            animate={
              reduced || !bounds.height
                ? undefined
                : {
                    height: bounds.height,
                    transition: {
                      duration: 0.27,
                      ease: [0.25, 1, 0.5, 1],
                    },
                  }
            }
          >
            <div ref={measureRef} className="max-h-[82dvh] overflow-y-auto px-5 pb-6 pt-3">
              {title ? (
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--rare-border,#dfe2d7)] pb-3">
                  <div className="min-w-0">
                    <Drawer.Title className="m-0 text-base font-semibold leading-snug text-[var(--rare-fg,#18181b)]">
                      {title}
                    </Drawer.Title>
                    {subtitle ? (
                      <Drawer.Description className="mt-1 text-xs leading-relaxed text-[var(--rare-muted,#626c60)]">
                        {subtitle}
                      </Drawer.Description>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    aria-label="关闭"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-[var(--rare-surface-2,#eeeee7)] p-0 text-[var(--rare-muted,#626c60)] transition-colors hover:text-[var(--rare-fg,#18181b)]"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : null}
              <AnimatePresence initial={false} mode="popLayout" custom={viewKey}>
                <motion.div
                  key={viewKey}
                  initial={reduced ? false : { opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduced ? undefined : { opacity: 0, scale: 0.97 }}
                  transition={{
                    duration: reduced ? 0 : opacityDuration,
                    ease: [0.26, 0.08, 0.25, 1],
                  }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

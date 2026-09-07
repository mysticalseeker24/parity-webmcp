import { useEffect, useRef, useState } from "react";
import { RisoMark } from "./RisoMotif";

/**
 * The press pulling a sheet before the page appears.
 *
 * A splash screen is an accessibility liability if built carelessly, so this
 * one is deliberately constrained:
 *
 *  - it never gates the real content — the app is mounted and registered
 *    underneath from the first frame, so tools are live before this clears;
 *  - `prefers-reduced-motion` skips it entirely rather than merely shortening
 *    it, because the whole thing *is* motion;
 *  - any key press or click dismisses it immediately, so nobody is held behind
 *    a decoration;
 *  - it is `aria-hidden` and does not take focus. A screen-reader user is
 *    already on the real page and never learns this existed.
 */

const DURATION_MS = 1400;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LoadingScreen() {
  // Reduced motion: never show it at all, not even for one frame.
  const [visible, setVisible] = useState(() => !prefersReducedMotion());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;

    const dismiss = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setVisible(false);
    };

    timer.current = setTimeout(dismiss, DURATION_MS);
    window.addEventListener("keydown", dismiss, { once: true });
    window.addEventListener("pointerdown", dismiss, { once: true });

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="loading-screen"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-stock"
      style={{ animation: "riso-pull 300ms ease-out both" }}
    >
      <RisoMark className="w-40" />
      <p className="mt-6 font-display text-sm uppercase tracking-[0.35em] text-ink-soft">
        one registry, two callers
      </p>
      {/* Two ink passes laying down, in sequence. Decorative only. */}
      <div className="mt-8 flex gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-1.5 w-10"
            style={{
              backgroundColor: i === 1 ? "var(--color-spot)" : "var(--color-ink)",
              animation: `riso-pull 400ms ease-out ${i * 140}ms both`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

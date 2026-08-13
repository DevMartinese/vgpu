"use client";

import { useEffect, useRef, useState } from "react";

const ciLines = [
  { label: "$ pnpm test:render", tone: "command" },
  { label: "compile eve.wgsl", tone: "step" },
  { label: "render headless frame", tone: "step" },
  { label: "compare snapshot", tone: "step" },
  { label: "1 test passed · 842ms", tone: "success" },
] as const;

const STEP_DELAY_MS = 650;
const COMPLETE_DELAY_MS = 1800;

export function CiRunOutput() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleCount(ciLines.length);
      return;
    }

    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { threshold: 0.35 }
    );
    observer.observe(root);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;

    const complete = visibleCount === ciLines.length;
    const timeout = window.setTimeout(
      () =>
        setVisibleCount((current) =>
          current === ciLines.length ? 1 : current + 1
        ),
      complete ? COMPLETE_DELAY_MS : STEP_DELAY_MS
    );

    return () => window.clearTimeout(timeout);
  }, [active, visibleCount]);

  return (
    <div
      className="flex aspect-video items-center bg-background-100 px-4 font-mono text-[9px] leading-[1.65] sm:text-[10px]"
      ref={rootRef}
    >
      <p className="sr-only">
        CI runs the render test, compiles the shader, renders a headless frame,
        compares the snapshot, and passes.
      </p>
      <div aria-hidden="true" className="w-full space-y-0.5">
        {ciLines.map((line, index) => {
          const visible = index < visibleCount;
          const success = line.tone === "success";

          return (
            <p
              className={`truncate transition-opacity duration-300 ${
                visible ? "opacity-100" : "opacity-0"
              } ${
                success
                  ? "text-green-800 dark:text-[#00ca52]"
                  : line.tone === "command"
                  ? "text-gray-1000"
                  : "text-gray-900"
              }`}
              key={line.label}
            >
              {line.tone === "step" ? "✓ " : null}
              {success ? "● " : null}
              {line.label}
            </p>
          );
        })}
      </div>
    </div>
  );
}

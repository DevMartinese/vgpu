"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRenderer,
  defaultHeroSettings,
  type HeroRenderer,
} from "./renderer";

/** Full-bleed vGPU homepage shader, without the docs-only tuning controls. */
export function HeroBlackHole() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderer: HeroRenderer | undefined;

    async function initialize() {
      try {
        const adapter = await navigator.gpu?.requestAdapter();
        const canvas = canvasRef.current;
        if (cancelled || !adapter || !canvas) return;

        const settings = defaultHeroSettings();
        // The tuned bloom looks right at DPR 2. Scale both its radius and its
        // contribution down in lower-density displays: DPR 1 uses half the
        // radius and strength, DPR 2+ keeps the presentation's original values.
        // Fractional DPRs interpolate between those endpoints.
        const displayDpr = Math.min(Math.max(window.devicePixelRatio, 1), 2);
        const bloomScale = displayDpr / 2;
        settings.bloom.radius *= bloomScale;
        settings.bloom.strength *= bloomScale;

        renderer = createRenderer({
          canvas,
          settings,
          onError: (error) => {
            console.warn("[demo-day-vgpu] black-hole renderer failed:", error);
            if (!cancelled) setIsReady(false);
          },
        });

        await renderer.ready;
        if (!cancelled) setIsReady(true);
      } catch (error) {
        console.warn("[demo-day-vgpu] WebGPU is unavailable:", error);
        if (!cancelled) setIsReady(false);
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      renderer?.dispose();
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-black"
    >
      <canvas
        ref={canvasRef}
        data-black-hole-canvas
        className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${
          isReady ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

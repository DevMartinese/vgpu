"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRenderer, type PrismRenderer } from "./renderer";
import type { PrismDebugSource, PrismPipelineMode } from "./pipelines/types";
import { DEFAULT_PRISM_CONTROLS, type PrismControls } from "./types";
import type { PrismControlsUpdater } from "./debug/graph/control-context";

const PrismDebugGraph = lazy(() =>
  import("./debug/graph").then(({ PrismDebugGraph: Component }) => ({
    default: Component,
  }))
);

const HERO_BACKGROUND_PROPERTY = "--home-hero-background";
const CSS_HEX_COLOR = /^#[\da-f]{6}$/i;

function heroBackgroundColor(canvas: HTMLCanvasElement): string {
  const hero = canvas.closest<HTMLElement>("[data-hero-theme]");
  if (!hero) return DEFAULT_PRISM_CONTROLS.wallColor;
  const value = getComputedStyle(hero)
    .getPropertyValue(HERO_BACKGROUND_PROPERTY)
    .trim();
  return CSS_HEX_COLOR.test(value) ? value : DEFAULT_PRISM_CONTROLS.wallColor;
}

function currentPrismMode(): PrismPipelineMode {
  return document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
}

export function PrismBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PrismRenderer | null>(null);
  const controlsRef = useRef<PrismControls>(DEFAULT_PRISM_CONTROLS);
  const controlsFrameRef = useRef(0);
  const [showDebug, setShowDebug] = useState(false);
  const [debugSources, setDebugSources] = useState<
    readonly PrismDebugSource[] | undefined
  >();
  const [debugControls, setDebugControls] = useState<PrismControls>(
    DEFAULT_PRISM_CONTROLS
  );
  const [debugBaselineControls, setDebugBaselineControls] =
    useState<PrismControls>(DEFAULT_PRISM_CONTROLS);
  const [debugMode, setDebugMode] = useState<PrismPipelineMode>("dark");
  const reportError = useCallback((error: unknown) => {
    console.error("Prism background failed to render.", error);
  }, []);

  const updateControls = useCallback((updater: PrismControlsUpdater) => {
    const controls = updater(controlsRef.current);
    controlsRef.current = controls;
    setDebugControls(controls);
    if (controlsFrameRef.current) return;
    controlsFrameRef.current = requestAnimationFrame(() => {
      controlsFrameRef.current = 0;
      rendererRef.current?.setControls?.(controlsRef.current);
    });
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const debugPreviews = new URLSearchParams(window.location.search).has(
      "debug"
    );
    setShowDebug(debugPreviews);
    const initialMode = currentPrismMode();
    setDebugMode(initialMode);
    const hero = canvas.closest<HTMLElement>("[data-hero-theme]");
    const framingElement = hero?.querySelector<HTMLElement>(
      "[data-triangle-container]"
    );
    const initialControls = {
      ...DEFAULT_PRISM_CONTROLS,
      wallColor: heroBackgroundColor(canvas),
    };
    controlsRef.current = initialControls;
    setDebugControls(initialControls);
    setDebugBaselineControls(initialControls);
    const renderer = createRenderer({
      canvas,
      framingElement: framingElement ?? undefined,
      initialMode,
      initialControls,
      debugPreviews,
      onError: reportError,
    });
    rendererRef.current = renderer;
    const syncDebugSources = () => {
      if (debugPreviews && rendererRef.current === renderer)
        setDebugSources(renderer.debugSources());
    };
    const syncTheme = () => {
      const mode = currentPrismMode();
      const wallColor = heroBackgroundColor(canvas);
      setDebugBaselineControls((current) =>
        current.wallColor === wallColor
          ? current
          : { ...DEFAULT_PRISM_CONTROLS, wallColor }
      );
      if (wallColor !== controlsRef.current.wallColor) {
        const nextControls = { ...controlsRef.current, wallColor };
        controlsRef.current = nextControls;
        setDebugControls(nextControls);
        renderer.setControls?.(nextControls);
      }
      void renderer.setMode(mode).then(
        () => {
          if (rendererRef.current !== renderer) return;
          setDebugMode(mode);
          syncDebugSources();
        },
        () => {
          // The renderer reports mode preparation failures through onError.
        }
      );
    };
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    void renderer.ready.then(syncDebugSources, () => {
      // onError reports initialization failures without replacing the hero.
    });
    return () => {
      themeObserver.disconnect();
      if (controlsFrameRef.current)
        cancelAnimationFrame(controlsFrameRef.current);
      controlsFrameRef.current = 0;
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [reportError]);

  return (
    <div data-prism-background className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="block h-full w-full touch-none"
      />
      {showDebug ? (
        <Suspense fallback={null}>
          <PrismDebugGraph
            baselineControls={debugBaselineControls}
            bridge={rendererRef.current?.debugBridge}
            controls={debugControls}
            mode={debugMode}
            onControlsChange={updateControls}
            sources={debugSources}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

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
import { preloadLightAssets } from "./assets/light/preload";
import { preloadPrismPipeline } from "./pipeline-controller";

const PrismDebugGraph = lazy(() =>
  import("./debug/graph").then(({ PrismDebugGraph: Component }) => ({
    default: Component,
  }))
);

const PRISM_PERFORMANCE_QUERY = "prism-perf";
const PRISM_WALL_COLOR: Record<PrismPipelineMode, string> = {
  dark: "#000000",
  light: "#d2ccc2",
};

function currentPrismMode(): PrismPipelineMode {
  return document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
}

interface PrismBackgroundProps {
  readonly enabled: boolean;
}

export function PrismBackground({ enabled }: PrismBackgroundProps) {
  if (!enabled) return null;
  return <PrismCanvas />;
}

function PrismCanvas() {
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
    const performanceSampling = new URLSearchParams(window.location.search).has(
      PRISM_PERFORMANCE_QUERY
    );
    setShowDebug(debugPreviews);
    const initialMode = currentPrismMode();
    if (initialMode === "light") preloadLightAssets();
    preloadPrismPipeline(initialMode);
    setDebugMode(initialMode);
    const hero = canvas.closest<HTMLElement>("[data-hero-theme]");
    const framingElement = hero?.querySelector<HTMLElement>(
      "[data-triangle-container]"
    );
    const initialControls = {
      ...DEFAULT_PRISM_CONTROLS,
      wallColor: PRISM_WALL_COLOR[initialMode],
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
      performanceSampling,
      onError: reportError,
    });
    rendererRef.current = renderer;
    let removePerformanceApi: (() => void) | undefined;
    if (performanceSampling) {
      void import("./performance/browser-api").then(
        ({ installPrismPerformanceBrowserApi }) => {
          if (rendererRef.current !== renderer) return;
          removePerformanceApi = installPrismPerformanceBrowserApi(renderer);
        },
        reportError
      );
    }
    const syncDebugSources = () => {
      if (debugPreviews && rendererRef.current === renderer)
        setDebugSources(renderer.debugSources());
    };
    const syncTheme = () => {
      const mode = currentPrismMode();
      if (mode === "light") preloadLightAssets();
      preloadPrismPipeline(mode);
      const wallColor = PRISM_WALL_COLOR[mode];
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
      removePerformanceApi?.();
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

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
import type { EnvironmentDebugRenderer } from "./environment-debug";
import type { PrismDebugSource, PrismPipelineMode } from "./pipelines/types";
import { DEFAULT_PRISM_CONTROLS, type PrismControls } from "./types";

const Controls = lazy(() =>
  import("./controls").then(({ Controls: Component }) => ({
    default: Component,
  }))
);

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

function environmentDebugState(
  controls: PrismControls,
  mode: PrismPipelineMode
) {
  return {
    visible: controls.environmentDebug,
    exposure: controls.glass.reflection[mode].environmentExposure,
  };
}

export function PrismBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PrismRenderer | null>(null);
  const controlsRef = useRef<PrismControls>(DEFAULT_PRISM_CONTROLS);
  const [showDebug, setShowDebug] = useState(false);
  const [debugSources, setDebugSources] = useState<
    readonly PrismDebugSource[] | undefined
  >();
  const [guiInitialControls, setGuiInitialControls] = useState<PrismControls>(
    DEFAULT_PRISM_CONTROLS
  );
  const [environmentDebug, setEnvironmentDebug] = useState(() =>
    environmentDebugState(DEFAULT_PRISM_CONTROLS, "dark")
  );
  const reportError = useCallback((error: unknown) => {
    console.error("Prism background failed to render.", error);
  }, []);

  const setControls = useCallback((controls: PrismControls) => {
    controlsRef.current = controls;
    const nextDebug = environmentDebugState(controls, currentPrismMode());
    setEnvironmentDebug((current) =>
      current.visible === nextDebug.visible &&
      current.exposure === nextDebug.exposure
        ? current
        : nextDebug
    );
    rendererRef.current?.setControls?.(controls);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const debugPreviews = new URLSearchParams(window.location.search).has(
      "debug"
    );
    setShowDebug(debugPreviews);
    const hero = canvas.closest<HTMLElement>("[data-hero-theme]");
    const framingElement = hero?.querySelector<HTMLElement>(
      "[data-triangle-container]"
    );
    const initialControls = {
      ...DEFAULT_PRISM_CONTROLS,
      wallColor: heroBackgroundColor(canvas),
    };
    controlsRef.current = initialControls;
    setGuiInitialControls(initialControls);
    setEnvironmentDebug(
      environmentDebugState(initialControls, currentPrismMode())
    );
    const renderer = createRenderer({
      canvas,
      framingElement: framingElement ?? undefined,
      initialMode: currentPrismMode(),
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
      if (wallColor !== controlsRef.current.wallColor) {
        const nextControls = { ...controlsRef.current, wallColor };
        controlsRef.current = nextControls;
        setGuiInitialControls(nextControls);
        renderer.setControls?.(nextControls);
      }
      setEnvironmentDebug(environmentDebugState(controlsRef.current, mode));
      void renderer.setMode(mode).then(syncDebugSources, () => {
        // The renderer reports mode preparation failures through onError.
      });
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
          <Controls initialValue={guiInitialControls} onChange={setControls} />
          <PrismDebugGraph
            bridge={rendererRef.current?.debugBridge}
            sources={debugSources}
          />
        </Suspense>
      ) : null}
      {environmentDebug.visible ? (
        <EnvironmentDebugCanvas
          environmentExposure={environmentDebug.exposure}
          onError={reportError}
        />
      ) : null}
    </div>
  );
}

interface EnvironmentDebugCanvasProps {
  readonly environmentExposure: number;
  onError(error: unknown): void;
}

function EnvironmentDebugCanvas({
  environmentExposure,
  onError,
}: EnvironmentDebugCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<EnvironmentDebugRenderer | undefined>(undefined);
  const onErrorRef = useRef(onError);
  const exposureRef = useRef(environmentExposure);
  onErrorRef.current = onError;
  exposureRef.current = environmentExposure;

  useEffect(() => {
    rendererRef.current?.setEnvironmentExposure(environmentExposure);
  }, [environmentExposure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let renderer: EnvironmentDebugRenderer | undefined;

    void import("./environment-debug").then(
      ({ createEnvironmentDebugRenderer }) => {
        if (disposed) return;
        try {
          renderer = createEnvironmentDebugRenderer({
            canvas,
            initialEnvironmentExposure: exposureRef.current,
            onError: (error) => onErrorRef.current(error),
          });
          rendererRef.current = renderer;
        } catch (error) {
          onErrorRef.current(error);
          return;
        }
        void renderer.ready.catch(() => {
          // The renderer reports initialization failures through onError.
        });
      },
      (error: unknown) => {
        if (!disposed) onErrorRef.current(error);
      }
    );

    return () => {
      disposed = true;
      renderer?.dispose();
      if (rendererRef.current === renderer) rendererRef.current = undefined;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Environment reflection debug"
      className="absolute bottom-3 right-3 z-[3] block size-48 cursor-grab touch-none rounded-sm border border-white/20 bg-black active:cursor-grabbing sm:size-56"
    />
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  createHeroFractalRenderer,
  type HeroFractalCamera,
  type HeroFractalMaterial,
} from "./hero-fractal-renderer";

// ── Hero fractal camera ─────────────────────────────────────────────────────
// Edit these values to compose the light-mode hero. Changes update via HMR.
const HERO_FRACTAL_CAMERA = {
  cameraRotation: [0, 1.40, 0],
  cameraDistance: [0, 0, 4],
  cameraTarget: [0, 0.18, 0],
  fov: 40,
} satisfies HeroFractalCamera;

// ── Hero fractal material ───────────────────────────────────────────────────
// These are also the initial values shown by lil-gui at /?debug.
const HERO_FRACTAL_MATERIAL = {
  baseColor: [0.82, 0.78, 0.70],
  roughness: 0.58,
  diffuseStrength: 1,
  specularStrength: 0.65,
  ambientStrength: 0.26,
  lightIntensity: 4.8,
} satisfies HeroFractalMaterial;

/** Decorative light-mode hero visual with an isolated renderer and shader. */
export function HeroFractal() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);
  const heroSettingsJson = JSON.stringify({
    camera: HERO_FRACTAL_CAMERA,
    material: HERO_FRACTAL_MATERIAL,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const renderer = createHeroFractalRenderer({
      canvas,
      camera: HERO_FRACTAL_CAMERA,
      material: HERO_FRACTAL_MATERIAL,
      onError: (error) => {
        console.warn("[vgpu-hero] fractal renderer failed:", error);
        if (!cancelled) setIsReady(false);
      },
    });

    void renderer.ready.then(() => {
      if (!cancelled) setIsReady(true);
    }).catch(() => {
      // onError above owns reporting; a plain background is the fallback.
    });

    return () => {
      cancelled = true;
      renderer.dispose();
    };
  // TEMP: keep the serialized settings dependency while tuning the hero. It
  // forces Fast Refresh to dispose and recreate the GPU renderer whenever any
  // HERO_FRACTAL_CAMERA or HERO_FRACTAL_MATERIAL value changes. Remove it once
  // the hero is finalized.
  }, [heroSettingsJson]);

  return (
    <div
      data-hero-native-light
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-white"
    >
      <canvas
        ref={canvasRef}
        data-hero-fractal-canvas
        className={`block h-full w-full transition-opacity duration-500 ${
          isReady ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

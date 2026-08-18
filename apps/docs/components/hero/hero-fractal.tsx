"use client";

import { useEffect, useRef, useState } from "react";
import {
  createHeroFractalRenderer,
  type HeroFractalCamera,
  type HeroFractalGlass,
  type HeroFractalMaterial,
} from "./hero-fractal-renderer";

// ── Hero fractal camera ─────────────────────────────────────────────────────
// Edit these values to compose the light-mode hero. Changes update via HMR.
const HERO_FRACTAL_CAMERA = {
  cameraRotation: [0, 0, 0],
  cameraDistance: [5.44, 1.33, 0.55],
  cameraTarget: [-0.08, 0.16, 0.74],
  fov: 17.3,
  maxMouseRotation: 5,
  mouseLerp: 0.02,
} satisfies HeroFractalCamera;

// ── Hero fractal material ───────────────────────────────────────────────────
// These are also the initial values shown by lil-gui at /?debug.
const HERO_FRACTAL_MATERIAL = {
  baseColor: [1, 1, 1],
  roughness: 0.72,
  diffuseStrength: 0.72,
  specularStrength: 0.68,
  ambientStrength: 0.86,
} satisfies HeroFractalMaterial;

// ── Hero glass shell ────────────────────────────────────────────────────────
const HERO_FRACTAL_GLASS = {
  fractalScale: 0.59,
  ior: 1.149,
  reflectionStrength: 0.36,
  backOpacity: 0.19,
  absorption: [74 / 255, 74 / 255, 74 / 255],
  frostRadius: 1.8,
  dispersion: 0.025,
  iridescenceStrength: 0.04,
  iridescenceFrequency: 2,
  environmentRotation: [0, -36, 0],
  environmentExposure: 1.58,
} satisfies HeroFractalGlass;

/** Decorative light-mode hero visual with an isolated renderer and shader. */
export function HeroFractal() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);
  const heroSettingsJson = JSON.stringify({
    camera: HERO_FRACTAL_CAMERA,
    material: HERO_FRACTAL_MATERIAL,
    glass: HERO_FRACTAL_GLASS,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const renderer = createHeroFractalRenderer({
      canvas,
      camera: HERO_FRACTAL_CAMERA,
      material: HERO_FRACTAL_MATERIAL,
      glass: HERO_FRACTAL_GLASS,
      onError: (error) => {
        console.warn("[vgpu-hero] fractal renderer failed:", error);
        if (!cancelled) setIsReady(false);
      },
    });

    void renderer.ready
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch(() => {
        // onError above owns reporting; a plain background is the fallback.
      });

    return () => {
      cancelled = true;
      renderer.dispose();
    };
    // TEMP: keep the serialized settings dependency while tuning the hero. It
    // forces Fast Refresh to dispose and recreate the GPU renderer whenever any
    // hero tuning value changes. Remove it once the hero is finalized.
  }, [heroSettingsJson]);

  return (
    <div
      data-hero-native-light
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#fafafa]"
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

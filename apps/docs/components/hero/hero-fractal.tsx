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
  cameraDistance: [6.73, 1.33, 0.76],
  cameraTarget: [-1.07, 0, 0.57],
  fov: 19.4,
  maxMouseRotation: 2.5,
  mouseLerp: 0.08,
} satisfies HeroFractalCamera;

// ── Hero fractal material ───────────────────────────────────────────────────
// These are also the initial values shown by lil-gui at /?debug.
const HERO_FRACTAL_MATERIAL = {
  baseColor: [8 / 255, 8 / 255, 8 / 255],
  roughness: 0.58,
  diffuseStrength: 1,
  specularStrength: 0.65,
  ambientStrength: 0.26,
  lightIntensity: 6.49,
} satisfies HeroFractalMaterial;

// ── Hero glass shell ────────────────────────────────────────────────────────
const HERO_FRACTAL_GLASS = {
  // Keeps the previous 1:1.08 inner/outer proportion while the glass itself
  // remains fixed at its authored scale.
  fractalScale: 1 / 1.08,
  ior: 1.183,
  maxRayDistance: 1.35,
  reflectionStrength: 0.57,
  backOpacity: 0.63,
  absorption: [20 / 255, 140 / 255, 215 / 255],
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

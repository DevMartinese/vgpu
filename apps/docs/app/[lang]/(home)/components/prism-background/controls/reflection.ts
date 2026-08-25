import type GUI from "lil-gui";
import type { Controller } from "lil-gui";

import {
  PRISM_GLASS_RANGES,
  type GlassReflectionByTheme,
  type GlassReflectionControls,
  type PrismTheme,
} from "../types";

export type ReflectionGuiValuesByTheme = Record<
  PrismTheme,
  GlassReflectionControls
>;

export function reflectionGuiValues(
  reflection: GlassReflectionByTheme
): ReflectionGuiValuesByTheme {
  return {
    dark: { ...reflection.dark },
    light: { ...reflection.light },
  };
}

/** Adds visible per-theme reflection controls matching the runtime schema. */
export function addReflectionFolders(
  glassFolder: GUI,
  values: ReflectionGuiValuesByTheme,
  publish: () => void
): Controller[] {
  const parent = glassFolder.addFolder("Reflection");
  return (["dark", "light"] as const).flatMap((mode) => {
    const folder = parent.addFolder(mode === "dark" ? "Dark" : "Light");
    const reflection = values[mode];
    return [
      folder
        .add(
          reflection,
          "reflectionStrength",
          PRISM_GLASS_RANGES.reflectionStrength.min,
          PRISM_GLASS_RANGES.reflectionStrength.max,
          PRISM_GLASS_RANGES.reflectionStrength.step
        )
        .name("strength")
        .onChange(publish),
      folder
        .add(
          reflection,
          "environmentExposure",
          PRISM_GLASS_RANGES.environmentExposure.min,
          PRISM_GLASS_RANGES.environmentExposure.max,
          PRISM_GLASS_RANGES.environmentExposure.step
        )
        .name("env exposure")
        .onChange(publish),
    ];
  });
}

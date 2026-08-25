import type GUI from "lil-gui";
import type { Controller } from "lil-gui";

import {
  PRISM_GLASS_RANGES,
  type GlassTransmissionByTheme,
  type GlassTransmissionControls,
  type PrismTheme,
} from "../types";

export const TRANSMISSION_GUI_MODES = [
  "dark",
  "light",
] as const satisfies readonly PrismTheme[];

export const TRANSMISSION_GUI_LABELS: Readonly<Record<PrismTheme, string>> = {
  dark: "Dark",
  light: "Light",
};

export interface TransmissionGuiValues {
  ior: number;
  absorptionR: number;
  absorptionG: number;
  absorptionB: number;
}

export type TransmissionGuiValuesByTheme = Record<
  PrismTheme,
  TransmissionGuiValues
>;

export function transmissionGuiValues(
  transmission: GlassTransmissionByTheme
): TransmissionGuiValuesByTheme {
  const fromMaterial = (
    material: GlassTransmissionControls
  ): TransmissionGuiValues => ({
    ior: material.ior,
    absorptionR: material.absorption[0],
    absorptionG: material.absorption[1],
    absorptionB: material.absorption[2],
  });
  return {
    dark: fromMaterial(transmission.dark),
    light: fromMaterial(transmission.light),
  };
}

export function transmissionFromGui(
  values: TransmissionGuiValues
): GlassTransmissionControls {
  return {
    ior: values.ior,
    absorption: [values.absorptionR, values.absorptionG, values.absorptionB],
  };
}

/** Adds theme-specific material controls without duplicating their schema. */
export function addTransmissionFolders(
  glassFolder: GUI,
  values: TransmissionGuiValuesByTheme,
  publish: () => void
): Controller[] {
  const parent = glassFolder.addFolder("Transmission");
  return TRANSMISSION_GUI_MODES.flatMap((mode) => {
    const folder = parent.addFolder(TRANSMISSION_GUI_LABELS[mode]);
    const material = values[mode];
    return [
      folder
        .add(
          material,
          "ior",
          PRISM_GLASS_RANGES.ior.min,
          PRISM_GLASS_RANGES.ior.max,
          PRISM_GLASS_RANGES.ior.step
        )
        .name("surface IOR")
        .onChange(publish),
      folder
        .add(
          material,
          "absorptionR",
          PRISM_GLASS_RANGES.absorption.min,
          PRISM_GLASS_RANGES.absorption.max,
          PRISM_GLASS_RANGES.absorption.step
        )
        .name("absorption R")
        .onChange(publish),
      folder
        .add(
          material,
          "absorptionG",
          PRISM_GLASS_RANGES.absorption.min,
          PRISM_GLASS_RANGES.absorption.max,
          PRISM_GLASS_RANGES.absorption.step
        )
        .name("absorption G")
        .onChange(publish),
      folder
        .add(
          material,
          "absorptionB",
          PRISM_GLASS_RANGES.absorption.min,
          PRISM_GLASS_RANGES.absorption.max,
          PRISM_GLASS_RANGES.absorption.step
        )
        .name("absorption B")
        .onChange(publish),
    ];
  });
}

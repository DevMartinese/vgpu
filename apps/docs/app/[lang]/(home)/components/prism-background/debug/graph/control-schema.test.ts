import { describe, expect, test } from "vitest";

import {
  DEFAULT_PRISM_CONTROLS,
  PRISM_DISPERSION_PRESETS,
  type PrismControls,
  type PrismTheme,
} from "../../types";
import { clampDebugRangeValue, controlGroupsForSource } from "./control-schema";
import type {
  DebugControl,
  DebugRangeControl,
  DebugSelectControl,
} from "./control-types";

const COMMON_CONTROL_NODES = [
  "scene-controls",
  "beam-controls",
  "spectral-controls",
  "light-appearance",
  "wall-material",
  "glass-transmission",
  "environment-reflection",
];

describe("React Flow prism controls", () => {
  test("splits shared, theme material, and dark-only bloom controls", () => {
    const light = controlIds(COMMON_CONTROL_NODES, "light");
    const dark = controlIds(
      [
        ...COMMON_CONTROL_NODES.slice(0, 4),
        "dark-wall",
        ...COMMON_CONTROL_NODES.slice(5),
        "dark-bloom-composite",
      ],
      "dark"
    );

    expect(light).toHaveLength(18);
    expect(dark).toHaveLength(21);
    expect(light).not.toContain("bloom-strength");
    expect(dark).toEqual(
      expect.arrayContaining([
        "bloom-threshold",
        "bloom-radius",
        "bloom-strength",
      ])
    );
    expect([...light, ...dark]).not.toEqual(
      expect.arrayContaining([
        "view",
        "wireframe",
        "light-wireframe",
        "environment-debug",
      ])
    );
  });

  test("shows custom coefficients honestly and restores complete presets", () => {
    const preset = selectControl("spectral-controls", "dispersion-preset");
    const base = rangeControl("spectral-controls", "dispersion-base");
    const strength = rangeControl("spectral-controls", "dispersion-strength");
    expect(preset.read(DEFAULT_PRISM_CONTROLS, "dark")).toBe("custom");

    const flint: PrismControls = {
      ...DEFAULT_PRISM_CONTROLS,
      dispersion: "flint",
      spectralDispersion: undefined,
    };
    expect(preset.read(flint, "dark")).toBe("flint");
    expect(base.read(flint, "dark")).toBe(PRISM_DISPERSION_PRESETS.flint.base);
    expect(strength.read(flint, "dark")).toBe(
      PRISM_DISPERSION_PRESETS.flint.strength
    );

    const crown = preset.write(flint, "dark", "crown");
    expect(crown.spectralDispersion).toEqual(PRISM_DISPERSION_PRESETS.crown);
    const custom = base.write(crown, "dark", 1.7);
    expect(preset.read(custom, "dark")).toBe("custom");
  });

  test("edits only the active glass theme without mutating defaults", () => {
    const before = structuredClone(DEFAULT_PRISM_CONTROLS);
    const ior = rangeControl("glass-transmission", "glass-ior");
    const absorption = rangeControl("glass-transmission", "absorption-b");
    const reflection = rangeControl(
      "environment-reflection",
      "reflection-strength"
    );

    let next = ior.write(DEFAULT_PRISM_CONTROLS, "light", 1.81);
    next = absorption.write(next, "light", 0.25);
    next = reflection.write(next, "light", 1.2);

    expect(next.glass.transmission.light).toEqual({
      ior: 1.81,
      absorption: [0, 0, 0.25],
    });
    expect(next.glass.reflection.light.reflectionStrength).toBe(1.2);
    expect(next.glass.transmission.dark).toEqual(
      DEFAULT_PRISM_CONTROLS.glass.transmission.dark
    );
    expect(next.glass.reflection.dark).toEqual(
      DEFAULT_PRISM_CONTROLS.glass.reflection.dark
    );
    expect(DEFAULT_PRISM_CONTROLS).toEqual(before);
  });

  test("clamps manually entered numbers to the former GUI ranges", () => {
    const reflection = rangeControl(
      "environment-reflection",
      "reflection-strength"
    );
    expect(clampDebugRangeValue(reflection, 999)).toBe(reflection.max);
    expect(clampDebugRangeValue(reflection, -999)).toBe(reflection.min);
  });

  test("functional patches preserve the latest theme-derived wall color", () => {
    const width = rangeControl("beam-controls", "beam-width");
    const opacity = rangeControl("light-appearance", "beam-opacity");
    let current: PrismControls = {
      ...DEFAULT_PRISM_CONTROLS,
      wallColor: "#d2ccc2",
    };
    const update = (updater: (value: PrismControls) => PrismControls) => {
      current = updater(current);
    };
    update((value) => width.write(value, "light", 0.08));
    update((value) => opacity.write(value, "light", 0.6));
    expect(current.wallColor).toBe("#d2ccc2");
    expect(current.beamWidth).toBe(0.08);
    expect(current.lightFade.beamOpacity).toBe(0.6);
  });
});

function controlIds(nodes: readonly string[], mode: PrismTheme): string[] {
  return nodes.flatMap((node) =>
    controlGroupsForSource(node, mode).flatMap((group) =>
      group.controls.map(({ id }) => id)
    )
  );
}

function findControl(sourceId: string, id: string): DebugControl {
  const result = controlGroupsForSource(sourceId, "dark")
    .flatMap(({ controls }) => controls)
    .find((control) => control.id === id);
  if (!result) throw new Error(`Missing ${sourceId}.${id}`);
  return result;
}

function rangeControl(sourceId: string, id: string): DebugRangeControl {
  const result = findControl(sourceId, id);
  if (result.kind !== "range") throw new Error(`${id} is not a range`);
  return result;
}

function selectControl(sourceId: string, id: string): DebugSelectControl {
  const result = findControl(sourceId, id);
  if (result.kind !== "select") throw new Error(`${id} is not a select`);
  return result;
}

import {
  DEFAULT_PRISM_CONTROLS,
  PRISM_BEAM_MOUSE_Y_RANGES,
  PRISM_DISPERSION_PRESETS,
  PRISM_LIGHT_FADE_RANGES,
  PRISM_SPECTRAL_DISPERSION_RANGES,
  clampBeamWidth,
  clampCameraFov,
  type GlassControls,
  type GlassReflectionControls,
  type GlassTransmissionControls,
  type PrismControls,
  type PrismTheme,
} from "../types";

const finite = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

type LegacyGlassControls = Omit<
  Partial<GlassControls>,
  "transmission" | "reflection"
> & {
  readonly transmission?: Partial<
    Record<PrismTheme, Partial<GlassTransmissionControls>>
  >;
  readonly reflection?: Partial<
    Record<PrismTheme, Partial<GlassReflectionControls>>
  >;
  readonly ior?: number;
  readonly absorption?: readonly [number, number, number];
  readonly reflectionStrength?: number;
  readonly environmentExposure?: number;
};

function normalizeTransmission(
  glass: LegacyGlassControls,
  mode: PrismTheme,
  defaults: GlassTransmissionControls
): GlassTransmissionControls {
  const input = glass.transmission?.[mode];
  // Pre-split Fast Refresh state described one dark material. Migrate those
  // fields into dark only; light deliberately keeps its clear-glass defaults.
  const legacyIor = mode === "dark" ? glass.ior : undefined;
  const legacyAbsorption = mode === "dark" ? glass.absorption : undefined;
  const absorption =
    input?.absorption ?? legacyAbsorption ?? defaults.absorption;
  return {
    ior: finite(input?.ior ?? legacyIor, defaults.ior),
    absorption: [
      finite(absorption[0], defaults.absorption[0]),
      finite(absorption[1], defaults.absorption[1]),
      finite(absorption[2], defaults.absorption[2]),
    ],
  };
}

function normalizeReflection(
  glass: LegacyGlassControls,
  mode: PrismTheme,
  defaults: GlassReflectionControls
): GlassReflectionControls {
  const input = glass.reflection?.[mode];
  // The former shared fields describe the established dark look. Light keeps
  // its new full-strength environment defaults during Fast Refresh migration.
  const legacyStrength = mode === "dark" ? glass.reflectionStrength : undefined;
  const legacyExposure =
    mode === "dark" ? glass.environmentExposure : undefined;
  return {
    reflectionStrength: finite(
      input?.reflectionStrength ?? legacyStrength,
      defaults.reflectionStrength
    ),
    environmentExposure: finite(
      input?.environmentExposure ?? legacyExposure,
      defaults.environmentExposure
    ),
  };
}

/** Normalizes GUI/Fast Refresh input into the complete runtime schema. */
export function normalizeControls(controls: PrismControls): PrismControls {
  const defaults = DEFAULT_PRISM_CONTROLS;
  const inputGlass = (controls.glass ?? defaults.glass) as LegacyGlassControls;
  const inputPostprocess = controls.postprocess ?? defaults.postprocess;
  const inputLightFade = controls.lightFade ?? defaults.lightFade;
  const inputBeamMouseY = controls.beamMouseY ?? defaults.beamMouseY;
  const legacyLightFade = inputLightFade as typeof inputLightFade & {
    rainbowFalloff?: number;
  };
  const inputDispersion =
    controls.spectralDispersion ??
    PRISM_DISPERSION_PRESETS[controls.dispersion ?? defaults.dispersion];

  return {
    ...controls,
    cameraFov: clampCameraFov(controls.cameraFov ?? defaults.cameraFov),
    beamWidth: clampBeamWidth(controls.beamWidth ?? defaults.beamWidth),
    beamMouseY: {
      top: clamp(
        finite(inputBeamMouseY.top, defaults.beamMouseY.top),
        PRISM_BEAM_MOUSE_Y_RANGES.top.min,
        PRISM_BEAM_MOUSE_Y_RANGES.top.max
      ),
      bottom: clamp(
        finite(inputBeamMouseY.bottom, defaults.beamMouseY.bottom),
        PRISM_BEAM_MOUSE_Y_RANGES.bottom.min,
        PRISM_BEAM_MOUSE_Y_RANGES.bottom.max
      ),
    },
    spectralDispersion: {
      base: clamp(
        finite(
          inputDispersion.base,
          PRISM_DISPERSION_PRESETS[defaults.dispersion].base
        ),
        PRISM_SPECTRAL_DISPERSION_RANGES.base.min,
        PRISM_SPECTRAL_DISPERSION_RANGES.base.max
      ),
      strength: clamp(
        finite(
          inputDispersion.strength,
          PRISM_DISPERSION_PRESETS[defaults.dispersion].strength
        ),
        PRISM_SPECTRAL_DISPERSION_RANGES.strength.min,
        PRISM_SPECTRAL_DISPERSION_RANGES.strength.max
      ),
    },
    lightFade: {
      beamOpacity: clamp(
        finite(inputLightFade.beamOpacity, defaults.lightFade.beamOpacity),
        PRISM_LIGHT_FADE_RANGES.beamOpacity.min,
        PRISM_LIGHT_FADE_RANGES.beamOpacity.max
      ),
      edgeFalloff: clamp(
        finite(inputLightFade.edgeFalloff, defaults.lightFade.edgeFalloff),
        PRISM_LIGHT_FADE_RANGES.edgeFalloff.min,
        PRISM_LIGHT_FADE_RANGES.edgeFalloff.max
      ),
      rainbowFalloffRate: clamp(
        finite(
          inputLightFade.rainbowFalloffRate ?? legacyLightFade.rainbowFalloff,
          defaults.lightFade.rainbowFalloffRate
        ),
        PRISM_LIGHT_FADE_RANGES.rainbowFalloffRate.min,
        PRISM_LIGHT_FADE_RANGES.rainbowFalloffRate.max
      ),
      rainbowFalloffPower: clamp(
        finite(
          inputLightFade.rainbowFalloffPower,
          defaults.lightFade.rainbowFalloffPower
        ),
        PRISM_LIGHT_FADE_RANGES.rainbowFalloffPower.min,
        PRISM_LIGHT_FADE_RANGES.rainbowFalloffPower.max
      ),
    },
    wireframe: controls.wireframe ?? defaults.wireframe,
    lightWireframe: controls.lightWireframe ?? defaults.lightWireframe,
    environmentDebug: controls.environmentDebug ?? defaults.environmentDebug,
    glass: {
      transmission: {
        dark: normalizeTransmission(
          inputGlass,
          "dark",
          defaults.glass.transmission.dark
        ),
        light: normalizeTransmission(
          inputGlass,
          "light",
          defaults.glass.transmission.light
        ),
      },
      reflection: {
        dark: normalizeReflection(
          inputGlass,
          "dark",
          defaults.glass.reflection.dark
        ),
        light: normalizeReflection(
          inputGlass,
          "light",
          defaults.glass.reflection.light
        ),
      },
    },
    postprocess: {
      bloomStrength: finite(
        inputPostprocess.bloomStrength,
        defaults.postprocess.bloomStrength
      ),
      bloomThreshold: finite(
        inputPostprocess.bloomThreshold,
        defaults.postprocess.bloomThreshold
      ),
      bloomRadius: finite(
        inputPostprocess.bloomRadius,
        defaults.postprocess.bloomRadius
      ),
    },
  };
}

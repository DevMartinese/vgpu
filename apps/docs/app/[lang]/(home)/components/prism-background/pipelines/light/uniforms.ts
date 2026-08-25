import { LIGHT_PIPELINE_TUNING } from "../../materials/light/tuning";
import { runtimeWallExtent } from "../../runtime/uniforms";
import type { PrismRuntime } from "../../runtime/types";
import { PRISM_CENTROID, PRISM_SIDE } from "../../types";

export function lightWallUniforms(
  runtime: PrismRuntime
): Record<string, unknown> {
  const tuning = LIGHT_PIPELINE_TUNING.wall;
  const wallColor = runtime.controls.wallColor.match(
    /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i
  );
  return {
    viewProjection: runtime.view.viewProjection,
    wallHalfExtent: runtimeWallExtent(runtime),
    wallColor: wallColor
      ? wallColor.slice(1).map((channel) => Number.parseInt(channel, 16) / 255)
      : [0.87, 0.87, 0.87],
    prismCenter: PRISM_CENTROID,
    // A more grazing upper-left key makes the plaster normals readable while
    // the baked HDR blobs remain responsible for the white illumination peaks.
    lightDirection: [-0.48, 0.56, 0.68],
    materialWorldScale: PRISM_SIDE * tuning.materialScale,
    normalStrength: tuning.normalStrength,
    microNormalFrequency: tuning.microNormalFrequency,
    microNormalStrength: tuning.microNormalStrength,
    ambient: tuning.ambient,
    ambientLightStrength: tuning.ambientLightStrength,
    // The broad cast shadow is a geometry draw. Preserve only the separately
    // baked contact/AO channel in the wall material composition.
    prismShadowStrength: 0,
    prismAoStrength: tuning.prismAoStrength,
    groundingScale: PRISM_SIDE * tuning.groundingScale,
  };
}

export function lightCausticUniforms(
  _runtime: PrismRuntime
): Record<string, unknown> {
  const tuning = LIGHT_PIPELINE_TUNING.caustic;
  return {
    strength: tuning.strength,
    coverage: tuning.coverage,
    farDesaturation: tuning.farDesaturation,
    farBrightness: tuning.farBrightness,
    // Light-mesh travel is already normalized from the prism to the wall edge.
    travelScale: tuning.travelScale,
    falloffRateScale: tuning.falloffRateScale,
    falloffPowerScale: tuning.falloffPowerScale,
  };
}

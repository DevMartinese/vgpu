import {
  HERO_FLOOR_BAKE_EXTENT,
  HERO_FLOOR_Y,
  heroFloorContactDistance,
  heroSoftShadow,
} from "./hero-fractal-sdf.wgsl";
import {
  HERO_KEY_LIGHT_POSITION,
  HERO_KEY_LIGHT_RADIUS,
} from "./hero-fractal-light.wgsl";

// Orthographic floor-space light bake. R stores soft visibility and G stores
// an intentionally fake contact AO that remains stable across camera changes.
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let floorPoint = vec2f(
    (uv.x * 2.0 - 1.0) * HERO_FLOOR_BAKE_EXTENT,
    (uv.y * 2.0 - 1.0) * HERO_FLOOR_BAKE_EXTENT,
  );
  let origin = vec3f(floorPoint.x, HERO_FLOOR_Y + 0.004, floorPoint.y);
  let toLight = HERO_KEY_LIGHT_POSITION - origin;
  let lightDistance = length(toLight);
  let shadow = heroSoftShadow(
    origin,
    toLight / lightDistance,
    lightDistance,
    HERO_KEY_LIGHT_RADIUS,
  );

  let contactDistance = heroFloorContactDistance(floorPoint);
  let contact = exp(-contactDistance * 11.0);
  let ao = 1.0 - contact * 0.20;
  return vec4f(shadow, ao, 0.0, 1.0);
}

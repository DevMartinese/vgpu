import {
  HERO_FLOOR_BAKE_EXTENT,
  HERO_FLOOR_Y,
} from "./hero-fractal-sdf.wgsl";
import { presentCeramic } from "./hero-fractal-ceramic.wgsl";

struct Params {
  resolution: vec2f,
  tanHalfFov: f32,
  cameraPosition: vec3f,
  cameraTarget: vec3f,
  cameraUp: vec3f,
  floorGrid: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var floorBakeTexture: texture_2d<f32>;
@group(0) @binding(2) var floorSampler: sampler;

fn cameraOrigin() -> vec3f {
  return params.cameraPosition;
}

fn cameraRay(uv: vec2f) -> vec3f {
  let ro = cameraOrigin();
  let forward = normalize(params.cameraTarget - ro);
  let right = normalize(cross(forward, params.cameraUp));
  let up = normalize(cross(right, forward));
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  var screen = uv * 2.0 - 1.0;
  screen.y = -screen.y;
  let localRay = normalize(vec3f(
    screen.x * aspect * params.tanHalfFov,
    screen.y * params.tanHalfFov,
    -1.0,
  ));
  return normalize(mat3x3f(right, up, -forward) * localRay);
}

fn floorLighting(point: vec3f) -> vec2f {
  let uv = point.xz / (2.0 * HERO_FLOOR_BAKE_EXTENT) + vec2f(0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
    return vec2f(1.0);
  }
  return textureSampleLevel(floorBakeTexture, floorSampler, uv, 0.0).rg;
}

fn gridLine(coordinate: vec2f, spacing: f32, pixelFootprint: f32) -> f32 {
  let gridCoordinate = coordinate / spacing;
  let distanceToLine = abs(fract(gridCoordinate - 0.5) - 0.5);
  let distance = min(distanceToLine.x, distanceToLine.y);
  let width = clamp(pixelFootprint / spacing, 0.0005, 0.45);
  return 1.0 - smoothstep(width * 0.35, width, distance);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ro = cameraOrigin();
  let rd = cameraRay(uv);
  let backdrop = vec3f(3.10, 3.04, 2.92);
  if (rd.y < -0.0001) {
    let floorT = (HERO_FLOOR_Y - ro.y) / rd.y;
    if (floorT > 0.0) {
      let floorPoint = ro + rd * floorT;
      let baked = floorLighting(floorPoint);
      let shadowTone = mix(0.16, 1.0, smoothstep(0.0, 1.0, baked.x));
      var floorColor = backdrop * shadowTone * baked.y;
      if (params.floorGrid > 0.5) {
        let pixelFootprint = max(
          floorT * params.tanHalfFov * 3.2 / max(params.resolution.y, 1.0),
          0.0001,
        );
        let minor = gridLine(floorPoint.xz, 0.25, pixelFootprint) * 0.62;
        let major = gridLine(floorPoint.xz, 1.0, pixelFootprint) * 0.90;
        let grid = max(minor, major);
        floorColor = mix(floorColor, vec3f(0.035), grid);
      }
      return presentCeramic(floorColor);
    }
  }
  return presentCeramic(backdrop);
}

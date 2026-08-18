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

struct VertexOut {
  @builtin(position) position: vec4f,
}

@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  var out: VertexOut;
  out.position = vec4f(positions[index], 0.0, 1.0);
  return out;
}

fn cameraRay(uv: vec2f) -> vec3f {
  let forward = normalize(params.cameraTarget - params.cameraPosition);
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

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let uv = in.position.xy / max(params.resolution, vec2f(1.0));
  let ro = params.cameraPosition;
  let rd = cameraRay(uv);
  // `presentCeramic` maps this neutral linear value to #fafafa. Keeping the
  // floor and the empty backdrop on the same tone avoids a canvas edge where
  // the light hero meets the rest of the page.
  let backdrop = vec3f(2.93);
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

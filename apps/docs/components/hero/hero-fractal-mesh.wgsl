import {
  CeramicMaterial,
  presentCeramic,
  shadeCeramic,
} from "./hero-fractal-ceramic.wgsl";

struct MeshParams {
  viewProjection: mat4x4f,
  model: mat4x4f,
  cameraPosition: vec3f,
  meshMin: vec3f,
  meshMax: vec3f,
  material: CeramicMaterial,
}
@group(0) @binding(0) var<uniform> params: MeshParams;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) ambientOcclusion: f32,
};

@vertex fn vs_main(
  @location(0) packed_position: vec4f,
  @location(1) packed_normal: vec4f,
) -> VertexOut {
  let localPosition = mix(params.meshMin, params.meshMax, packed_position.xyz);
  let world = params.model * vec4f(localPosition, 1.0);
  var out: VertexOut;
  out.position = params.viewProjection * world;
  out.worldPosition = world.xyz;
  out.worldNormal = normalize((params.model * vec4f(packed_normal.xyz, 0.0)).xyz);
  out.ambientOcclusion = packed_position.w;
  return out;
}

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let view = normalize(params.cameraPosition - in.worldPosition);
  // The generated mesh has consistent outward/cavity winding and is back-face
  // culled. Flipping this normal toward the camera makes diffuse lighting
  // discontinuously change as the orbit crosses a face plane.
  let normal = normalize(in.worldNormal);
  let ceramic = shadeCeramic(
    in.worldPosition,
    view,
    normal,
    params.material,
  );
  return presentCeramic(ceramic * clamp(in.ambientOcclusion, 0.0, 1.0));
}

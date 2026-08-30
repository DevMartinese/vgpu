import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";

/**
 * Regression suite for #212: bare package specifiers must resolve for *nominal type*
 * positions (binding types, struct members, aliases, function signatures), not only for
 * the value/function positions that the mangler already handled.
 */

const SCENE_ABI = `export struct SceneCamera {
  viewProjection: mat4x4f,
}

export struct SceneLight {
  direction: vec4f,
  color: vec4f,
  intensity: f32,
  kind: u32,
}

export struct SceneLights {
  count: u32,
  lights: array<SceneLight, 8>,
}

export struct SceneModel {
  matrix: mat4x4f,
}

export struct SceneVarying {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f,
}

export fn vgpuSceneLighting(lights: SceneLights, normal: vec3f) -> vec3f {
  var total = vec3f(0.0);
  for (var i = 0u; i < lights.count; i = i + 1u) {
    let light = lights.lights[i];
    total = total + light.color.rgb * light.intensity * max(dot(normal, -light.direction.xyz), 0.0);
  }
  return total;
}
`;

test("bare package specifier resolves for a uniform binding type", async () => {
  const dir = await sceneFixture();
  const entry = join(dir, "app", "main.wgsl");
  await writeFile(entry, `import { SceneCamera } from "@scene/abi/scene";

@group(0) @binding(0) var<uniform> camera: SceneCamera;

@vertex fn vs() -> @builtin(position) vec4f {
  return camera.viewProjection * vec4f(0.0, 0.0, 0.0, 1.0);
}
`);

  const { reflection } = await resolveShader({ entry, validate: false });
  const binding = reflection.bindings[0]!;

  expect(binding).toMatchObject({ group: 0, binding: 0, name: "camera", kind: "buffer", addressSpace: "uniform" });
  expect(binding.type).toMatchObject({ kind: "identifier", name: "SceneCamera" });
  expect(binding.struct?.name).toBe("SceneCamera");
  expect(binding.layout).toMatchObject({ size: 64, align: 16 });
  expect(binding.layout?.members?.map((member) => [member.name, member.offset, member.size])).toEqual([["viewProjection", 0, 64]]);
});

test("bare package specifier resolves for struct member types", async () => {
  const dir = await sceneFixture();
  const entry = join(dir, "app", "main.wgsl");
  await writeFile(entry, `import { SceneCamera, SceneModel } from "@scene/abi/scene";

struct Frame {
  camera: SceneCamera,
  model: SceneModel,
}

@group(0) @binding(0) var<uniform> frame: Frame;

@vertex fn vs() -> @builtin(position) vec4f {
  return frame.camera.viewProjection * frame.model.matrix[0];
}
`);

  const { reflection } = await resolveShader({ entry, validate: false });
  const layout = reflection.bindings[0]!.layout!;

  expect(layout).toMatchObject({ size: 128, align: 16 });
  expect(layout.members?.map((member) => [member.name, member.offset, member.size])).toEqual([
    ["camera", 0, 64],
    ["model", 64, 64],
  ]);
  expect(layout.members?.[0]?.layout.members?.map((member) => member.name)).toEqual(["viewProjection"]);
});

test("bare package specifier resolves through aliases, storage bindings and function signatures", async () => {
  const dir = await sceneFixture();
  const entry = join(dir, "app", "main.wgsl");
  await writeFile(entry, `import { SceneCamera, SceneLights, SceneModel, SceneVarying, vgpuSceneLighting } from "@scene/abi/scene";

alias Camera = SceneCamera;

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> lights: SceneLights;
@group(0) @binding(2) var<uniform> model: SceneModel;

fn shade(varying: SceneVarying) -> vec3f {
  return vgpuSceneLighting(lights, varying.normal);
}

@fragment fn fs(varying: SceneVarying) -> @location(0) vec4f {
  let world = model.matrix * camera.viewProjection * varying.clip;
  return vec4f(shade(varying) + world.xyz, 1.0);
}
`);

  const { reflection, wgsl } = await resolveShader({ entry, validate: false });

  expect(reflection.bindings.map((binding) => [binding.name, binding.layout?.size, binding.layout?.align])).toEqual([
    ["camera", 64, 16],
    ["lights", 400, 16],
    ["model", 64, 16],
  ]);
  expect(reflection.bindings[0]!.type).toMatchObject({ kind: "identifier", name: "Camera" });
  expect(reflection.bindings[0]!.layout?.members?.map((member) => member.name)).toEqual(["viewProjection"]);
  expect(reflection.bindings[1]!.struct?.name).toBe("SceneLights");
  expect(reflection.bindings[2]!.type).toMatchObject({ kind: "identifier", name: "SceneModel" });
  expect(wgsl).toMatch(/fn _vgsl_[0-9a-f]{8}__vgpuSceneLighting\(/u);
});

test("bare package specifier resolves for binding types through packageMap and virtual modules", async () => {
  const shader = await resolveShader({
    entry: "/app/main.wgsl",
    validate: false,
    packageMap: { "@scene/abi": "/vendor/scene-abi" },
    modules: {
      "/vendor/scene-abi/scene.wgsl": SCENE_ABI,
      "/app/main.wgsl": `import { SceneCamera, SceneLights, vgpuSceneLighting } from "@scene/abi/scene";

@group(0) @binding(0) var<uniform> camera: SceneCamera;
@group(0) @binding(1) var<storage, read> lights: SceneLights;

@fragment fn fs() -> @location(0) vec4f {
  return vec4f(vgpuSceneLighting(lights, camera.viewProjection[0].xyz), 1.0);
}
`,
    },
  });

  expect(shader.reflection.bindings.map((binding) => [binding.name, binding.type.kind === "identifier" ? binding.type.name : undefined, binding.layout?.size])).toEqual([
    ["camera", "SceneCamera", 64],
    ["lights", "SceneLights", 400],
  ]);
});

test("bare package specifier reflection matches the relative virtual-module workaround", async () => {
  const source = (from: string) => `import { SceneCamera, SceneLights, SceneModel, vgpuSceneLighting } from "${from}";

struct Frame {
  camera: SceneCamera,
  model: SceneModel,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> lights: SceneLights;

@fragment fn fs() -> @location(0) vec4f {
  return vec4f(vgpuSceneLighting(lights, frame.camera.viewProjection[0].xyz) + frame.model.matrix[0].xyz, 1.0);
}
`;

  const bare = await resolveShader({
    entry: "/app/main.wgsl",
    validate: false,
    packageMap: { "@scene/abi": "/vendor/scene-abi" },
    modules: { "/vendor/scene-abi/scene.wgsl": SCENE_ABI, "/app/main.wgsl": source("@scene/abi/scene") },
  });
  const relative = await resolveShader({
    entry: "/app/main.wgsl",
    validate: false,
    modules: { "/app/scene-abi.wgsl": SCENE_ABI, "/app/main.wgsl": source("./scene-abi.wgsl") },
  });

  expect(normalizeMangling(bare.wgsl)).toBe(normalizeMangling(relative.wgsl));
  expect(normalizeMangling(JSON.stringify(bare.reflection.bindings))).toBe(normalizeMangling(JSON.stringify(relative.reflection.bindings)));
  expect(normalizeMangling(JSON.stringify(bare.reflection.hostShareableLayouts))).toBe(normalizeMangling(JSON.stringify(relative.reflection.hostShareableLayouts)));
});

test("real @vgpu/wgsl-std package export types a binding through the bare specifier", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-std-types-"));
  await mkdir(join(dir, "app"), { recursive: true });
  await mkdir(join(dir, "node_modules", "@vgpu"), { recursive: true });
  const { symlink } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  await symlink(resolve(import.meta.dirname, "..", "..", "wgsl-std"), join(dir, "node_modules", "@vgpu", "wgsl-std"), "dir");
  const entry = join(dir, "app", "main.wgsl");
  await writeFile(entry, `import { VoronoiSample2, voronoi2d } from "@vgpu/wgsl-std/noise";

struct Samples {
  first: VoronoiSample2,
}

@group(0) @binding(0) var<storage, read_write> samples: Samples;

@compute @workgroup_size(1) fn main() {
  samples.first = voronoi2d(vec2f(0.5, 0.25));
}
`);

  const { reflection } = await resolveShader({ entry, validate: false });
  const layout = reflection.bindings[0]!.layout!;

  expect(layout.members?.map((member) => member.name)).toEqual(["first"]);
  expect(layout.members?.[0]?.layout.members?.map((member) => [member.name, member.offset])).toEqual([
    ["f1", 0],
    ["f2", 4],
    ["cell", 8],
  ]);
});

test("unknown types in a package module still report VGPU-WGSL-REFLECT-UNKNOWN-TYPE", async () => {
  await expect(
    resolveShader({
      entry: "/app/main.wgsl",
      validate: false,
      packageMap: { "@scene/abi": "/vendor/scene-abi" },
      modules: {
        "/vendor/scene-abi/scene.wgsl": SCENE_ABI,
        "/app/main.wgsl": `import { SceneCamera } from "@scene/abi/scene";
@group(0) @binding(0) var<uniform> camera: SceneMissing;
`,
      },
    }),
  ).rejects.toMatchObject({ code: "VGPU-WGSL-REFLECT-UNKNOWN-TYPE" });
});

function normalizeMangling(text: string): string {
  return text.replace(/_vgsl_[0-9a-f]{8}__/gu, "_vgsl_HASH__").replace(/\/\/ vgsl-module: .*/gu, "// vgsl-module: <path>");
}

async function sceneFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-scene-abi-"));
  await mkdir(join(dir, "app"), { recursive: true });
  await mkdir(join(dir, "node_modules", "@scene", "abi", "src"), { recursive: true });
  await writeFile(join(dir, "node_modules", "@scene", "abi", "package.json"), JSON.stringify({ name: "@scene/abi", exports: { "./scene": "./src/scene.wgsl" } }));
  await writeFile(join(dir, "node_modules", "@scene", "abi", "src", "scene.wgsl"), SCENE_ABI);
  return dir;
}

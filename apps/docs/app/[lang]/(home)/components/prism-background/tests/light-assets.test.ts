import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { PNG } from "pngjs";
import { describe, expect, test, vi } from "vitest";
import type { Gpu } from "vgpu";
import type { Texture } from "vgpu/core";

import causticDebugWgsl from "../materials/light/caustic-debug.wgsl";
import causticWgsl from "../materials/light/caustic.wgsl";
import copyLinearWgsl from "../copy-linear.wgsl";
import presentWgsl from "../materials/light/present.wgsl";
import spectralWgsl from "../materials/shared/spectral.wgsl";
import toneMappingWgsl from "../materials/shared/tone-mapping.wgsl";
import wallCommonWgsl from "../materials/light/wall-common.wgsl";
import wallDebugWgsl from "../materials/light/wall-debug.wgsl";
import wallNormalWgsl from "../materials/light/wall-normal.wgsl";
import wallWgsl from "../materials/light/wall.wgsl";
import { generateCausticProfile } from "../assets/light/generate-caustic";
import {
  applyGlobalLightMask,
  generateLightAsset,
  globalLightMaskEdgeMax,
} from "../assets/light/generate";
import {
  generateWallLighting,
  generateWallMaterial,
  PRISM_GROUNDING_AO,
  PRISM_GROUNDING_TRIANGLE,
} from "../assets/light/generate-wall";
import { parseKtx2 } from "../assets/light/ktx2";
import {
  createLightTextureLoader,
  loadLightAssetTextures,
  type LightTextureLoader,
} from "../assets/light/loader";
import { reflectSource } from "@vgpu/wgsl/reflect-source";
import { wavelengthToBeamRgb } from "../optics";
import { PRISM_SPECTRAL_SAMPLES, PRISM_WAVELENGTHS } from "../types";

describe("light pipeline baked assets", () => {
  test("spectral LUT is the Float32 checkpoint of the CPU CIE/D65 formula", () => {
    const entries = Array.from(
      spectralWgsl.wgsl.matchAll(/vec4f\(([^)]+)\),/g),
      (match) => match[1]!.split(",").map((value) => Number(value.trim()))
    );
    expect(entries).toHaveLength(PRISM_SPECTRAL_SAMPLES);

    entries.forEach((entry, index) => {
      const wavelength = Math.fround(
        PRISM_WAVELENGTHS.min +
          (PRISM_WAVELENGTHS.max - PRISM_WAVELENGTHS.min) *
            (index / (PRISM_SPECTRAL_SAMPLES - 1))
      );
      expect(entry).toEqual([
        ...wavelengthToBeamRgb(wavelength).map(Math.fround),
        wavelength,
      ]);
    });
  });

  test("wall grounding uses the exact prism footprint", () => {
    const [apex, left, right] = PRISM_GROUNDING_TRIANGLE;
    expect(apex[0]).toBeCloseTo(0);
    expect(left[0]).toBeCloseTo(-0.5);
    expect(right[0]).toBeCloseTo(0.5);
    expect(left[1]).toBeCloseTo(right[1]);
    expect(left[1] - apex[1]).toBeCloseTo(Math.sqrt(3) / 2);
    expect(PRISM_GROUNDING_AO.insideSpread).toBeLessThan(
      PRISM_GROUNDING_AO.outsideSpread
    );
    expect(PRISM_GROUNDING_AO.opacity).toBeLessThan(0.12);
  });

  test("procedural sources are deterministic and retain useful variation", () => {
    const first = generateWallMaterial([24, 16]);
    const second = generateWallMaterial([24, 16]);
    expect(first.pixels).toEqual(second.pixels);
    expect(
      new Set(first.pixels.filter((_, index) => index % 4 === 0)).size
    ).toBeGreaterThan(8);

    const caustic = generateCausticProfile([32, 12]);
    expect(new Set(caustic.pixels).size).toBeGreaterThan(32);
  });

  test("wall lighting bakes three positive soft light fields", () => {
    const lighting = generateWallLighting([64, 64]);
    const channelAt = (u: number, v: number, channel: number) => {
      const x = Math.floor(u * lighting.width);
      const y = Math.floor(v * lighting.height);
      return lighting.pixels[(y * lighting.width + x) * 4 + channel]!;
    };
    const redAt = (u: number, v: number) => channelAt(u, v, 0);
    const quiet = redAt(0.12, 0.92);

    expect(redAt(0.02, 0.02)).toBeGreaterThan(quiet + 25);
    expect(redAt(0.56, 0.25)).toBeGreaterThan(quiet + 18);
    expect(redAt(0.82, 0.48)).toBeGreaterThan(quiet + 12);
    expect(channelAt(0.75, 0.25, 1)).toBe(255);
    expect(channelAt(0.5, 0.645, 1)).toBeLessThan(255);
    expect(channelAt(0.5, 0.72, 1)).toBe(255);
  });

  test.each([
    ["wall-material", 512, 512, 10],
    ["wall-lighting", 512, 512, 10],
    ["caustic-profile", 1024, 256, 11],
  ] as const)(
    "%s is a linear RGBA8 KTX2 mip chain",
    async (name, width, height, levels) => {
      const file = await readFile(
        resolve(process.cwd(), `apps/docs/public/hero/prism-light/${name}.ktx2`)
      );
      const source = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength
      ) as ArrayBuffer;
      const parsed = parseKtx2(source);
      expect(parsed.format).toBe("rgba8unorm");
      expect(parsed.levels).toHaveLength(levels);
      expect(parsed.levels[0]).toMatchObject({ width, height });
      expect(parsed.levels.at(-1)).toMatchObject({ width: 1, height: 1 });
      const baked = parsed.levels[0]!.data;
      const generated = generateLightAsset(name).pixels;
      if (name === "wall-lighting") {
        const mask = PNG.sync.read(
          await readFile(
            resolve(
              process.cwd(),
              "apps/docs/assets/prism-light/wall-global-light-mask.png"
            )
          )
        );
        expect(mask.width / mask.height).toBeCloseTo(1.5);
        applyGlobalLightMask(
          { width, height, pixels: generated },
          mask.data,
          mask.width,
          mask.height
        );
        expect(
          globalLightMaskEdgeMax(generated, width, height, 1)
        ).toBeLessThanOrEqual(2);
      }
      expect(hash(baked)).toBe(hash(generated));
    }
  );

  test("debug shaders publish every material inspection entry", () => {
    const wallEntries = reflectSource(wallDebugWgsl.wgsl).entryPoints.map(
      (entry) => entry.name
    );
    expect(wallEntries).toEqual(
      expect.arrayContaining([
        "vs_debug",
        "fs_albedo",
        "fs_large_normal",
        "fs_micro_normal",
        "fs_normal",
        "fs_roughness",
        "fs_global_shadow",
        "fs_prism_shadow",
        "fs_prism_ao",
        "fs_composed",
      ])
    );
    expect(wallDebugWgsl.wgsl).toContain(
      "params.viewProjection * vec4f(worldPosition, 0.0, 1.0)"
    );
    expect(
      reflectSource(causticDebugWgsl.wgsl).entryPoints.map(
        (entry) => entry.name
      )
    ).toContain("fs_raw_caustic");
    expect(spectralWgsl.wgsl).toContain("SPECTRAL_LUT");
    expect(spectralWgsl.wgsl).not.toContain("d65SpectralPower");
  });

  test("wall detail is world-space, isotropic, and split into two normal scales", () => {
    expect(wallNormalWgsl.wgsl).toContain(
      "worldPosition / max(worldScale, 0.001)"
    );
    expect(wallCommonWgsl.wgsl).toContain("params.microNormalFrequency");
    expect(wallCommonWgsl.wgsl).toContain("params.microNormalStrength");
    expect(wallNormalWgsl.wgsl).toContain("textureSampleBias");
    expect(wallCommonWgsl.wgsl).toContain("GLOBAL_LIGHT_MASK_ASPECT = 1.5");
    expect(wallCommonWgsl.wgsl).toMatch(
      /wallAspect \/ \w*GLOBAL_LIGHT_MASK_ASPECT/
    );
    expect(wallCommonWgsl.wgsl).toMatch(
      /screenUv\.y \* \w*GLOBAL_LIGHT_MASK_ASPECT \/ wallAspect/
    );
    expect(wallCommonWgsl.wgsl).toContain(
      "material.r * globalDiffuse"
    );
    expect(wallCommonWgsl.wgsl).toContain("mix(0.25, 1.0, lightFacing)");
    expect(wallCommonWgsl.wgsl).toContain("params.globalLightTransfer");
    expect(wallCommonWgsl.wgsl).toContain("globalLightLinear");
    expect(wallCommonWgsl.wgsl).toContain("shadowContrastCurve");
    expect(wallCommonWgsl.wgsl).toContain("params.shadowContrast");
    expect(wallCommonWgsl.wgsl).toContain("params.shadowPivot");
    expect(wallCommonWgsl.wgsl).toContain("globalLightShaped");
    expect(wallCommonWgsl.wgsl).toContain("globalBaseExposure");
    expect(wallCommonWgsl.wgsl).toContain(
      "direct * globalBaseExposure + globalIllumination"
    );
    expect(wallCommonWgsl.wgsl).toContain("globalSurfaceResponse");
    expect(wallCommonWgsl.wgsl).not.toContain("albedo * globalLight");
    expect(wallCommonWgsl.wgsl).not.toContain(
      "textureSample(wallMaterial, materialSampler, screenUv)"
    );
    expect(wallDebugWgsl.wgsl).toContain("tonemapAces(composed)");
    expect(wallDebugWgsl.wgsl).toContain("linearToSrgb3(");
  });

  test("caustic output is non-darkening premultiplied radiance", () => {
    expect(causticWgsl.wgsl).toContain(
      "vec4f(tint * coverage * surfaceResponse, 0.0)"
    );
    expect(causticWgsl.wgsl).toContain(
      "vec4f(position, scene.lightPlaneZ, 1.0)"
    );
    expect(causticWgsl.wgsl).not.toContain("select(0.0, scene.lightPlaneZ");
    expect(causticWgsl.wgsl).toContain("scene.inputBeamDirection");
    expect(causticWgsl.wgsl).toContain(
      "rayDirection * cos(elevation)"
    );
    expect(causticWgsl.wgsl).not.toContain(
      "-rayDirection * cos(elevation)"
    );
    expect(causticWgsl.wgsl).toContain("hasTravelGradient");
    expect(causticWgsl.wgsl).toContain(
      "in.wavelength >= 0.0 && hasTravelGradient"
    );
    expect(causticWgsl.wgsl).not.toContain(
      "in.wavelength < 0.0 || hasTravelGradient"
    );
    expect(causticWgsl.wgsl).toContain("relativeResponse");
    expect(wallNormalWgsl.wgsl).toContain("textureSampleLevel");
  });

  test("light present supports selectable tone mapping", () => {
    expect(presentWgsl.wgsl).toContain("params.toneMapping");
    expect(presentWgsl.wgsl).toContain("applyPrismToneMapping");
    expect(presentWgsl.wgsl).toContain(
      "mix(params.backgroundColor, presented, reveal)"
    );
    expect(toneMappingWgsl.wgsl).toContain("tonemapAces");
    expect(toneMappingWgsl.wgsl).toContain("tonemapNeutral");
    expect(toneMappingWgsl.wgsl).toContain("tonemapReinhard");
    expect(toneMappingWgsl.wgsl).toContain("mode == 3u");
  });

  test("keeps production targets linear HDR until presentation", () => {
    expect(wallWgsl.wgsl).not.toContain("tonemap");
    expect(wallWgsl.wgsl).not.toContain("linearToSrgb");
    expect(copyLinearWgsl.wgsl).not.toContain("tonemap");
    expect(copyLinearWgsl.wgsl).not.toContain("linearToSrgb");
    expect(presentWgsl.wgsl).toContain("applyPrismToneMapping");
    expect(presentWgsl.wgsl).toContain("linearToSrgb3");
  });

  test("destroys successful texture loads when one asset fails", async () => {
    const destroyed = [vi.fn(), vi.fn()];
    let successful = 0;
    const loader: LightTextureLoader = {
      async load(_gpu, spec) {
        if (spec.id === "caustic-profile") throw new Error("broken caustic");
        return { destroy: destroyed[successful++]! } as unknown as Texture;
      },
    };
    await expect(loadLightAssetTextures({} as Gpu, loader)).rejects.toThrow(
      "broken caustic"
    );
    for (const destroy of destroyed) expect(destroy).toHaveBeenCalledOnce();
  });

  test("destroys a partial GPU upload without retrying doomed bytes", async () => {
    const destroy = vi.fn();
    const createTexture = vi.fn(() => ({ gpu: {}, destroy }));
    const writeTexture = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("device upload failed");
      });
    const loader = createLightTextureLoader({
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
      fallback: () => ({
        width: 2,
        height: 2,
        pixels: new Uint8Array(16),
      }),
    });
    const gpu = {
      device: { createTexture },
      gpu: { queue: { writeTexture } },
    } as unknown as Gpu;

    await expect(
      loader.load(gpu, {
        id: "wall-material",
        url: "/wall.ktx2",
        size: [2, 2],
        colorSpace: "linear",
      })
    ).rejects.toThrow("device upload failed");
    expect(createTexture).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { PNG } from "pngjs";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatorEntry = resolve(
  docsRoot,
  "app/[lang]/(home)/components/prism-background/assets/light/generate.ts"
);
const outputDirectory = resolve(docsRoot, "public/hero/prism-light");
const wallGlobalLightMask = resolve(
  docsRoot,
  "assets/prism-light/wall-global-light-mask.png"
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "prism-light-"));

async function applyWallGlobalLightMask(
  asset,
  applyGlobalLightMask,
  globalLightMaskEdgeMax
) {
  const mask = PNG.sync.read(await readFile(wallGlobalLightMask));
  applyGlobalLightMask(asset, mask.data, mask.width, mask.height);
  const edgeMax = globalLightMaskEdgeMax(
    asset.pixels,
    asset.width,
    asset.height,
    1
  );
  if (edgeMax > 2) {
    throw new Error(`wall mask must fade to black at every edge; max=${edgeMax}`);
  }
}

try {
  const bundle = await build({
    entryPoints: [generatorEntry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    bundle.outputFiles[0].text
  ).toString("base64")}`;
  const {
    applyGlobalLightMask,
    generateLightAsset,
    globalLightMaskEdgeMax,
  } = await import(moduleUrl);
  const assets = ["wall-material", "wall-lighting", "caustic-profile"];
  await mkdir(outputDirectory, { recursive: true });
  for (const id of assets) {
    const asset = generateLightAsset(id);
    if (id === "wall-lighting") {
      await applyWallGlobalLightMask(
        asset,
        applyGlobalLightMask,
        globalLightMaskEdgeMax
      );
    }
    const png = PNG.sync.write({
      width: asset.width,
      height: asset.height,
      data: Buffer.from(asset.pixels),
      colorType: 6,
    });
    const pngPath = join(temporaryDirectory, `${id}.png`);
    const outputPath = join(outputDirectory, `${id}.ktx2`);
    await writeFile(pngPath, png);
    execFileSync(
      "toktx",
      [
        "--t2",
        "--genmipmap",
        "--filter",
        "lanczos4",
        "--assign_oetf",
        "linear",
        "--target_type",
        "RGBA",
        outputPath,
        pngPath,
      ],
      { stdio: "inherit" }
    );
    process.stdout.write(`generated ${pathToFileURL(outputPath).pathname}\n`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
const temporaryDirectory = await mkdtemp(join(tmpdir(), "prism-light-"));

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
  const { generateLightAsset } = await import(moduleUrl);
  const assets = ["wall-material", "wall-lighting", "caustic-profile"];
  await mkdir(outputDirectory, { recursive: true });
  for (const id of assets) {
    const asset = generateLightAsset(id);
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

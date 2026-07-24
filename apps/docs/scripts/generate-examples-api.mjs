import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = resolve(root, process.env.VGPU_EXAMPLES_OUTPUT_DIR ?? 'apps/docs/generated/examples-api');
// Address the canonical source snapshot, not the generator commit (avoids self-changing output).
const commit = process.env.VGPU_EXAMPLES_GIT_COMMIT ?? execFileSync(
  'git', ['log', '-1', '--format=%H', '--', 'apps/docs/lib/examples-source.generated.ts'],
  { cwd: root, encoding: 'utf8' },
).trim();
const publish = process.argv.includes('--publish');
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'vgpu-examples-generator-'));
const bundle = resolve(temporaryDirectory, 'run.mjs');
try {
  await rm(output, { recursive: true, force: true });
  await build({
    stdin: {
      contents: `
        import { createLegacyByteGraph } from ${JSON.stringify(resolve(root, 'apps/docs/lib/examples-api/adapter-v0.ts'))};
        import { generateExampleArtifacts, writeArtifactTree } from ${JSON.stringify(resolve(root, 'apps/docs/lib/examples-api/artifact-generator.ts'))};
        import { publishArtifactSet } from ${JSON.stringify(resolve(root, 'apps/docs/lib/examples-api/publisher.ts'))};
        import { VercelBlobPublisher } from ${JSON.stringify(resolve(root, 'apps/docs/lib/examples-api/vercel-blob-publisher.ts'))};
        const graph = createLegacyByteGraph({ repository: 'https://github.com/vgpu/vgpu', gitCommit: ${JSON.stringify(commit)} });
        const set = generateExampleArtifacts(graph, ${JSON.stringify(process.env.VGPU_EXAMPLES_ORIGIN ?? 'https://vgpu.labs.vercel.dev')});
        await writeArtifactTree(set, ${JSON.stringify(output)});
        if (${JSON.stringify(publish)}) await publishArtifactSet(new VercelBlobPublisher(), set);
        console.log(JSON.stringify({ revision: set.revision, artifacts: set.artifacts.length, published: ${JSON.stringify(publish)}, output: ${JSON.stringify(output)} }));
      `,
      resolveDir: root,
      sourcefile: 'generate-examples-api-runner.ts',
      loader: 'ts',
    },
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent',
  });
  await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

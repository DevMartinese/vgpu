import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLegacyByteGraph } from '../../../../../../../lib/examples-api/adapter-v0';
import { generateExampleArtifacts, writeArtifactTree } from '../../../../../../../lib/examples-api/artifact-generator';
import * as discoveryRoute from '../../../../../../.well-known/vgpu-examples.json/route';
import * as latestRoute from '../../../latest.json/route';
import * as revisionRoute from './route';

const origin = 'https://vgpu.labs.vercel.dev';
const graph = createLegacyByteGraph({ repository: 'https://github.com/vgpu/vgpu', gitCommit: '75cd72b10d1cd8e629391f9fc6276c50e3553d26' });
const set = generateExampleArtifacts(graph);
let root: string;
const previousMode = process.env.VGPU_EXAMPLES_ARTIFACT_STORE;
const previousRoot = process.env.VGPU_EXAMPLES_LOCAL_ROOT;

beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'vgpu-route-test-'));
  await writeArtifactTree(set, root);
  process.env.VGPU_EXAMPLES_ARTIFACT_STORE = 'local';
  process.env.VGPU_EXAMPLES_LOCAL_ROOT = root;
});

afterAll(async () => {
  if (previousMode === undefined) delete process.env.VGPU_EXAMPLES_ARTIFACT_STORE;
  else process.env.VGPU_EXAMPLES_ARTIFACT_STORE = previousMode;
  if (previousRoot === undefined) delete process.env.VGPU_EXAMPLES_LOCAL_ROOT;
  else process.env.VGPU_EXAMPLES_LOCAL_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true });
});

const request = (path: string, headers?: HeadersInit) => new Request(`${origin}${path}`, { headers });
const context = (revision: string, artifact: string[]) => ({ params: Promise.resolve({ revision, artifact }) });

describe('examples API App Router handlers', () => {
  it('serves exact discovery with tokenless CORS, validators, HEAD and OPTIONS', async () => {
    const response = await discoveryRoute.GET(request('/.well-known/vgpu-examples.json'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('access-control-expose-headers')).toBe('ETag, Content-Length');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
    const etag = response.headers.get('etag')!;
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(Number(response.headers.get('content-length')));
    const discovery = JSON.parse(new TextDecoder().decode(bytes));
    expect(discovery).toMatchObject({
      protocol: 'vgpu-examples', discoveryVersion: 1,
      contracts: [{ id: 'vgpu-examples/v1', status: 'active', minimumCliVersion: '0.1.6', indexUrl: `${origin}/api/examples/v1/latest.json` }],
    });

    const notModified = await discoveryRoute.GET(request('/.well-known/vgpu-examples.json', { 'if-none-match': etag }));
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');

    const head = await discoveryRoute.HEAD(request('/.well-known/vgpu-examples.json'));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(await head.text()).toBe('');

    const options = await discoveryRoute.OPTIONS(request('/.well-known/vgpu-examples.json'));
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    expect(await options.text()).toBe('');

    const post = await discoveryRoute.POST(request('/.well-known/vgpu-examples.json'));
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('serves latest briefly and immutable revision bytes with declared content types', async () => {
    const latest = await latestRoute.GET(request('/api/examples/v1/latest.json'));
    expect(latest.status).toBe(200);
    expect(latest.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
    const latestDocument = await latest.json();
    expect(latestDocument.indexUrl).toBe(`${origin}/api/examples/v1/revisions/${set.revision}/index.json`);
    const latestHead = await latestRoute.HEAD(request('/api/examples/v1/latest.json'));
    expect(latestHead.status).toBe(200);
    expect(await latestHead.text()).toBe('');
    const latestOptions = await latestRoute.OPTIONS(request('/api/examples/v1/latest.json'));
    expect(latestOptions.status).toBe(204);

    const index = await revisionRoute.GET(
      request('/ignored'),
      context(set.revision, ['index.json']),
    );
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('application/json; charset=utf-8');

    const fractal = graph.examples.find(({ id }) => id === 'raymarched-fractal')!;
    const source = fractal.files[0]!;
    const rawPath = ['examples', 'raymarched-fractal', 'files', `${source.path}.raw`];
    const response = await revisionRoute.GET(request(`/api/examples/v1/revisions/${set.revision}/${rawPath.join('/')}`), context(set.revision, rawPath));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(`${source.contentType}; charset=utf-8`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('etag')).toBe(`"${source.sha256}"`);
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(source.text);

    const conditional = await revisionRoute.GET(request('/ignored', { 'if-none-match': response.headers.get('etag')! }), context(set.revision, rawPath));
    expect(conditional.status).toBe(304);
    const head = await revisionRoute.HEAD(request('/ignored'), context(set.revision, rawPath));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const wgsl = fractal.files.find(({ path }) => path.endsWith('.wgsl'))!;
    const wgslPath = ['examples', 'raymarched-fractal', 'files', `${wgsl.path}.raw`];
    const wgslResponse = await revisionRoute.GET(request('/ignored'), context(set.revision, wgslPath));
    expect(wgslResponse.headers.get('content-type')).toBe('text/wgsl; charset=utf-8');
    expect(new TextDecoder().decode(await wgslResponse.arrayBuffer())).toBe(wgsl.text);

    const manifestPath = ['examples', 'raymarched-fractal', 'manifest.json'];
    const manifest = await revisionRoute.GET(request('/ignored'), context(set.revision, manifestPath));
    expect(manifest.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect((await manifest.json()).files.map(({ path }: { path: string }) => path)).toEqual(fractal.files.map(({ path }) => path));
  });

  it('does not serve an allowlisted object beyond the source response cap', async () => {
    const revision = 'f'.repeat(64);
    const relative = ['examples', 'oversized', 'files', 'source.ts.raw'];
    const key = `examples/v1/revisions/${revision}/${relative.join('/')}`;
    const directory = resolve(root, `examples/v1/revisions/${revision}`);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'revision.json'), `${JSON.stringify({
      revision,
      objects: [{ key, size: 2 * 1024 * 1024 + 1, sha256: '0'.repeat(64), contentType: 'text/typescript' }],
    })}\n`);
    const response = await revisionRoute.GET(request('/ignored'), context(revision, relative));
    expect(response.status).toBe(404);
    expect(Number(response.headers.get('content-length'))).toBeLessThan(32 * 1024);
  });

  it('returns CORS-safe 404/405 responses for unknown or unsafe static keys and has no search route', async () => {
    const missing = await revisionRoute.GET(request('/ignored'), context('0'.repeat(64), ['index.json']));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('access-control-allow-origin')).toBe('*');

    const escaped = await revisionRoute.GET(request('/ignored'), context(set.revision, ['..', 'index.json']));
    expect(escaped.status).toBe(404);
    const post = await revisionRoute.POST(request('/ignored'), context(set.revision, ['index.json']));
    expect(post.status).toBe(405);
    expect(existsSync(resolve(process.cwd(), 'apps/docs/app/api/examples/v1/search/route.ts'))).toBe(false);
  });
});

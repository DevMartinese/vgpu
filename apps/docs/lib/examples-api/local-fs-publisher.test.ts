import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLegacyByteGraph } from './adapter-v0';
import { generateExampleArtifacts } from './artifact-generator';
import { LocalFsPublisher } from './local-fs-publisher';
import { publishArtifactSet, type ArtifactPublisher } from './publisher';

const set = generateExampleArtifacts(createLegacyByteGraph({ repository: 'repo', gitCommit: 'abc' }));

describe('LocalFsPublisher', () => {
  it('publishes immutable revisions create-only and advances the pointer last', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vgpu-publisher-'));
    const publisher = new LocalFsPublisher(root);
    await publishArtifactSet(publisher, set);
    const latest = set.artifacts.find((artifact) => artifact.key === set.latestKey)!;
    expect(await publisher.get(set.latestKey)).toEqual(latest.bytes);
    const immutable = set.artifacts.find((artifact) => artifact.immutable)!;
    await expect(publisher.putImmutable(immutable)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await publisher.get(immutable.key)).toEqual(immutable.bytes);
  });

  it('does not advance latest when immutable publication fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vgpu-publisher-fail-'));
    const local = new LocalFsPublisher(root);
    const failing: ArtifactPublisher = {
      ...local,
      putImmutable: async () => { throw new Error('injected immutable failure'); },
      get: local.get.bind(local), head: local.head.bind(local), advancePointer: local.advancePointer.bind(local),
    };
    await expect(publishArtifactSet(failing, set)).rejects.toThrow(/Published object head mismatch/);
    expect(await local.get(set.latestKey)).toBeUndefined();
  });

  it('retains an old revision when a new latest revision is published', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vgpu-publisher-retain-'));
    const publisher = new LocalFsPublisher(root);
    await publishArtifactSet(publisher, set);
    const old = set.artifacts.find((artifact) => artifact.immutable)!;
    const changedGraph = createLegacyByteGraph({ repository: 'repo', gitCommit: 'def' });
    await publishArtifactSet(publisher, generateExampleArtifacts(changedGraph));
    expect(await publisher.get(old.key)).toEqual(old.bytes);
  });
});

import { link, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { GeneratedArtifact } from './artifact-generator';
import type { ArtifactPublisher, PublishedObjectHead } from './publisher';
import { sha256 } from './hashing';

export class LocalFsPublisher implements ArtifactPublisher {
  constructor(readonly rootDirectory: string) {}

  async putImmutable(artifact: GeneratedArtifact): Promise<void> {
    const destination = this.pathFor(artifact.key);
    await mkdir(dirname(destination), { recursive: true });
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporary = `${destination}.tmp-${token}`;
    const temporaryMeta = `${temporary}.meta.json`;
    try {
      await writeFile(temporary, artifact.bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(temporaryMeta, this.metadata(artifact), { flag: 'wx', mode: 0o600 });
      // link() provides atomic create-if-absent semantics; rename() would overwrite.
      await link(temporary, destination);
      try {
        await link(temporaryMeta, this.metaPath(destination));
      } catch (error) {
        await rm(destination, { force: true });
        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
      await rm(temporaryMeta, { force: true });
    }
  }

  async advancePointer(artifact: GeneratedArtifact): Promise<void> {
    const destination = this.pathFor(artifact.key);
    await mkdir(dirname(destination), { recursive: true });
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporary = `${destination}.tmp-${token}`;
    const temporaryMeta = `${temporary}.meta.json`;
    try {
      await writeFile(temporary, artifact.bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(temporaryMeta, this.metadata(artifact), { flag: 'wx', mode: 0o600 });
      await rename(temporaryMeta, this.metaPath(destination));
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
      await rm(temporaryMeta, { force: true });
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async head(key: string): Promise<PublishedObjectHead | undefined> {
    const destination = this.pathFor(key);
    try {
      const [stat, bytes, metadataBytes] = await Promise.all([
        lstat(destination), readFile(destination), readFile(this.metaPath(destination), 'utf8'),
      ]);
      if (!stat.isFile()) throw new Error(`Published object is not a regular file: ${key}`);
      const metadata = JSON.parse(metadataBytes) as { contentType: string };
      return { size: bytes.byteLength, sha256: sha256(bytes), contentType: metadata.contentType };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private pathFor(key: string): string {
    if (!key || key.startsWith('/') || key.includes('\\') || key.includes('\0') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Invalid artifact key: ${key}`);
    }
    const root = resolve(this.rootDirectory);
    const destination = resolve(root, key);
    if (!destination.startsWith(`${root}${sep}`)) throw new Error(`Artifact key escaped publisher root: ${key}`);
    return destination;
  }

  private metaPath(destination: string): string { return `${destination}.meta.json`; }
  private metadata(artifact: GeneratedArtifact): string {
    return `${JSON.stringify({ contentType: artifact.contentType, sha256: artifact.sha256, size: artifact.bytes.byteLength })}\n`;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

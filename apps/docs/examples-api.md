# Examples API operations

The examples API exposes exact canonical gallery bytes from the permanent origin `https://vgpu.sh`. Version 1 is read-only, tokenless, same-origin, and contains no dynamic search endpoint.

**Serving model: latest-only, straight from the deployment.** The generated artifact tree is committed to the repository and ships inside the deployment bundle, so the docs deploy *is* the publication step. There is no external object store, no credential, and no manual workflow on the default path: adding or editing an example is a normal commit, and the API serves the new revision as soon as that commit is deployed.

One revision is live at a time — whichever one is committed. Historical revisions are not retained; the machinery for that is built and tested but dormant (see [Versioned artifact retention](#versioned-artifact-retention-dormant)).

## Routes and HTTP contract

| Route | Object | Cache policy |
| --- | --- | --- |
| `/.well-known/vgpu-examples.json` | discovery and contract negotiation | `public, max-age=60, must-revalidate` |
| `/api/examples/v1/latest.json` | mutable revision pointer | `public, max-age=60, must-revalidate` |
| `/api/examples/v1/revisions/<sha256>/<artifact>` | index, manifests, revision manifest, and raw files | `public, max-age=31536000, immutable` |

Handlers support only `GET`, `HEAD`, and `OPTIONS`; other methods return 405. They return wildcard CORS without credentials, strong SHA-256 `ETag`, `Content-Length`, `X-Content-Type-Options: nosniff`, exact JSON or text content types, and 304 for matching `If-None-Match`. Requests never redirect. Revision paths must match an allowlisted object in that revision's manifest; there is no listing, mutation, or search route.

Response caps are 32 KiB for discovery/latest, 1 MiB for index/revision documents, 256 KiB for example manifests, and 2 MiB per source file. Raw storage keys end in `.raw`; manifest `path` values remain the authored names and response bytes are unchanged.

Immutable cache headers stay correct under this model because a revision id still names exactly one byte set: a changed example produces a *different* revision at a different URL rather than different bytes at the same URL.

## Artifact backend

`VGPU_EXAMPLES_ARTIFACT_STORE` selects the backend and defaults to `local` in every environment, including Vercel:

- **`local` (default)** — reads the generated tree bundled with the deployment. `VGPU_EXAMPLES_LOCAL_ROOT` overrides the directory; otherwise it is resolved relative to the process working directory, probing the app-relative and workspace-relative layouts and picking whichever actually contains the tree. Nothing is hardcoded to a serverless path, so `next dev`, `next start`, tests, and production all use the same code path.
- **`blob`** — the dormant versioned mode. It is still **fail-closed**: selecting it without `VGPU_EXAMPLES_VERCEL_BLOB_READ_WRITE_TOKEN` raises a storage error rather than silently falling back to deployment files. Serving unverified bytes would be worse than serving nothing.

Because the route handlers read the tree with `fs` at request time, a path computed at runtime is invisible to Next's static file tracing. `outputFileTracingIncludes` in `next.config.mjs` therefore bundles `generated/examples-api/**` into the three examples routes explicitly. **Removing that entry makes every artifact 404 in production while passing every local test** — `next dev` reads from the working tree and never exercises the bundle.

### Deploy-boundary race

A client fetch that straddles a deploy can read `latest.json` from the old deployment and a revision artifact from the new one (or vice versa), and the CLI reports an integrity error because the bytes do not match the pointer it just verified. The window is one deploy and a retry resolves it, so this is deliberately not engineered around; the versioned mode below removes it by retaining every revision.

## Revision identity

A revision is the SHA-256 of the canonical byte-graph serialization, folded together with the serving origin: the artifacts embed absolute URLs, so the same source served from a different origin is a different byte set and must be a different revision (`artifactSetRevision` in `lib/examples-api/hashing.ts`).

The snapshot input is a **content hash**: `sha256:<hex>` of the exact bytes of `apps/docs/lib/examples-source.generated.ts` (`sourceSnapshotIdentity`), published as `source.gitCommit` in `index.json` because that key is fixed by the frozen v1 index schema. It is not a commit SHA and must never be used to build `…/commit/<value>` URLs.

Consequences:

- content-identical trees always produce byte-identical artifacts, whatever the git history or merge strategy (squash, rebase, synthetic PR merge refs);
- regenerating the artifact tree belongs in the **same commit** as the source change — there is no post-commit regeneration step, and no revision churn when unrelated commits touch the snapshot's history;
- generation requires no repository history at all, so `examples-api-generated` in CI runs on a default shallow checkout.

Because the digest covers *physical* bytes, line endings are pinned in `.gitattributes` (`text eol=lf`) for the snapshot, the checked-in artifact tree, the frozen schema copies, and the generated contract files. A CRLF checkout (`core.autocrlf=true`) would otherwise digest different bytes for the same git tree and fail the gate; the snapshot is additionally asserted CR-free by `lib/examples-api/source-identity.test.ts`.

Regenerate with `node apps/docs/scripts/generate-examples-api.mjs` and commit `apps/docs/generated/examples-api` together with the source change; `git status --porcelain` on that tree stays the drift gate.

## Adding or changing an example

1. Edit the example source, then run `node apps/docs/scripts/ingest-examples.mjs` if the source export needs to be refreshed.
2. Run `node apps/docs/scripts/generate-examples-api.mjs`.
3. Commit the source change together with the regenerated `apps/docs/generated/examples-api` tree.
4. Merge. The docs deploy publishes it; no workflow run and no library release are required.

## Local serving

```sh
node apps/docs/scripts/generate-examples-api.mjs
pnpm --filter docs build
pnpm --filter docs exec next start --port 3013
```

No environment variable and no credential are required — `local` is the default. Set `VGPU_EXAMPLES_LOCAL_ROOT` only to serve a tree from somewhere other than the app directory. Stop the scratch server after verification.

## Production setup

Nothing. `vgpu.sh` must target this docs deployment and be the **canonical apex** (no redirect): the v1 discovery, latest, and revision responses have to be served directly on this host, because the CLI fetches with `redirect: 'error'`, so any redirect on `vgpu.sh` (for example an apex→`www` rewrite) makes every request fail with `Request failed`. `www.vgpu.sh` must redirect to the apex, and is deliberately absent from the CLI host allowlist for that reason.

`vgpu.labs.vercel.dev` stays pointed at the same deployment as a legacy alias, but that keeps the **host** reachable only — it does not keep older CLIs working. Discovery, latest and revision responses are pre-generated bytes with the `https://vgpu.sh` origin baked in; they are never rewritten per request `Host`. Because `assertTrustedUrl()` demands an exact match against the CLI's own base URL, any CLI released before the dual-host allowlist (`vgpu@0.2.0-rc.0` and earlier) fails with `VGPU-EXAMPLES-INTEGRITY` on both paths: on its default origin, and on `--base-url https://vgpu.sh` too, since its allowlist is single-host. Those users must upgrade to `vgpu@0.2.0-rc.1` or newer. The blast radius is only `0.2.0-rc.0`: `0.1.6` shipped no `examples` subcommand.

## Client compatibility and the unreachable version gate

Discovery advertises `minimumCliVersion` so a server can tell an old CLI to upgrade. For the
`vgpu.sh` migration that signal never reaches the CLIs that need it, and the value must not be
read as "everything older degrades gracefully".

During `handshake()` the client runs `assertTrustedUrl(contract.indexUrl, this.origin)` **before**
it compares `minimumCliVersion`. A CLI released before the dual-host allowlist therefore rejects
the `https://vgpu.sh` index URL as untrusted and exits with `VGPU-EXAMPLES-INTEGRITY` -- the
`VGPU-EXAMPLES-CLI-TOO-OLD` branch is unreachable for exactly the population it was meant to warn.
Raising `minimumCliVersion` cannot change that; it only keeps the advertised contract honest.

Verified against the real published tarball of `vgpu@0.2.0-rc.0`: it fails on its default origin
and on `--base-url https://vgpu.sh` alike, because its allowlist pins a single host. Only
`0.2.0-rc.0` is affected -- `0.1.6` shipped no `examples` subcommand -- and the fix for users is to
upgrade to `0.2.0-rc.1` or newer.

Follow-up (contract change, deliberately not done here): reorder the handshake so the version gate
is evaluated before origin-dependent URL assertions, so a future origin migration can tell old
clients to upgrade instead of failing them with an integrity error. That reorder changes observable
error codes and needs its own contract revision.

## Versioned artifact retention (dormant)

Everything below describes the **versioned mode, which is not in use**. It is documented and kept in the tree — not deleted — because it is fully built and tested, and because retention is the answer to both limitations of the default path: only one revision is live, and a fetch can straddle a deploy boundary. Switching it on is configuration plus a workflow run, not a rewrite.

What already exists and stays exercised by the test suite: the origin-aware revision identity, the create-only publisher with fresh-read verification of every object, the latest-pointer-last transaction, and `.github/workflows/publish-examples-api.yml`.

### Publication transaction

`node apps/docs/scripts/generate-examples-api.mjs --publish` performs this transaction:

1. deterministically generate the artifact set;
2. create every revision object with overwrite disabled;
3. fresh-read and verify size, content type, and SHA-256 for every retained object;
4. update and verify discovery;
5. verify the new index → `raymarched-fractal` manifest → raw file through the already-successful docs deployment;
6. overwrite `examples/v1/latest.json` last;
7. fresh-read latest without cache and verify its size, content type, and SHA-256 before reporting success.

A failed create or pre-pointer verification leaves latest unchanged. A failed post-write latest verification fails publication loudly so operators do not treat an unverified pointer as successful. Retrying is safe only when the retained object is byte-identical. Revisions are never deleted or overwritten.

Run the publisher workflow manually only after the matching docs commit has deployed successfully. Supply that successful deployment's URL as `deployment_url`; the workflow performs pre-pointer verification there and then verifies the official discovery chain after latest advances.

### Enabling it

1. In the Vercel team owning the docs project, create a **public Vercel Blob store** and connect it to the docs project.
2. Disable every expiration/automatic-deletion lifecycle policy. Revision objects are permanent retained protocol state.
3. Create the GitHub environment `examples-api-production`. Add secret `VGPU_EXAMPLES_VERCEL_BLOB_READ_WRITE_TOKEN` with the store's read/write token.
4. Add environment variables `VGPU_EXAMPLES_ORIGIN=https://vgpu.sh` and `VGPU_EXAMPLES_BLOB_PREFIX=examples/v1` to that GitHub environment.
5. Add production variables to the Vercel docs project: `VGPU_EXAMPLES_ARTIFACT_STORE=blob` and `VGPU_EXAMPLES_VERCEL_BLOB_READ_WRITE_TOKEN=<same store token>`.
6. Deploy docs first, then run the publisher workflow with its `VERCEL_DEPLOYMENT_URL`.

Publishing the first revision into an empty store is required before flipping the docs project to `blob`: the mode is fail-closed, so a deployment in `blob` mode with no published objects serves errors rather than deployment files.

### Rollback

Rollback applies to the versioned mode only; on the default path, reverting the commit and redeploying is the rollback.

Rollback changes only `examples/v1/latest.json`; never remove or alter retained revision objects. Select a previously verified revision, fetch its immutable `index.json`, recompute its SHA-256, construct the strict latest document with that revision, official immutable `indexUrl`, and `indexSha256`, then overwrite only the latest Blob key with `allowOverwrite: true`, `addRandomSuffix: false`, and a 60-second cache age. Fresh-read the pointer and verify the official discovery → latest → index chain. Keep discovery unchanged unless contract status itself changes.

A rollback cannot point at a revision whose immutable index and complete object graph have not been fresh-read and hash-verified. Record the old/new revision, index hash, workflow run, and verification transcript in the incident log.

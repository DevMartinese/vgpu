export const examplesHelp = `vgpu examples — inspect canonical gallery source (never executes code)

Official origin: https://vgpu.sh

Usage:
  vgpu examples search <query> [--any] [--limit <n>] [--revision <sha256>] [--offline] [--pretty]
  vgpu examples show <id> [--revision <sha256>] [--offline] [--pretty]
  vgpu examples cat <id> <path> [--revision <sha256>] [--offline] [--json]
  vgpu examples pull <id> --out <directory> [--revision <sha256>] [--offline] [--force] [--pretty]
  vgpu examples cache path
  vgpu examples cache clear

Canonical agent invocation: npx vgpu examples ...

macOS and Windows use a per-invocation memory cache; --offline is unavailable.
`;

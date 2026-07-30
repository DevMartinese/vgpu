import type { ImportDecl } from "./parser.ts";
import type { MangleModule } from "./mangler.ts";
import type { AliasInfo, ModuleSymbols, ParsedDecls, Registry, StructInfo, SymbolTarget, WGSLType } from "./reflect-types.ts";
import { namespaceTypeError, unknownTypeError } from "./diagnostics.ts";

/**
 * Resolves an import declaration to the canonical path of the imported module, using the same
 * module resolution that loaded the graph (relative/root-alias/`packageMap`/`package.json`
 * `exports`). `resolveShader()` passes its resolver so bare package specifiers resolve for
 * nominal type positions exactly like they do for value positions in the mangler.
 */
export type ImportPathResolver = (from: string, imp: ImportDecl) => string;

export function buildModuleSymbols(modules: readonly MangleModule[], parsed: readonly ParsedDecls[], resolveImport?: ImportPathResolver): ReadonlyMap<string, ModuleSymbols> {
  const own = new Map<string, Map<string, SymbolTarget>>();
  for (const decls of parsed) {
    const map = new Map<string, SymbolTarget>();
    for (const item of [...decls.structs, ...decls.aliases]) {
      map.set(item.originalName, { path: item.path, name: item.originalName, mangledName: item.mangledName, kind: "members" in item ? "struct" : "alias" });
    }
    own.set(decls.structs[0]?.path ?? decls.aliases[0]?.path ?? decls.vars[0]?.path ?? "", map);
  }
  const byPath = new Map(modules.map((module) => [module.path, own.get(module.path) ?? new Map<string, SymbolTarget>()]));
  const result = new Map<string, ModuleSymbols>();
  for (const module of modules) {
    const map = new Map(byPath.get(module.path));
    for (const imp of module.parsed.imports) addImportedSymbols(module, imp, map, modules, byPath, resolveImport);
    result.set(module.path, map);
  }
  return result;
}

function addImportedSymbols(module: MangleModule, imp: ImportDecl, map: Map<string, SymbolTarget>, modules: readonly MangleModule[], byPath: ReadonlyMap<string, ReadonlyMap<string, SymbolTarget>>, resolveImport?: ImportPathResolver): void {
  const targetPath = resolveImportPath(imp, module.path, modules, resolveImport);
  const exports = byPath.get(targetPath);
  for (const binding of imp.bindings) {
    if (binding.namespace) {
      map.set(binding.local, { path: targetPath, name: binding.local, mangledName: binding.local, kind: "namespace" });
      continue;
    }
    const target = exports?.get(binding.imported);
    if (target) map.set(binding.local, target);
  }
}

export function buildRegistry(parsed: readonly ParsedDecls[], symbols: ReadonlyMap<string, ModuleSymbols>): Registry {
  const structs = new Map<string, StructInfo>();
  const aliases = new Map<string, AliasInfo>();
  const byMangled = new Map<string, StructInfo | AliasInfo>();
  const empty: Registry = { structs, aliases, byMangled };
  for (const decls of parsed) {
    for (const item of decls.structs) {
      const value: StructInfo = {
        name: item.name,
        mangledName: item.mangledName,
        members: item.members.map((member) => ({ name: member.name, type: resolveType(member.type, item.path, symbols, empty), align: member.align, size: member.size })),
      };
      structs.set(item.mangledName, value);
      byMangled.set(item.mangledName, value);
    }
    for (const item of decls.aliases) {
      const value: AliasInfo = { name: item.name, mangledName: item.mangledName, target: resolveType(item.target, item.path, symbols, empty) };
      aliases.set(item.mangledName, value);
      byMangled.set(item.mangledName, value);
    }
  }
  return { structs, aliases, byMangled };
}

export function resolveType(type: WGSLType, path: string, symbols: ReadonlyMap<string, ModuleSymbols>, registry: Registry): WGSLType {
  switch (type.kind) {
    case "identifier": {
      const dot = type.name.indexOf(".");
      if (dot > 0) {
        const ns = type.name.slice(0, dot);
        const target = symbols.get(path)?.get(ns);
        if (target?.kind === "namespace") throw namespaceTypeError(type.name, path);
      }
      const target = symbols.get(path)?.get(type.name);
      if (target?.kind === "namespace") throw namespaceTypeError(type.name, path);
      if (!target) throw unknownTypeError(type.name, path);
      return { kind: "identifier", name: target.name, mangledName: target.mangledName };
    }
    case "array":
    case "atomic":
    case "vector":
    case "matrix":
    case "ptr":
      return { ...type, element: resolveType(type.element, path, symbols, registry) };
    case "texture":
      return { ...type, sampleType: type.sampleType ? resolveType(type.sampleType, path, symbols, registry) : undefined };
    default:
      return type;
  }
}

export function unwrapAlias(type: WGSLType, registry?: Registry): WGSLType {
  if (!registry || type.kind !== "identifier") return type;
  const alias = registry.aliases.get(type.mangledName ?? type.name);
  return alias ? unwrapAlias(alias.target, registry) : type;
}

export function resolveAliasesDeep(type: WGSLType, registry: Registry): WGSLType {
  const unwrapped = unwrapAlias(type, registry);
  switch (unwrapped.kind) {
    case "array":
    case "atomic":
    case "vector":
    case "matrix":
    case "ptr":
      return { ...unwrapped, element: resolveAliasesDeep(unwrapped.element, registry) };
    case "texture":
      return { ...unwrapped, sampleType: unwrapped.sampleType ? resolveAliasesDeep(unwrapped.sampleType, registry) : undefined };
    default:
      return unwrapped;
  }
}

function resolveImportPath(imp: ImportDecl, owner: string, modules: readonly MangleModule[], resolveImport?: ImportPathResolver): string {
  const resolved = tryResolveImport(imp, owner, resolveImport);
  if (resolved !== undefined && modules.some((module) => module.path === resolved)) return resolved;
  const from = imp.from;
  const base = owner.slice(0, owner.lastIndexOf("/") + 1);
  const joined = from.startsWith("/") ? from : normalizeVirtualPath(`${base}${from}`);
  const candidates = [from, joined];
  return candidates.find((candidate) => modules.some((module) => module.path === candidate)) ?? resolved ?? joined;
}

/**
 * Bare specifiers (`@vgpu/wgsl-std/scene`) only resolve through the graph resolver, so failures
 * fall back to the relative/absolute heuristic below instead of aborting reflection.
 */
function tryResolveImport(imp: ImportDecl, owner: string, resolveImport?: ImportPathResolver): string | undefined {
  if (!resolveImport) return undefined;
  try {
    return resolveImport(owner, imp);
  } catch {
    return undefined;
  }
}

function normalizeVirtualPath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

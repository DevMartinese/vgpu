import { uniqueByPath } from "../index.js";
import { fail, ok } from "./shared.js";

// Agents type prose, not identifiers: the dogfood experiment searched "wgsl import", "typescript
// wgsl", "next.js", "declare module". A single-substring match over symbol+path answered none of
// them, so find works in three widening steps: every whitespace token must match (1) the route
// text — symbol, title and the doc's declared keywords, (2) the doc paths, and only when both come
// back empty (3) the doc body, which is what makes error codes and prose phrases findable.
const CONTENT_HIT_LIMIT = 20;

export function findCommand(index, args) {
  if (args.includes("--help") || args.includes("-h")) return ok("Usage: vgpu docs find <query>");
  if (args.length !== 1) return fail("Usage: vgpu docs find <query>");
  const tokens = args[0].toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return fail(`No docs found for: ${args[0]}`);

  const matchesAll = (haystack) => tokens.every((token) => haystack.includes(token));
  const symbolHits = index.records
    .filter((record) => matchesAll(symbolText(record)))
    .map((record) => `${record.symbol}\t${record.package}\t${record.virtualPath}`);
  const pathHits = uniqueByPath(index.records)
    .filter((record) => matchesAll(pathText(record)))
    .map(pathLine);
  const routeHits = [...new Set([...symbolHits, ...pathHits])].sort();
  if (routeHits.length > 0) return ok(routeHits);

  const contentHits = [...new Set(uniqueByPath(index.records)
    .filter((record) => matchesAll(record.content.toLowerCase()))
    .map(pathLine))].sort();
  return contentHits.length > 0 ? ok(contentHits.slice(0, CONTENT_HIT_LIMIT)) : fail(`No docs found for: ${args[0]}`);
}

function symbolText(record) {
  return `${record.symbol}\n${record.topicTitle ?? ""}\n${keywordText(record)}`.toLowerCase();
}

function pathText(record) {
  return `${record.virtualPath}\n${record.repoPath}\n${keywordText(record)}`.toLowerCase();
}

function keywordText(record) {
  return (record.keywords ?? []).join("\n");
}

function pathLine(record) {
  return `${record.virtualPath}\t${record.repoPath}`;
}

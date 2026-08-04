import { createProxy } from "@vercel/geistdocs/proxy";
import { config as geistdocsConfig } from "@/lib/geistdocs/config";
import { trackMdRequest } from "@/lib/geistdocs/md-tracking";

const proxy = createProxy({
  config: geistdocsConfig,
  trackMarkdownRequest: trackMdRequest,
  before: () => null,
});

// ANCHOR TGEIST-06 (examples API transplant): `.well-known/vgpu-examples.json` is excluded from the
// proxy. It is the examples API discovery endpoint that published vgpu CLIs already request by
// absolute path, so it must resolve to app/.well-known/vgpu-examples.json/route.ts exactly as it
// does on the old app -- while the proxy is active on it, the i18n rewrite sends it to a localized
// path that has no route and it answers 404 (verified against this scaffold: 404 text/html before
// this entry, 200 application/json with the old app's exact bytes after). The exclusion is
// deliberately the single literal path and NOT all of `.well-known/`: `.well-known/mcp.json` is a
// localized geistdocs route under app/[lang]/, so excluding the whole directory would widen this
// ticket into that route's behaviour for no reason.
// ANCHOR TGEIST-08 (previews verbatim): `/preview/**` is excluded from the proxy, for the same
// reason and with the same evidence as the TGEIST-06 entry above. `app/preview/[slug]` is a
// non-localized route (transplanted byte-for-byte from apps/docs, where there is no i18n at all),
// so while the proxy is active on it the i18n rewrite sends `/preview/gradient` to
// `/en/preview/gradient`, which no route matches. Verified empirically against `next start` on this
// build: 404 with `x-middleware-rewrite: /en/preview/gradient` before this entry, 200 with the
// prerendered canvas after it. These URLs are the render targets of `render-example-thumbs.mjs`
// (`thumbs:check` / `render:proof`, gate G6) and of the gallery iframes, so they must keep
// resolving at exactly the path the old app serves -- a localized variant would change the URL
// contract those PNG baselines were captured against.
// The pattern is `preview/` and NOT `preview(?:/|$)` on purpose: there is no page at bare
// `/preview`, so excluding it from the proxy left it to the global not-found, which resolves inside
// `app/[lang]/` without a `lang` param and threw (500 instead of the old app's 404). Requiring the
// slash keeps the bare path on the proxy, where geistdocs answers its normal localized 404, and
// still cannot over-match a sibling like `/previewfoo`. Verified on this build: `/preview` 404,
// `/preview/gradient` 200, `/previewfoo` proxied.
export const config = {
  matcher: [
    "/((?!api(?:/|$)|.well-known/vgpu-examples.json(?:/|$)|preview/|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};

export default proxy;

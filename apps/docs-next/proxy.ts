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
export const config = {
  matcher: [
    "/((?!api(?:/|$)|.well-known/vgpu-examples.json(?:/|$)|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};

export default proxy;

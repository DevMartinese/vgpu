import { describe, expect, test } from "vitest";
import { assertTrustedUrl, trustedOrigin } from "../../lib/examples/http.js";

// The host allowlist is the CLI's only defence against being pointed at an attacker's origin:
// `redirect: 'error'` stops a server from redirecting the client away, and `assertTrustedUrl`
// stops it from embedding foreign URLs, but neither helps if a hostile base URL is trusted in
// the first place. These probes pin that boundary.

describe("examples host allowlist", () => {
  test("accepts exactly the two official hosts", () => {
    expect(trustedOrigin("https://vgpu.sh")).toBe("https://vgpu.sh");
    expect(trustedOrigin("https://vgpu.labs.vercel.dev")).toBe("https://vgpu.labs.vercel.dev");
  });

  test.each([
    // www redirects to the apex, and `redirect: 'error'` makes it permanently unusable.
    ["www subdomain", "https://www.vgpu.sh"],
    // Suffix/prefix confusion: the allowlist must compare whole hostnames, never substrings.
    ["suffix attack", "https://vgpu.sh.evil.com"],
    ["prefix attack", "https://evilvgpu.sh"],
    ["lookalike", "https://not-vgpu.sh"],
    ["other subdomain", "https://sub.vgpu.sh"],
    // Punycode homograph of a visually similar domain.
    ["homograph (punycode)", "https://xn--vgpu-2h6a.sh"],
    // A trailing dot is the DNS-absolute form of the same name, but it is a different string
    // and would break the exact-match `assertTrustedUrl` comparison later.
    ["trailing dot", "https://vgpu.sh."],
    ["non-default port", "https://vgpu.sh:8443"],
    ["plaintext http", "http://vgpu.sh"],
    ["embedded credentials", "https://user:pw@vgpu.sh"],
    ["query string", "https://vgpu.sh?a=1"],
    ["fragment", "https://vgpu.sh#f"],
    ["non-http scheme", "ftp://vgpu.sh"],
  ])("rejects %s", (_label, origin) => {
    expect(() => trustedOrigin(origin)).toThrow();
  });

  test("accepts an uppercase host because URL lowercases it", () => {
    // Case folding is a property of URL parsing, not a hole in the allowlist: the value is
    // normalized to the canonical origin before it is ever compared or concatenated.
    expect(trustedOrigin("https://VGPU.SH")).toBe("https://vgpu.sh");
  });

  test("silently drops a path instead of rejecting it", () => {
    // Characterization, not endorsement: `trustedOrigin` returns `URL.origin`, so a base URL
    // with a path is accepted and the path is discarded rather than reported. Safe today
    // because the discarded value cannot widen the origin, but it hides operator typos.
    expect(trustedOrigin("https://vgpu.sh/some/prefix")).toBe("https://vgpu.sh");
  });

  test("does not actually recognise the IPv6 loopback", () => {
    // Pre-existing and cosmetic: Node sets `hostname` to '[::1]' with brackets, so the '::1'
    // entry in the loopback list never matches and a misleading HTTPS error fires first.
    expect(new URL("http://[::1]:8080").hostname).toBe("[::1]");
    expect(() => trustedOrigin("http://[::1]:8080")).toThrow(/Examples API requires HTTPS/);
    expect(() => trustedOrigin("https://[::1]")).toThrow(/Untrusted examples API host/);
  });

  test("still requires an exact origin match on embedded URLs", () => {
    // Trusting two hosts must not let a payload from one reference the other: each client
    // instance is pinned to the single origin it was constructed with.
    expect(() => assertTrustedUrl("https://vgpu.sh/api/examples/v1/latest.json", "https://vgpu.labs.vercel.dev"))
      .toThrow(/leaves trusted origin/);
    expect(() => assertTrustedUrl("https://www.vgpu.sh/api/examples/v1/latest.json", "https://vgpu.sh"))
      .toThrow(/leaves trusted origin/);
    expect(assertTrustedUrl("https://vgpu.sh/api/examples/v1/latest.json", "https://vgpu.sh"))
      .toBe("https://vgpu.sh/api/examples/v1/latest.json");
  });
});

import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("example ZIP route", () => {
  it("downloads the source under an example directory", async () => {
    const response = await GET(new Request("https://vgpu.sh/examples/gradient/download"), {
      params: Promise.resolve({ lang: "en", slug: "gradient" }),
    });
    const archive = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(archive.buffer);
    const compressedSize = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const name = new TextDecoder().decode(archive.slice(30, 30 + nameLength));
    const content = inflateRawSync(
      archive.slice(30 + nameLength, 30 + nameLength + compressedSize),
    ).toString();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="gradient.zip"',
    );
    expect(name).toBe("gradient/index.tsx");
    expect(content).toContain("export function Example()");
  });
});

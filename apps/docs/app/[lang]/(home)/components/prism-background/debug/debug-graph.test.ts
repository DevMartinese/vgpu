import { describe, expect, it, vi } from "vitest";

import {
  createPrismDebugPreviewRelay,
  NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
  type PrismDebugPreviewBridge,
} from "./preview-bridge";
import {
  PRISM_DARK_DEBUG_SOURCES,
  PRISM_DARK_DEBUG_SOURCE_IDS,
  PRISM_DEBUG_SOURCES,
  PRISM_DEBUG_SOURCE_IDS,
} from "./sources";
import { createDebugGraphModel } from "./graph/model";
import { DEFAULT_PRISM_CONTROLS } from "../types";

describe("prism debug graph descriptors", () => {
  it("keeps separate light and dark graphs internally resolvable", () => {
    expectGraph(PRISM_DEBUG_SOURCES, PRISM_DEBUG_SOURCE_IDS);
    expectGraph(PRISM_DARK_DEBUG_SOURCES, PRISM_DARK_DEBUG_SOURCE_IDS);
  });

  it("embeds controls into meaningful render nodes", () => {
    expect(PRISM_DEBUG_SOURCES.some(({ kind }) => kind === "control")).toBe(
      false
    );
    expect(
      PRISM_DARK_DEBUG_SOURCES.some(({ kind }) => kind === "control")
    ).toBe(false);
  });

  it.each([
    ["light", PRISM_DEBUG_SOURCES],
    ["dark", PRISM_DARK_DEBUG_SOURCES],
  ] as const)(
    "lays %s dependencies left of their consumers",
    (mode, sources) => {
      const { edges, nodes } = createDebugGraphModel(
        sources,
        NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
        mode
      );
      const xById = new Map(nodes.map((node) => [node.id, node.position.x]));

      expect(edges).toHaveLength(
        sources.reduce((count, source) => count + source.inputs.length, 0)
      );
      for (const edge of edges) {
        expect(edge.label).toEqual(expect.any(String));
        expect(xById.get(edge.source)).toBeLessThan(
          xById.get(edge.target) ?? 0
        );
      }
    }
  );

  it("keeps production controls out of preview node data", () => {
    const { nodes } = createDebugGraphModel(
      PRISM_DEBUG_SOURCES,
      NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
      "light"
    );
    for (const node of nodes) {
      expect(node.data).not.toHaveProperty("controls");
      expect(node.data).not.toHaveProperty("onControlsChange");
    }
    expect(DEFAULT_PRISM_CONTROLS.view).toBe("glass");
    expect(DEFAULT_PRISM_CONTROLS.wireframe).toBe(false);
    expect(DEFAULT_PRISM_CONTROLS.lightWireframe).toBe(false);
    expect(DEFAULT_PRISM_CONTROLS.environmentDebug).toBe(false);
  });

  it.each([
    ["light", PRISM_DEBUG_SOURCES],
    ["dark", PRISM_DARK_DEBUG_SOURCES],
  ] as const)(
    "keeps %s nodes pointer-interactive without enabling drag",
    (mode, sources) => {
      const { nodes } = createDebugGraphModel(
        sources,
        NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
        mode
      );

      for (const node of nodes) {
        expect(node.style?.pointerEvents).toBe("all");
        expect(node.draggable).toBe(false);
      }
    }
  );
});

describe("prism debug preview bridge", () => {
  it("returns an imperative cleanup without reading canvas pixels", () => {
    const detach = NOOP_PRISM_DEBUG_PREVIEW_BRIDGE.attachPreview({
      canvas: {} as HTMLCanvasElement,
      source: PRISM_DEBUG_SOURCES[0],
    });
    expect(detach).toEqual(expect.any(Function));
    expect(() => detach()).not.toThrow();
  });

  it("supports renderer-owned attach and detach callbacks", () => {
    const detach = vi.fn();
    const attachPreview = vi.fn(() => detach);
    const bridge: PrismDebugPreviewBridge = { attachPreview };
    const registration = {
      canvas: {} as HTMLCanvasElement,
      source: PRISM_DEBUG_SOURCES[0],
    };

    bridge.attachPreview(registration)();
    expect(attachPreview).toHaveBeenCalledWith(registration);
    expect(detach).toHaveBeenCalledOnce();
  });

  it("retains registrations while the GPU provider loads", () => {
    const relay = createPrismDebugPreviewRelay();
    const detach = vi.fn();
    const attachPreview = vi.fn(() => detach);
    const registration = {
      canvas: {} as HTMLCanvasElement,
      source: PRISM_DEBUG_SOURCES[0],
    };

    const unregister = relay.bridge.attachPreview(registration);
    relay.setDelegate({ attachPreview });
    expect(attachPreview).toHaveBeenCalledWith(registration);

    unregister();
    expect(detach).toHaveBeenCalledOnce();
    relay.dispose();
  });

  it("moves each live canvas exactly once when the provider changes", () => {
    const relay = createPrismDebugPreviewRelay();
    const firstDetach = vi.fn();
    const secondDetach = vi.fn();
    const canvas = {} as HTMLCanvasElement;
    const registration = { canvas, source: PRISM_DEBUG_SOURCES[0] };
    const staleUnregister = relay.bridge.attachPreview(registration);

    relay.setDelegate({ attachPreview: () => firstDetach });
    const activeUnregister = relay.bridge.attachPreview(registration);
    staleUnregister();
    expect(firstDetach).toHaveBeenCalledOnce();

    relay.setDelegate({ attachPreview: () => secondDetach });
    activeUnregister();
    expect(secondDetach).toHaveBeenCalledOnce();
  });
});

function expectGraph(
  sources: typeof PRISM_DEBUG_SOURCES | typeof PRISM_DARK_DEBUG_SOURCES,
  expectedIds: readonly string[]
): void {
  const ids = sources.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(expectedIds);
  const known = new Set(ids);
  for (const source of sources) {
    for (const input of source.inputs) {
      expect(known.has(input.source), `${source.id} <- ${input.source}`).toBe(
        true
      );
    }
  }
}

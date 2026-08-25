import { describe, expect, it, vi } from "vitest";

import {
  createPrismDebugPreviewRelay,
  NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
  type PrismDebugPreviewBridge,
} from "./preview-bridge";
import {
  PRISM_DEBUG_SOURCES,
  PRISM_DEBUG_SOURCE_IDS,
} from "./sources";
import { createDebugGraphModel } from "./graph/model";

describe("prism debug graph descriptors", () => {
  it("keeps ids unique and every dependency resolvable", () => {
    const ids = PRISM_DEBUG_SOURCES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(PRISM_DEBUG_SOURCE_IDS);

    const known = new Set(ids);
    for (const source of PRISM_DEBUG_SOURCES) {
      for (const input of source.inputs) {
        expect(known.has(input.source), `${source.id} <- ${input.source}`).toBe(
          true
        );
      }
    }
  });

  it("lays dependencies left of their consumers and labels every edge", () => {
    const { edges, nodes } = createDebugGraphModel(
      PRISM_DEBUG_SOURCES,
      NOOP_PRISM_DEBUG_PREVIEW_BRIDGE
    );
    const xById = new Map(nodes.map((node) => [node.id, node.position.x]));

    expect(edges).toHaveLength(
      PRISM_DEBUG_SOURCES.reduce(
        (count, source) => count + source.inputs.length,
        0
      )
    );
    for (const edge of edges) {
      expect(edge.label).toEqual(expect.any(String));
      expect(xById.get(edge.source)).toBeLessThan(xById.get(edge.target) ?? 0);
    }
  });
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

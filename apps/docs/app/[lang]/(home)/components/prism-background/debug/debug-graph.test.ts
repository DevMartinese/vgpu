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
import { createDebugGraphModel, estimatedNodeHeight } from "./graph/model";
import { layoutDebugGraphModel } from "./graph/elk-layout";
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

  it.each([
    ["light", PRISM_DEBUG_SOURCES],
    ["dark", PRISM_DARK_DEBUG_SOURCES],
  ] as const)(
    "auto-layouts the %s graph without node overlap or routed edge crossings",
    async (mode, sources) => {
      const model = await layoutDebugGraphModel(
        createDebugGraphModel(
          sources,
          NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
          mode
        )
      );
      const rectangles = new Map(
        model.nodes.map((node) => [
          node.id,
          {
            left: node.position.x,
            right: node.position.x + 280,
            top: node.position.y,
            bottom:
              node.position.y +
              estimatedNodeHeight(node.data.source, node.data.mode),
          },
        ])
      );
      const entries = [...rectangles.entries()];

      for (let index = 0; index < entries.length; index++) {
        for (let other = index + 1; other < entries.length; other++) {
          expect(overlaps(entries[index][1], entries[other][1])).toBe(false);
        }
      }

      for (const edge of model.edges) {
        const points = parsePath(edge.data?.path);
        expect(points.length).toBeGreaterThan(1);
        for (let index = 1; index < points.length; index++) {
          for (const [nodeId, rectangle] of rectangles) {
            if (nodeId === edge.source || nodeId === edge.target) continue;
            expect(
              segmentCrossesInterior(
                points[index - 1],
                points[index],
                rectangle
              )
            ).toBe(false);
          }
        }
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

type Point = { x: number; y: number };
type Rectangle = { left: number; right: number; top: number; bottom: number };

function overlaps(first: Rectangle, second: Rectangle): boolean {
  return !(
    first.right <= second.left ||
    second.right <= first.left ||
    first.bottom <= second.top ||
    second.bottom <= first.top
  );
}

function parsePath(path: string | undefined): Point[] {
  if (!path) return [];
  const values = [...path.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)];
  return values.map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

function segmentCrossesInterior(
  start: Point,
  end: Point,
  rectangle: Rectangle
): boolean {
  if (start.x === end.x) {
    return (
      start.x > rectangle.left &&
      start.x < rectangle.right &&
      Math.max(start.y, end.y) > rectangle.top &&
      Math.min(start.y, end.y) < rectangle.bottom
    );
  }
  if (start.y === end.y) {
    return (
      start.y > rectangle.top &&
      start.y < rectangle.bottom &&
      Math.max(start.x, end.x) > rectangle.left &&
      Math.min(start.x, end.x) < rectangle.right
    );
  }
  return true;
}

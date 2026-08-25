import type GUI from "lil-gui";
import { expect, test, vi } from "vitest";

import { DEFAULT_GLASS_TRANSMISSION } from "../types";
import { addTransmissionFolders, transmissionGuiValues } from "./transmission";

function guiDouble(path: string, folders: string[], controls: string[]) {
  const controller = {
    name: vi.fn().mockReturnThis(),
    onChange: vi.fn().mockReturnThis(),
  };
  return {
    addFolder(name: string) {
      const child = path ? `${path} > ${name}` : name;
      folders.push(child);
      return guiDouble(child, folders, controls);
    },
    add(_values: unknown, property: string) {
      controls.push(`${path} > ${property}`);
      return controller;
    },
  };
}

test("builds Dark and Light transmission folders with the same controls", () => {
  const folders: string[] = [];
  const controls: string[] = [];
  const gui = guiDouble("Glass", folders, controls) as unknown as GUI;

  const controllers = addTransmissionFolders(
    gui,
    transmissionGuiValues(DEFAULT_GLASS_TRANSMISSION),
    vi.fn()
  );

  expect(folders).toEqual([
    "Glass > Transmission",
    "Glass > Transmission > Dark",
    "Glass > Transmission > Light",
  ]);
  expect(controls).toEqual([
    "Glass > Transmission > Dark > ior",
    "Glass > Transmission > Dark > absorptionR",
    "Glass > Transmission > Dark > absorptionG",
    "Glass > Transmission > Dark > absorptionB",
    "Glass > Transmission > Light > ior",
    "Glass > Transmission > Light > absorptionR",
    "Glass > Transmission > Light > absorptionG",
    "Glass > Transmission > Light > absorptionB",
  ]);
  expect(controllers).toHaveLength(8);
});

import type GUI from "lil-gui";
import { expect, test, vi } from "vitest";

import { DEFAULT_GLASS_CONTROLS } from "../types";
import { addReflectionFolders, reflectionGuiValues } from "./reflection";

function guiDouble(path: string, folders: string[], controls: string[]) {
  const controller = {
    name: vi.fn().mockReturnThis(),
    onChange: vi.fn().mockReturnThis(),
  };
  return {
    addFolder(name: string) {
      const child = `${path} > ${name}`;
      folders.push(child);
      return guiDouble(child, folders, controls);
    },
    add(_values: unknown, property: string) {
      controls.push(`${path} > ${property}`);
      return controller;
    },
  };
}

test("shows the independent Dark and Light reflection values", () => {
  const folders: string[] = [];
  const controls: string[] = [];
  const gui = guiDouble("Glass", folders, controls) as unknown as GUI;
  const values = reflectionGuiValues(DEFAULT_GLASS_CONTROLS.reflection);

  const controllers = addReflectionFolders(gui, values, vi.fn());

  expect(values).toEqual({
    dark: { reflectionStrength: 2.14, environmentExposure: 2.3 },
    light: { reflectionStrength: 3, environmentExposure: 4 },
  });
  expect(folders).toEqual([
    "Glass > Reflection",
    "Glass > Reflection > Dark",
    "Glass > Reflection > Light",
  ]);
  expect(controls).toEqual([
    "Glass > Reflection > Dark > reflectionStrength",
    "Glass > Reflection > Dark > environmentExposure",
    "Glass > Reflection > Light > reflectionStrength",
    "Glass > Reflection > Light > environmentExposure",
  ]);
  expect(controllers).toHaveLength(4);
});

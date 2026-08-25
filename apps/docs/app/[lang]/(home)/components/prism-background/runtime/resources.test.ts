import { expect, test, vi } from "vitest";

const environment = vi.hoisted(() => ({
  create: vi.fn((_gpu: unknown, label: string) => ({ label })),
  prepare: vi.fn(),
}));

vi.mock("../environment-texture", () => ({
  createEnvironmentSampler: vi.fn(),
  createEnvironmentTexture: environment.create,
  destroyEnvironmentTexture: vi.fn(),
  prepareEnvironmentTexture: environment.prepare,
}));

import { prepareRuntimeEnvironment } from "./resources";
import type { PrismRuntime } from "./types";

test("environment preparation waits for both bakes before preserving the first failure", async () => {
  const lateBake = deferred<void>();
  const firstFailure = new Error("studio bake failed");
  environment.prepare.mockImplementation(
    (_gpu: unknown, value: { label: string }) =>
      value.label.endsWith("environment-studio")
        ? Promise.reject(firstFailure)
        : lateBake.promise
  );
  const runtime = {
    gpu: {},
    label: "lifecycle-test",
    environmentSampler: {},
  } as PrismRuntime;

  const ready = prepareRuntimeEnvironment(runtime);
  let settled = false;
  void ready.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  const rejection = expect(ready).rejects.toBe(firstFailure);
  await settleMicrotasks();
  expect(settled).toBe(false);

  lateBake.resolve();
  await rejection;
  expect(settled).toBe(true);
  expect(prepareRuntimeEnvironment(runtime)).toBe(ready);
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

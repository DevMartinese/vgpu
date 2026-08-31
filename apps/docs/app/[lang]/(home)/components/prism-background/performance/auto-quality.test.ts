import type { TierResult } from "@pmndrs/detect-gpu";
import { expect, test, vi } from "vitest";

import {
  batteryRequestsLow,
  createPrismAutoQualityController,
  gpuTierRequestsLow,
} from "./auto-quality";

const tier = (type: TierResult["type"], value: number): TierResult => ({
  type,
  tier: value,
});

test.each([
  ["BENCHMARK", 0, true],
  ["BENCHMARK", 1, true],
  ["BENCHMARK", 2, false],
  ["BENCHMARK", 3, false],
  ["BLOCKLISTED", 0, true],
  ["FALLBACK", 1, false],
  ["BENCHMARK_FETCH_FAILED", 1, false],
  ["WEBGL_UNSUPPORTED", 0, false],
  ["SSR", 0, false],
] as const)("maps %s tier %d to downgrade=%s", (type, value, expected) => {
  expect(gpuTierRequestsLow(tier(type, value))).toBe(expected);
});

test("an unknown/new FALLBACK tier 1 GPU remains High", () => {
  expect(gpuTierRequestsLow(tier("FALLBACK", 1))).toBe(false);
});

test.each([
  [{ level: 0.3, charging: false }, true],
  [{ level: 0.3001, charging: false }, false],
  [{ level: 0.1, charging: true }, false],
] as const)("evaluates battery state %o", (battery, expected) => {
  expect(batteryRequestsLow(battery)).toBe(expected);
});

class FakeBattery extends EventTarget {
  charging = true;
  level = 1;
}

test("battery changes downgrade only after becoming unplugged at 30%", async () => {
  const battery = new FakeBattery();
  battery.level = 0.3;
  const onDowngrade = vi.fn();
  const controller = createPrismAutoQualityController({
    navigator: { getBattery: async () => battery },
    loadGpuTier: async () => tier("FALLBACK", 1),
    onDowngrade,
  });
  await Promise.resolve();
  expect(onDowngrade).not.toHaveBeenCalled();

  battery.charging = false;
  battery.dispatchEvent(new Event("chargingchange"));
  expect(onDowngrade).toHaveBeenCalledWith("battery");
  controller.dispose();
});

test("battery listeners are cleaned up and unsupported/rejected APIs are ignored", async () => {
  const battery = new FakeBattery();
  const add = vi.spyOn(battery, "addEventListener");
  const remove = vi.spyOn(battery, "removeEventListener");
  const onDowngrade = vi.fn();
  const controller = createPrismAutoQualityController({
    navigator: { getBattery: async () => battery },
    loadGpuTier: async () => tier("FALLBACK", 1),
    onDowngrade,
  });
  await Promise.resolve();
  expect(add).toHaveBeenCalledTimes(2);
  controller.dispose();
  expect(remove).toHaveBeenCalledTimes(2);

  expect(() =>
    createPrismAutoQualityController({
      navigator: {},
      loadGpuTier: async () => tier("FALLBACK", 1),
      onDowngrade,
    }).dispose()
  ).not.toThrow();
  createPrismAutoQualityController({
    navigator: { getBattery: async () => Promise.reject(new Error("denied")) },
    loadGpuTier: async () => tier("FALLBACK", 1),
    onDowngrade,
  });
  await Promise.resolve();
  expect(onDowngrade).not.toHaveBeenCalled();
});

test("tier 2 waits for runtime-health confirmation", async () => {
  const onDowngrade = vi.fn();
  const healthMonitor = {
    record: vi.fn(() => ({
      downgrade: true,
      estimatedRefreshFps: 60,
      targetFps: 60,
    })),
    reset: vi.fn(),
  };
  const controller = createPrismAutoQualityController({
    navigator: {},
    loadGpuTier: async () => tier("BENCHMARK", 2),
    healthMonitor,
    onDowngrade,
  });
  await Promise.resolve();
  expect(onDowngrade).not.toHaveBeenCalled();
  controller.recordFrame({
    deltaMs: 16,
    active: true,
    rendered: false,
    mobile: false,
    workload: "interactive",
  });
  expect(onDowngrade).toHaveBeenCalledWith("runtime");
  controller.dispose();
});

test("detector failures and late results after disposal are ignored", async () => {
  let resolveTier!: (result: TierResult) => void;
  const pending = new Promise<TierResult>((resolve) => {
    resolveTier = resolve;
  });
  const onDowngrade = vi.fn();
  const controller = createPrismAutoQualityController({
    navigator: {},
    loadGpuTier: () => pending,
    onDowngrade,
  });
  controller.dispose();
  resolveTier(tier("BLOCKLISTED", 0));
  await pending;
  await Promise.resolve();
  expect(onDowngrade).not.toHaveBeenCalled();

  createPrismAutoQualityController({
    navigator: {},
    loadGpuTier: async () => Promise.reject(new Error("offline")),
    onDowngrade,
  });
  await Promise.resolve();
  expect(onDowngrade).not.toHaveBeenCalled();
});

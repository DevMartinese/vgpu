import type { TierResult } from "@pmndrs/detect-gpu";

import type { PrismQualityReason } from "../pipelines/types";
import {
  createPrismFrameHealthMonitor,
  type PrismFrameHealthMonitor,
  type PrismFrameHealthSample,
} from "./frame-health";

const BENCHMARKS_URL = "/prism-gpu-benchmarks";
const LOW_BATTERY_LEVEL = 0.3;

interface BatteryManagerLike extends EventTarget {
  readonly charging: boolean;
  readonly level: number;
}

interface NavigatorWithBattery {
  getBattery?(): Promise<BatteryManagerLike>;
}

export interface PrismAutoQualityController {
  recordFrame(sample: PrismFrameHealthSample): void;
  resetHealth(): void;
  dispose(): void;
}

export interface PrismAutoQualityControllerOptions {
  onDowngrade(reason: Extract<PrismQualityReason, "gpu-tier" | "battery" | "runtime">): void;
  /** Test seam; production uses the browser navigator. */
  readonly navigator?: NavigatorWithBattery;
  /** Test seam; production imports detect-gpu only after this module loads. */
  loadGpuTier?(): Promise<TierResult>;
  /** Test seam for deterministic health policy tests. */
  readonly healthMonitor?: PrismFrameHealthMonitor;
}

/**
 * Starts all Auto signals. This module itself is imported only after the first
 * successful High frame; detect-gpu is a second dynamic import so neither its
 * code nor its vendor benchmark request can delay that frame.
 */
export function createPrismAutoQualityController(
  options: PrismAutoQualityControllerOptions
): PrismAutoQualityController {
  let disposed = false;
  let downgraded = false;
  let battery: BatteryManagerLike | undefined;
  const health = options.healthMonitor ?? createPrismFrameHealthMonitor();
  const browserNavigator =
    options.navigator ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as NavigatorWithBattery));

  const requestLow = (
    reason: Extract<PrismQualityReason, "gpu-tier" | "battery" | "runtime">
  ) => {
    if (disposed || downgraded) return;
    downgraded = true;
    options.onDowngrade(reason);
  };

  const loadGpuTier =
    options.loadGpuTier ??
    (async () => {
      const { getGPUTier } = await import("@pmndrs/detect-gpu");
      return getGPUTier({ benchmarksURL: BENCHMARKS_URL });
    });
  void Promise.resolve()
    .then(loadGpuTier)
    .then((result) => {
      if (gpuTierRequestsLow(result)) requestLow("gpu-tier");
    })
    .catch(() => {
      // Imports, WebGL probing, and benchmark fetches are advisory in Auto.
    });

  const onBatteryChange = () => {
    if (batteryRequestsLow(battery)) requestLow("battery");
  };
  let batteryPromise: Promise<BatteryManagerLike> | undefined;
  try {
    batteryPromise = browserNavigator?.getBattery?.();
  } catch {
    batteryPromise = undefined;
  }
  if (batteryPromise) {
    void batteryPromise
      .then((manager) => {
        if (disposed) return;
        battery = manager;
        onBatteryChange();
        if (downgraded) return;
        manager.addEventListener("levelchange", onBatteryChange);
        manager.addEventListener("chargingchange", onBatteryChange);
      })
      .catch(() => {
        // The Battery Status API is optional and commonly unavailable.
      });
  }

  return {
    recordFrame(sample) {
      if (disposed || downgraded) return;
      if (health.record(sample).downgrade) requestLow("runtime");
    },
    resetHealth() {
      if (!disposed && !downgraded) health.reset();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      battery?.removeEventListener("levelchange", onBatteryChange);
      battery?.removeEventListener("chargingchange", onBatteryChange);
      battery = undefined;
    },
  };
}

/** Only benchmark-backed low tiers and the library blocklist are authoritative. */
export function gpuTierRequestsLow(
  result: Pick<TierResult, "tier" | "type">
): boolean {
  return (
    result.type === "BLOCKLISTED" ||
    (result.type === "BENCHMARK" && result.tier <= 1)
  );
}

/** Inclusive 30% threshold, ignored while the device is plugged in. */
export function batteryRequestsLow(
  battery: Pick<BatteryManagerLike, "charging" | "level"> | undefined
): boolean {
  return (
    battery?.charging === false &&
    Number.isFinite(battery.level) &&
    battery.level <= LOW_BATTERY_LEVEL
  );
}

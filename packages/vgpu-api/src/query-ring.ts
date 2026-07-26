import type { Buffer, Device } from "@vgpu/core";

/**
 * Bytes each resolved query occupies: WebGPU resolveQuerySet writes each result
 * "into a GPUBuffer ... as a 64-bit unsigned integer" (8 bytes per query).
 *
 * @internal
 */
export const QUERY_RESULT_BYTES = 8;

/** GPUMapMode.READ; numeric fallback covers headless/mock runtimes without the global. */
const MAP_READ = (globalThis.GPUMapMode?.READ ?? 1) as GPUMapModeFlags;

/**
 * Options for the internal query resolve/readback ring shared by query-based
 * features (gpu.timer today, occlusion queries next).
 *
 * @internal
 */
export interface QueryRingOptions {
  /** GPUQuerySetDescriptor.type — "timestamp" for pass timing, "occlusion" for occlusion queries. */
  readonly type: GPUQueryType;
  /** Query count of the owned GPUQuerySet. WebGPU createQuerySet requires "descriptor.count must be ≤ 4096". */
  readonly capacity: number;
  readonly label?: string;
  /** Staging buffers rotated per resolve (frames in flight + 1). Defaults to 3. */
  readonly depth?: number;
  /** Registers each pending readback so gpu.settled() covers in-flight maps. */
  readonly trackSettled?: (promise: Promise<unknown>) => void;
}

/**
 * Internal ownership boundary for query readback plumbing. The ring knows nothing
 * about span names, frames, or timers — it owns the GPUQuerySet, one resolve buffer
 * (usage query_resolve|copy_src), and `depth` parity-rotated staging buffers
 * (usage map_read|copy_dst), and turns "resolve the used range, then read it back
 * without ever blocking" into two calls that bracket a queue submission.
 *
 * @internal
 */
export interface QueryRing {
  readonly querySet: GPUQuerySet;
  /** Query capacity of the owned set (immutable; consumers recreate the ring to grow). */
  readonly capacity: number;
  /**
   * Appends one resolveQuerySet of the contiguous used range [0, usedCount) plus a
   * copyBufferToBuffer into the next staging buffer to an encoder that is about to be
   * finished and submitted. Returns false — encoding nothing — when usedCount is 0 or
   * the next staging buffer is still map-pending: the readback is dropped, never blocked on.
   */
  encodeResolve(encoder: GPUCommandEncoder, usedCount: number): boolean;
  /**
   * Call after the encoder from the last successful encodeResolve was submitted: starts the
   * non-blocking mapAsync readback. `apply` receives the decoded u64 values (one per resolved
   * query); readbacks apply in order — a stale readback that lands after a newer one already
   * applied is discarded. No-op when the preceding encodeResolve returned false.
   */
  onSubmitted(apply: (values: BigUint64Array) => void): void;
  /**
   * Stops new encodes/readbacks. In-flight readbacks still decode and apply (so results are
   * not lost when a consumer retires a ring to grow capacity); GPU resources are destroyed
   * once the last in-flight map settles.
   */
  dispose(): void;
}

/** @internal */
export function createQueryRing(device: Device, options: QueryRingOptions): QueryRing {
  return new InternalQueryRing(device, options);
}

interface StagingSlot {
  readonly buffer: Buffer;
  mapPending: boolean;
}

interface PendingEncode {
  readonly staging: StagingSlot;
  readonly usedCount: number;
  readonly seq: number;
}

class InternalQueryRing implements QueryRing {
  readonly querySet: GPUQuerySet;
  readonly capacity: number;
  readonly #resolve: Buffer;
  readonly #stagings: readonly StagingSlot[];
  readonly #trackSettled?: (promise: Promise<unknown>) => void;
  #cursor = 0;
  #nextSeq = 0;
  #appliedSeq = -1;
  #pendingEncode?: PendingEncode;
  #inFlight = 0;
  #disposed = false;

  constructor(device: Device, options: QueryRingOptions) {
    this.capacity = options.capacity;
    const label = options.label ?? "vgpu.query-ring";
    const byteSize = options.capacity * QUERY_RESULT_BYTES;
    this.querySet = device.gpu.createQuerySet({ type: options.type, count: options.capacity, label });
    // Mirrors WebGPU resolveQuerySet requirements: "destination.usage contains QUERY_RESOLVE" and
    // "destinationOffset + 8 × queryCount ≤ destination.size" (we always resolve at offset 0, a multiple of 256).
    this.#resolve = device.createBuffer({ size: byteSize, usage: ["query_resolve", "copy_src"], label: `${label}.resolve` });
    this.#stagings = Array.from({ length: options.depth ?? 3 }, (_, index) => ({
      buffer: device.createBuffer({ size: byteSize, usage: ["map_read", "copy_dst"], label: `${label}.staging${index}` }),
      mapPending: false,
    }));
    this.#trackSettled = options.trackSettled;
  }

  encodeResolve(encoder: GPUCommandEncoder, usedCount: number): boolean {
    this.#pendingEncode = undefined;
    if (this.#disposed || usedCount <= 0) return false;
    const staging = this.#stagings[this.#cursor % this.#stagings.length]!;
    // Drop, never block: when readbacks lag frames-in-flight past the ring depth, skip this frame's resolve entirely.
    if (staging.mapPending) return false;
    const count = Math.min(usedCount, this.capacity);
    encoder.resolveQuerySet(this.querySet, 0, count, this.#resolve.gpu, 0);
    encoder.copyBufferToBuffer(this.#resolve.gpu, 0, staging.buffer.gpu, 0, count * QUERY_RESULT_BYTES);
    this.#pendingEncode = { staging, usedCount: count, seq: this.#nextSeq };
    this.#nextSeq += 1;
    this.#cursor += 1;
    return true;
  }

  onSubmitted(apply: (values: BigUint64Array) => void): void {
    const pending = this.#pendingEncode;
    this.#pendingEncode = undefined;
    if (!pending) return;
    pending.staging.mapPending = true;
    this.#inFlight += 1;
    const readback = pending.staging.buffer.gpu.mapAsync(MAP_READ)
      .then(() => {
        const values = new BigUint64Array(pending.staging.buffer.gpu.getMappedRange().slice(0, pending.usedCount * QUERY_RESULT_BYTES));
        pending.staging.buffer.gpu.unmap();
        // Ordered application: a stale readback that lands after a newer one already applied is discarded.
        if (pending.seq <= this.#appliedSeq) return;
        this.#appliedSeq = pending.seq;
        apply(values);
      })
      .catch(() => undefined)
      .finally(() => {
        pending.staging.mapPending = false;
        this.#inFlight -= 1;
        if (this.#disposed && this.#inFlight === 0) this.#destroy();
      });
    this.#trackSettled?.(readback);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pendingEncode = undefined;
    if (this.#inFlight === 0) this.#destroy();
  }

  #destroy(): void {
    this.querySet.destroy();
    this.#resolve.dispose();
    for (const staging of this.#stagings) staging.buffer.dispose();
  }
}

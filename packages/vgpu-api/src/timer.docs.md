# Timer

GPU pass timer created by `gpu.timer()`; requires the `"timestamp-query"` device feature. Use it to find the expensive pass before optimizing: encoders only record, so CPU timing says nothing about GPU cost. Mark a pass with `FramePassOptions.timer` and the GPU brackets it with a begin/end timestamp pair. Decoded durations land in `timer.onResults`, in milliseconds, 1–2 frames after submit.

## Import

```ts
import type { Timer, TimerSpan } from "vgpu";
```

## Signature

```ts
interface TimerSpan {
  readonly name: string;
}

interface Timer {
  span(name: string): TimerSpan;
  onResults(cb: (spans: Readonly<Record<string, number>>) => void): () => void;
  dispose(): void;
}
```

## Parameters

| Param | Type | Required | Default | Notes |
|---|---|---:|---|---|
| gpu.timer | — | — | — | No parameters. |
| timer.span.name | `string` | ✔ | — | Non-empty result key. Spans are memoized per name, so `timer.span("shadows")` is allocation-free in hot loops. |
| timer.onResults.cb | `(spans: Readonly<Record<string, number>>) => void` | ✔ | — | Receives one frozen `name → milliseconds` record per timed frame. |

**Returns:** `gpu.timer()` returns `Timer`; `span()` returns a `TimerSpan` to pass as `FramePassOptions.timer`; `onResults()` returns an unsubscribe function; `dispose()` returns `void`.

**Throws:**

- `VGPU-TIMER-INVALID` when `gpu.timer()` runs on a device without `"timestamp-query"` — request it: `init({ requiredFeatures: ["timestamp-query"] })`.
- `VGPU-TIMER-INVALID` for an empty or non-string span name — name each timed pass, e.g. `timer.span("shadows")`.
- `VGPU-TIMER-INVALID` for a span name reused within one frame (each name holds one begin/end pair per frame) — give the second pass its own span.
- `VGPU-TIMER-INVALID` for a non-`TimerSpan` `FramePassOptions.timer` value, or a span used with another gpu's frames — pass only `timer.span(name)` results, one timer per gpu.
- `VGPU-TIMER-INVALID` for any use of a disposed timer or its spans — create a new timer with `gpu.timer()`.
- `VGPU-TIMER-CAPACITY` when one frame times more than 2048 spans; a timer owns one timestamp query set and WebGPU `createQuerySet` caps `count` at 4096 (2 queries per span) — time fewer passes, or spread timing across frames.

## Examples

```ts
import { init, createMockAdapter } from "vgpu/mock";

const gpu = await init({ adapter: createMockAdapter({ features: ["timestamp-query"] }), requiredFeatures: ["timestamp-query"] });
const shadowMap = gpu.target({ size: [512, 512], depth: true });
const scene = gpu.target({ size: [256, 256], depth: true });
const casters = gpu.effect(`@fragment fn fs_main() -> @location(0) vec4f { return vec4f(0); }`);
const world = gpu.effect(`@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1); }`);

const timer = gpu.timer();
timer.onResults((spans) => {
  console.log(`shadows ${spans.shadows}ms, main ${spans.main}ms`);
});

const loop = gpu.frame.loop((f) => {
  f.pass({ target: shadowMap, timer: timer.span("shadows") }, (p) => p.draw(casters));
  f.pass({ target: scene, timer: timer.span("main") }, (p) => p.draw(world));
});
loop.stop();
```

```ts
import { init } from "vgpu";

// Optional timing: only request the feature when the adapter has it.
const gpu = await init({ requiredFeatures: ["timestamp-query"] });
const timer = gpu.device.features.has("timestamp-query") ? gpu.timer() : undefined;
timer?.onResults((spans) => console.table(spans));
```

## Notes

- Results are GPU durations decoded from timestamp pairs: `(end - begin)` nanosecond ticks converted to milliseconds. Timestamp values are implementation-defined, and WebGPU notes the counter "may reset ... which can result in unexpected values such as negative deltas"; vgpu clamps negative deltas to `0` instead of reporting garbage.
- Readback never blocks a frame: results resolve through rotated staging buffers, and when readbacks lag more frames than the ring holds, that frame's results are dropped rather than awaited. `await gpu.settled()` covers pending readbacks for deterministic tests and teardown.
- Results apply in submission order; a stale readback that lands after a newer one is discarded.
- Capacity starts at 32 spans per frame and grows only at frame boundaries — a pass that overflows the current query set goes untimed for that frame, and the next frame's larger set covers it. For the hard per-frame limit, see `VGPU-TIMER-CAPACITY` above.
- `dispose()` releases the timer's query set and resolve/staging buffers after in-flight readbacks settle. Create the timer once and reuse its spans.
- Timing granularity is the render pass: the pair lands in the pass descriptor's `timestampWrites` (`beginningOfPassWriteIndex`/`endOfPassWriteIndex`), so a span measures the whole pass, not individual draws.
- **See also:** `Gpu.timer`, `Frame`, `FramePassOptions.timer`, `init`.

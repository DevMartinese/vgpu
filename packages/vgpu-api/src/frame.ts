import type { Device } from "@vgpu/core";
import { claimedGroupValidationDone, discardClaimedGroupValidationResults, discardClaimedGroupValidationScopes, popLastClaimedGroupValidationScope, preferClaimedGroupValidationResult, pushClaimedGroupValidationScope, submittedWorkDone, type ClaimedGroupValidationResult, type ValidationErrorSink } from "./claim-validation.ts";
import { endRenderPassWithClaimValidation } from "./claim-validation-encode.ts";
import { replayBundles, type Bundle } from "./bundle.ts";
import { drawStencilWritingOps, drawWritesDepth, encodeDraw, type Draw, type DrawCallOptions, type InternalDraw } from "./draw.ts";
import { effectDraw, type Effect } from "./effect.ts";
import type { Target } from "./target.ts";
import { claimedGroupNativeValidationError, frameReentrantError, passClearDepthInvalidError, passClearStencilInvalidError, passDepthReadOnlyError, passPreserveClearDepthError, passPreserveClearStencilError, passPreserveMsaaError, passScissorInvalidError, passViewportInvalidError, surfaceNotInFrameError, targetRequiredError, timerInvalidError } from "./errors.ts";
import { enterFrame, isSurface, isSurfaceResizeCallbackActive, leaveFrame } from "./surface.ts";
import { hasStencilAspect, isTarget, type ClearColor } from "./target-utils.ts";
import { isTimerSpan, type InternalTimer, type TimerSpan } from "./timer.ts";

export interface FramePassOptions {
  readonly target: Target;
  /** Omit or pass true to clear with gpu.clearColor; pass false to preserve color/depth; pass a color to clear with it. */
  readonly clear?: boolean | ClearColor;
  /** Depth clear value used when the pass clears. Defaults to 1. Use 0 with depth: { compare: "greater" } for reversed-Z. */
  readonly clearDepth?: number;
  /** Stencil clear value used when the pass clears. Defaults to 0. Requires a depth format with a stencil aspect. */
  readonly clearStencil?: number;
  /** Opens the pass with a read-only depth attachment: depth can be tested against and sampled as a texture in the same pass, but not written. For combined depth-stencil formats the stencil aspect is read-only too. Defaults to false. */
  readonly depthReadOnly?: boolean;
  /** Viewport for every draw in this pass. Defaults to the full target. */
  readonly viewport?: {
    readonly x?: number;
    readonly y?: number;
    readonly width: number;
    readonly height: number;
    readonly minDepth?: number;
    readonly maxDepth?: number;
  };
  /** Scissor rectangle [x, y, width, height] for every draw in this pass. Integers. Note: does not affect the clear — loadOp "clear" always clears the full attachment. */
  readonly scissor?: readonly [number, number, number, number];
  /** Times this pass on the GPU: pass `timer.span(name)` from a `gpu.timer()`. The pass duration lands in `timer.onResults` under `name`, in milliseconds. One span name per frame. */
  readonly timer?: TimerSpan;
}

export interface FrameLoopHandle { stop(): void }
export interface FrameLoopOptions { readonly fps?: number }
export type FrameLoopCallback = (frame: Frame) => void;

export class Frame {
  /**
   * Resolves after submitted GPU work completes and raw claimed-bind-group
   * validation has been delivered to `gpu.onError`.
   *
   * This is a completion/timing signal only; it never rejects and is not an error
   * channel.
   */
  done: Promise<void> = Promise.resolve();
  readonly #encoder: GPUCommandEncoder;
  readonly #validations: ClaimedGroupValidationResult[] = [];
  readonly #timers = new Set<InternalTimer>();
  #submitted = false;
  constructor(
    private readonly device: Device,
    private readonly defaultTarget?: Target,
    private readonly errorSink?: ValidationErrorSink,
    private readonly trackSettled?: (promise: Promise<unknown>) => void,
    private readonly defaultClearColor: () => ClearColor = () => [0, 0, 0, 1],
  ) {
    this.#encoder = device.gpu.createCommandEncoder({ label: "vgpu.frame" });
  }

  pass(target: Target, body: Effect | Draw | ((pass: FramePass) => void)): void;
  pass(options: FramePassOptions, body: Effect | Draw | ((pass: FramePass) => void)): void;
  pass(target: Target | FramePassOptions, body: Effect | Draw | ((pass: FramePass) => void)): void {
    const targetOnly = isTarget(target);
    const cb = typeof body === "function" ? body : (p: FramePass) => p.draw(body);
    const resolvedTarget = targetOnly ? target : target.target ?? this.defaultTarget;
    if (!resolvedTarget) throw targetRequiredError("Frame.pass");
    if (isSurface(resolvedTarget) && this.#submitted) throw surfaceNotInFrameError("Frame.pass");
    const clear = targetOnly ? undefined : target.clear;
    const preserve = clear === false;
    if (preserve && resolvedTarget.sampleCount === 4) throw passPreserveMsaaError();
    const clearDepth = targetOnly ? undefined : target.clearDepth;
    if (clearDepth !== undefined) {
      if (typeof clearDepth !== "number" || !(clearDepth >= 0 && clearDepth <= 1)) throw passClearDepthInvalidError(clearDepth);
      if (preserve) throw passPreserveClearDepthError();
    }
    const clearStencil = targetOnly ? undefined : target.clearStencil;
    if (clearStencil !== undefined) {
      // WebGPU stencilClearValue is GPUStencilValue ([EnforceRange] u32); in-range values are masked to the stencil
      // aspect's bit width by taking the LSBs, so values above 0xFF on stencil8 aspects are legal, not errors.
      if (typeof clearStencil !== "number" || !Number.isInteger(clearStencil) || clearStencil < 0 || clearStencil > 0xFFFFFFFF) {
        throw passClearStencilInvalidError(`received ${String(clearStencil)}; expected an integer in [0, 0xFFFFFFFF] (WebGPU GPUStencilValue).`);
      }
      if (preserve) throw passPreserveClearStencilError();
      const depthFormat = resolvedTarget.depth?.format;
      if (!hasStencilAspect(depthFormat)) throw passClearStencilInvalidError(`received ${String(clearStencil)}, but the target's depth format ${depthFormat ? `"${depthFormat}"` : "(none)"} has no stencil aspect, so clearStencil would have no effect.`);
    }
    const depthReadOnly = targetOnly ? undefined : target.depthReadOnly;
    if (depthReadOnly !== undefined && typeof depthReadOnly !== "boolean") {
      throw passDepthReadOnlyError(`received ${previewValue(depthReadOnly)}; expected a boolean.`, "Pass depthReadOnly: true to open the pass with a read-only depth attachment, or omit it.");
    }
    if (depthReadOnly) {
      // Dead-option and contradiction rules: color attachments still load/clear normally in a read-only
      // pass, so clear (color) stays legal, but the read-only depth/stencil aspects omit their ops entirely
      // and can never be cleared.
      if (!resolvedTarget.depth) throw passDepthReadOnlyError("is set, but the target has no depth attachment, so there is nothing to make read-only.", "Create the target with depth: true (or a depth format), or drop depthReadOnly.");
      if (clearDepth !== undefined) throw passDepthReadOnlyError("cannot be combined with clearDepth; a read-only depth aspect omits its load/store ops and is never cleared.", "Remove clearDepth, or drop depthReadOnly.");
      if (clearStencil !== undefined) throw passDepthReadOnlyError("cannot be combined with clearStencil; a read-only stencil aspect omits its load/store ops and is never cleared.", "Remove clearStencil, or drop depthReadOnly.");
    }
    const viewport = targetOnly ? undefined : validatedViewport(target.viewport, this.device.gpu.limits, resolvedTarget.size);
    const scissor = targetOnly ? undefined : validatedScissor(target.scissor, resolvedTarget.size);
    const timestampWrites = targetOnly ? undefined : this.#attachTimerSpan(target.timer);
    // timestampWrites is target-independent pass state: decorate the descriptor after obtaining it from the target.
    const descriptor = resolvedTarget.renderPassDescriptor(clear === undefined || clear === true || clear === false ? this.defaultClearColor() : clear, preserve, clearDepth, clearStencil, depthReadOnly);
    const encoder = this.#encoder.beginRenderPass(timestampWrites ? { ...descriptor, timestampWrites } : descriptor);
    if (viewport) encoder.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, viewport.minDepth, viewport.maxDepth);
    if (scissor) encoder.setScissorRect(scissor[0], scissor[1], scissor[2], scissor[3]);
    try { cb(new FramePass(encoder, resolvedTarget, this.#validations, depthReadOnly === true)); }
    catch (error) {
      discardClaimedGroupValidationResults(this.#validations);
      this.#validations.length = 0;
      discardClaimedGroupValidationScopes(this.device);
      try { encoder.end(); } catch { /* ignore cleanup failure after encode failure */ }
      throw error;
    }
    endRenderPassWithClaimValidation(this.device, encoder, this.#validations);
  }

  submit(): void {
    if (this.#submitted) return;
    this.#submitted = true;
    // Timed frames append one resolveQuerySet of each timer's contiguous used range (plus the
    // staging copy) to the still-open frame encoder — zero extra submissions.
    for (const timer of this.#timers) timer.finalizeFrame(this, this.#encoder);
    let commandBuffer: GPUCommandBuffer;
    const finishContext = this.#validations[0]?.context;
    if (finishContext) pushClaimedGroupValidationScope(this.device, finishContext);
    try { commandBuffer = this.#encoder.finish(); }
    catch (error) {
      const result = finishContext ? popLastClaimedGroupValidationScope(this.device) : undefined;
      discardClaimedGroupValidationResults(this.#validations);
      if (result) discardClaimedGroupValidationResults([result]);
      const context = result?.context ?? finishContext;
      if (!context) throw error;
      this.done = this.#trackDone(this.#deliverValidationError(context.label, context.group, error));
      return;
    }
    if (finishContext) {
      const result = popLastClaimedGroupValidationScope(this.device);
      if (result) this.#validations[0] = this.#validations[0] ? preferClaimedGroupValidationResult(result, this.#validations[0]) : result;
    }
    const submitContext = this.#validations[0]?.context;
    if (submitContext) pushClaimedGroupValidationScope(this.device, submitContext);
    try { this.device.gpu.queue.submit([commandBuffer]); }
    catch (error) {
      const result = submitContext ? popLastClaimedGroupValidationScope(this.device) : undefined;
      discardClaimedGroupValidationResults(this.#validations);
      if (result) discardClaimedGroupValidationResults([result]);
      const context = result?.context ?? submitContext;
      if (!context) throw error;
      this.done = this.#trackDone(this.#deliverValidationError(context.label, context.group, error));
      return;
    }
    if (submitContext) {
      const result = popLastClaimedGroupValidationScope(this.device);
      if (result) this.#validations[0] = this.#validations[0] ? preferClaimedGroupValidationResult(result, this.#validations[0]) : result;
    }
    // The submit succeeded: start each timer's non-blocking readback of this frame's resolve.
    for (const timer of this.#timers) timer.frameSubmitted(this);
    this.done = this.#trackDone(claimedGroupValidationDone(this.device, this.#validations, { errorSink: this.errorSink }));
  }

  #attachTimerSpan(span: TimerSpan | undefined): GPURenderPassTimestampWrites | undefined {
    if (span === undefined) return undefined;
    if (!isTimerSpan(span)) {
      throw timerInvalidError(`FramePassOptions.timer received ${previewValue(span)}; expected a TimerSpan from timer.span(name).`, `Create const timer = gpu.timer() once, then pass timer.span("name") per pass.`, "Frame.pass");
    }
    this.#timers.add(span.owner);
    return span.owner.attachSpan(span, this, this.device);
  }

  async #deliverValidationError(label: string, group: number, cause: unknown): Promise<void> {
    await submittedWorkDone(this.device);
    const error = claimedGroupNativeValidationError(label, group, cause);
    if (this.errorSink) await this.errorSink(error);
    else console.error(error);
  }

  #trackDone(promise: Promise<void>): Promise<void> {
    this.trackSettled?.(promise);
    return promise;
  }
}

export class FramePass {
  constructor(private readonly encoder: GPURenderPassEncoder, readonly target: Target, private readonly validations: ClaimedGroupValidationResult[], private readonly depthReadOnly = false) {}
  draw(drawable: Draw | Effect, opts: DrawCallOptions = {}): void {
    if (this.depthReadOnly) assertDrawableAllowedInReadOnlyPass(drawable, this.target);
    encodeFrameDrawable(drawable, this.encoder, this.target, opts, (result) => this.validations.push(result));
  }
  bundles(...bundles: readonly Bundle[]): void {
    // WebGPU executeBundles: "If this.[[depthReadOnly]] is true, bundle.[[depthReadOnly]] must be true.
    // If this.[[stencilReadOnly]] is true, bundle.[[stencilReadOnly]] must be true." gpu.bundle always
    // records bundles with both flags false, so no recorded bundle can replay into a read-only pass;
    // reject up front instead of leaving it to native validation.
    if (this.depthReadOnly) throw passDepthReadOnlyError("pass cannot replay bundles: gpu.bundle records bundles with writable depth/stencil, and WebGPU only executes read-only-recorded bundles in a read-only pass.", "Encode the draws directly with pass.draw(...) inside the depthReadOnly pass.", "FramePass.bundles");
    replayBundles(this.target, bundles, (gpuBundles) => this.encoder.executeBundles(gpuBundles));
  }
}

/**
 * Early equivalent of the WebGPU setPipeline device-timeline checks: "If pipeline.[[writesDepth]]:
 * this.[[depthReadOnly]] must be false. If pipeline.[[writesStencil]]: this.[[stencilReadOnly]] must be
 * false." A depthReadOnly pass marks the stencil aspect read-only too (combined formats), so both are
 * validated here with actionable errors before encoding.
 */
function assertDrawableAllowedInReadOnlyPass(drawable: Draw | Effect, target: Target): void {
  const draw = ("layout" in drawable ? drawable : effectDraw(drawable)) as InternalDraw;
  if (drawWritesDepth(draw)) {
    throw passDepthReadOnlyError(`pass cannot encode draw '${draw.label}': its depth state writes depth (the default is write: true). Give the draw depth: { write: false } (or depth: false to disable depth testing).`, "Use depth: { write: false } on the draw, or open the pass without depthReadOnly.", "FramePass.draw");
  }
  if (hasStencilAspect(target.depth?.format)) {
    const ops = drawStencilWritingOps(draw);
    if (ops.length) {
      throw passDepthReadOnlyError(`pass cannot encode draw '${draw.label}': its stencil ops can write (${ops.join(", ")}), and the pass's stencil aspect is read-only too.`, `Use "keep" for those ops or stencil writeMask: 0, or open the pass without depthReadOnly.`, "FramePass.draw");
    }
  }
}

function encodeFrameDrawable(drawable: Draw | Effect, encoder: GPURenderPassEncoder, target: Target, opts: DrawCallOptions, claimValidation: (result: ClaimedGroupValidationResult) => void): void {
  if ("layout" in drawable) return encodeDraw(drawable as never, encoder, target, opts, claimValidation);
  encodeDraw(effectDraw(drawable), encoder, target, opts, claimValidation);
}

/**
 * Mirrors the WebGPU setViewport device-timeline validation (arguments are floats;
 * bounds check against device limits, not the attachment): with maxViewportRange =
 * maxTextureDimension2D × 2, requires x ≥ -maxViewportRange, y ≥ -maxViewportRange,
 * 0 ≤ width/height ≤ maxTextureDimension2D, x + width ≤ maxViewportRange − 1,
 * y + height ≤ maxViewportRange − 1, 0 ≤ minDepth ≤ 1, 0 ≤ maxDepth ≤ 1, and
 * minDepth ≤ maxDepth.
 */
function validatedViewport(viewport: FramePassOptions["viewport"], limits: GPUSupportedLimits, targetSize: readonly [number, number]): { x: number; y: number; width: number; height: number; minDepth: number; maxDepth: number } | undefined {
  if (viewport === undefined) return undefined;
  if (typeof viewport !== "object" || viewport === null || Array.isArray(viewport)) throw passViewportInvalidError(`received ${previewValue(viewport)}; expected { x?, y?, width, height, minDepth?, maxDepth? }.`);
  const { x = 0, y = 0, width, height, minDepth = 0, maxDepth = 1 } = viewport;
  for (const [name, value] of [["x", x], ["y", y], ["width", width], ["height", height], ["minDepth", minDepth], ["maxDepth", maxDepth]] as const) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw passViewportInvalidError(`${name} received ${previewValue(value)}; expected a finite number.`);
  }
  const max = limits.maxTextureDimension2D;
  const maxViewportRange = max * 2;
  const sizeNote = `target is ${targetSize[0]}x${targetSize[1]}px, device maxTextureDimension2D is ${max}`;
  if (!(width >= 0 && width <= max)) throw passViewportInvalidError(`width ${width} is outside [0, ${max}] (${sizeNote}).`);
  if (!(height >= 0 && height <= max)) throw passViewportInvalidError(`height ${height} is outside [0, ${max}] (${sizeNote}).`);
  if (!(x >= -maxViewportRange && x + width <= maxViewportRange - 1)) throw passViewportInvalidError(`x ${x} with width ${width} is outside [${-maxViewportRange}, ${maxViewportRange - 1}] (${sizeNote}).`);
  if (!(y >= -maxViewportRange && y + height <= maxViewportRange - 1)) throw passViewportInvalidError(`y ${y} with height ${height} is outside [${-maxViewportRange}, ${maxViewportRange - 1}] (${sizeNote}).`);
  if (!(minDepth >= 0 && minDepth <= 1)) throw passViewportInvalidError(`minDepth ${minDepth} is outside [0, 1].`);
  if (!(maxDepth >= 0 && maxDepth <= 1)) throw passViewportInvalidError(`maxDepth ${maxDepth} is outside [0, 1].`);
  if (!(minDepth <= maxDepth)) throw passViewportInvalidError(`minDepth ${minDepth} exceeds maxDepth ${maxDepth}.`);
  return { x, y, width, height, minDepth, maxDepth };
}

/**
 * Mirrors the WebGPU setScissorRect validation: arguments are GPUIntegerCoordinate
 * (non-negative integers), and the rectangle must satisfy x + width ≤ attachment
 * width and y + height ≤ attachment height against the target's current size.
 */
function validatedScissor(scissor: FramePassOptions["scissor"], targetSize: readonly [number, number]): readonly [number, number, number, number] | undefined {
  if (scissor === undefined) return undefined;
  if (!Array.isArray(scissor) || scissor.length !== 4) throw passScissorInvalidError(`received ${previewValue(scissor)}; expected [x, y, width, height].`);
  const [x, y, width, height] = scissor;
  for (const [name, value] of [["x", x], ["y", y], ["width", width], ["height", height]] as const) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw passScissorInvalidError(`${name} received ${previewValue(value)}; expected a non-negative integer.`);
  }
  const [targetWidth, targetHeight] = targetSize;
  if (x + width > targetWidth || y + height > targetHeight) {
    throw passScissorInvalidError(`[${x}, ${y}, ${width}, ${height}] exceeds the target's current size ${targetWidth}x${targetHeight}px (x + width <= ${targetWidth}, y + height <= ${targetHeight}).`);
  }
  return [x, y, width, height];
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map((entry) => previewValue(entry)).join(", ")}]`;
  if (typeof value === "object" && value !== null) return "an object";
  return String(value);
}

export class FrameRunner {
  #running = false;
  constructor(private readonly createFrame: () => Frame, private readonly advance: () => void) {}
  frame(cb?: (frame: Frame) => void): Frame {
    if (this.#running || isSurfaceResizeCallbackActive()) throw frameReentrantError();
    this.#running = true;
    enterFrame();
    try {
      this.advance();
      const frame = this.createFrame();
      if (cb) {
        try { cb(frame); }
        finally { frame.submit(); }
      }
      return frame;
    } finally {
      leaveFrame();
      this.#running = false;
    }
  }
  loop(cb: FrameLoopCallback, opts: FrameLoopOptions = {}): FrameLoopHandle {
    let stopped = false;
    const request = globalThis.requestAnimationFrame ?? ((fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number);
    const cancel = globalThis.cancelAnimationFrame ?? ((id: number) => clearTimeout(id));
    const minIntervalMs = opts.fps && opts.fps > 0 ? 1000 / opts.fps : 0;
    let lastFrameMs: number | undefined;
    let id = 0;
    const tick = (timestamp: number) => {
      if (stopped) return;
      if (shouldRunFrame(timestamp, lastFrameMs, minIntervalMs)) {
        lastFrameMs = timestamp;
        this.frame(cb);
      }
      id = request(tick);
    };
    id = request(tick);
    return { stop() { stopped = true; cancel(id); } };
  }
}

function shouldRunFrame(timestamp: number, lastFrameMs: number | undefined, minIntervalMs: number): boolean {
  if (lastFrameMs === undefined) return true;
  if (minIntervalMs <= 0) return true;
  return timestamp - lastFrameMs >= minIntervalMs;
}

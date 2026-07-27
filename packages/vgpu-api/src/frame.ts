import type { Device } from "@vgpu/core";
import { claimedGroupValidationDone, discardClaimedGroupValidationResults, discardClaimedGroupValidationScopes, popLastClaimedGroupValidationScope, preferClaimedGroupValidationResult, pushClaimedGroupValidationScope, submittedWorkDone, type ClaimedGroupValidationResult, type ValidationErrorSink } from "./claim-validation.ts";
import { endRenderPassWithClaimValidation } from "./claim-validation-encode.ts";
import { replayBundles, type Bundle } from "./bundle.ts";
import { drawStencilWritingOps, drawWritesDepth, encodeDraw, type Draw, type DrawCallOptions, type InternalDraw } from "./draw.ts";
import { effectDraw, type Effect } from "./effect.ts";
import type { Target } from "./target.ts";
import { claimedGroupNativeValidationError, frameReentrantError, passClearDepthInvalidError, passClearStencilInvalidError, passDepthReadOnlyError, passDepthReadOnlyMsaaError, passPreserveClearDepthError, passPreserveClearStencilError, passPreserveMsaaError, passScissorInvalidError, passViewportInvalidError, queryNestedError, queryNoVisibilityError, surfaceNotInFrameError, targetRequiredError, timerInvalidError, visibilityInvalidError, visibilityNoDepthError } from "./errors.ts";
import { enterFrame, isSurface, isSurfaceResizeCallbackActive, leaveFrame } from "./surface.ts";
import { hasStencilAspect, isTarget, type ClearColor } from "./target-utils.ts";
import { isTimerSpan, type InternalTimer, type TimerSpan } from "./timer.ts";
import { isVisibility, type InternalVisibility, type Visibility, type VisibilityQuery } from "./visibility.ts";

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
  /** Enables occlusion queries in this pass: pass a `gpu.visibility()` instance, then wrap proxy draws in `pass.occlusion(handle, body)`. Requires a target with a depth attachment. */
  readonly visibility?: Visibility;
}

/**
 * Frame identity passed to a telemetry instance's finalizeFrame to *clear* its pending encoded
 * state instead of encoding: finalizeFrame drops that state before it compares frame identities,
 * so a foreign token clears and returns without touching the encoder. Frame.#abandonTelemetry
 * pairs it with frameSubmitted to release the query-set retain without a phantom readback.
 */
const ABANDONED_FRAME: unique symbol = Symbol("vgpu.frame.abandoned");

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
  readonly #visibilities = new Set<InternalVisibility>();
  /**
   * Telemetry instances whose per-frame bookkeeping a failed pass invalidated: their frame is
   * neither finalized nor read back, so a throwing pass callback cannot leave a phantom result.
   * Kept alongside the sets so a later pass re-attaching the same instance in this frame stays
   * dropped too — the failed pass's span/slots are still in that instance's frame bookkeeping.
   */
  readonly #discardedTelemetry = new Set<InternalTimer | InternalVisibility>();
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
      // Dead-option rule, same as clearStencil below: without a depth attachment there is no
      // depthClearValue in the descriptor, so clearDepth would silently do nothing.
      if (!resolvedTarget.depth) {
        throw passClearDepthInvalidError(clearDepth, "but the target has no depth attachment, so clearDepth would have no effect.", "Create the target with depth: true (or a depth format), or drop clearDepth.");
      }
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
      // Symmetric to the clear:false MSAA rule: an MSAA target's depth aspect is stored with
      // storeOp "discard" (target-utils depthAttachment), so nothing survives the pass that wrote
      // it. Reading it back read-only would depth-test every draw against discarded contents —
      // silent garbage (with visibility attached, every query reports "hidden").
      if (resolvedTarget.sampleCount === 4) throw passDepthReadOnlyMsaaError();
      if (clearDepth !== undefined) throw passDepthReadOnlyError("cannot be combined with clearDepth; a read-only depth aspect omits its load/store ops and is never cleared.", "Remove clearDepth, or drop depthReadOnly.");
      if (clearStencil !== undefined) throw passDepthReadOnlyError("cannot be combined with clearStencil; a read-only stencil aspect omits its load/store ops and is never cleared.", "Remove clearStencil, or drop depthReadOnly.");
    }
    const viewport = targetOnly ? undefined : validatedViewport(target.viewport, this.device.gpu.limits, resolvedTarget.size);
    const scissor = targetOnly ? undefined : validatedScissor(target.scissor, resolvedTarget.size);
    let timer: { readonly owner: InternalTimer; readonly timestampWrites: GPURenderPassTimestampWrites | undefined } | undefined;
    let visibility: InternalVisibility | undefined;
    let encoder: GPURenderPassEncoder | undefined;
    try {
      // Attaching telemetry mutates per-frame bookkeeping before the native pass opens. Keep the whole
      // attach/setup/body sequence atomic so any later validation/native setup failure rolls it back,
      // not only exceptions thrown by the user callback.
      timer = targetOnly ? undefined : this.#attachTimerSpan(target.timer);
      const timestampWrites = timer?.timestampWrites;
      visibility = targetOnly ? undefined : this.#attachVisibility(target.visibility, resolvedTarget);
      // timestampWrites and occlusionQuerySet are target-independent pass state: decorate the descriptor after obtaining it from the target.
      let descriptor = resolvedTarget.renderPassDescriptor({ clear: clear === undefined || clear === true || clear === false ? this.defaultClearColor() : clear, preserve, clearDepth, clearStencil, depthReadOnly });
      if (timestampWrites) descriptor = { ...descriptor, timestampWrites };
      // Mirrors the WebGPU pass descriptor rule: occlusionQuerySet must be a valid query set of type "occlusion".
      if (visibility) descriptor = { ...descriptor, occlusionQuerySet: visibility.querySet };
      encoder = this.#encoder.beginRenderPass(descriptor);
      if (viewport) encoder.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, viewport.minDepth, viewport.maxDepth);
      if (scissor) encoder.setScissorRect(scissor[0], scissor[1], scissor[2], scissor[3]);
      cb(new FramePass(encoder, resolvedTarget, this.#validations, depthReadOnly === true, visibility, this));
    } catch (error) {
      // A failed pass — during setup or in its body — never ran successfully. Leaving telemetry
      // registered makes submit() resolve unwritten queries as phantom results.
      this.#discardTelemetry(timer?.owner, visibility);
      discardClaimedGroupValidationResults(this.#validations);
      this.#validations.length = 0;
      discardClaimedGroupValidationScopes(this.device);
      try { encoder?.end(); } catch { /* ignore cleanup failure after encode failure */ }
      throw error;
    }
    endRenderPassWithClaimValidation(this.device, encoder, this.#validations);
  }

  submit(): void {
    if (this.#submitted) return;
    this.#submitted = true;
    // Timed and occlusion-queried frames append one resolveQuerySet of each instance's contiguous
    // used range (plus the staging copy) to the still-open frame encoder — zero extra submissions.
    for (const timer of this.#liveTimers()) timer.finalizeFrame(this, this.#encoder);
    for (const visibility of this.#liveVisibilities()) visibility.finalizeFrame(this, this.#encoder);
    let commandBuffer: GPUCommandBuffer;
    const finishContext = this.#validations[0]?.context;
    if (finishContext) pushClaimedGroupValidationScope(this.device, finishContext);
    try { commandBuffer = this.#encoder.finish(); }
    catch (error) {
      // finish() failed, so the resolves encoded above never reach the queue: nothing may be read
      // back, but every instance still has to release the retain it took when it was attached.
      this.#abandonTelemetry(this.#frameTelemetry());
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
      // Same as the finish() failure: the command buffer never ran, so release the retains and read
      // nothing back — the resolve's staging bytes are stale, not this frame's results.
      this.#abandonTelemetry(this.#frameTelemetry());
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
    // The submit succeeded: start each timer's and visibility's non-blocking readback of this frame's resolve.
    for (const timer of this.#liveTimers()) timer.frameSubmitted(this);
    for (const visibility of this.#liveVisibilities()) visibility.frameSubmitted(this);
    // Instances a failed pass dropped are skipped above, so they still hold this frame's retain.
    this.#abandonTelemetry(this.#discardedTelemetry);
    this.done = this.#trackDone(claimedGroupValidationDone(this.device, this.#validations, { errorSink: this.errorSink }));
  }

  /**
   * Ends the frame for telemetry instances that will never see a real frameSubmitted: a pass whose
   * callback threw, or a frame whose finish/submit failed. Each one took a retain on its query ring
   * when it was attached to a pass descriptor (so a mid-frame dispose() cannot destroy a set the
   * frame still points at); without the matching release, a dispose() after the failure leaves the
   * ring alive forever. Clearing the pending encoded state first is what makes this a release and
   * not a readback: a resolve that never reached the queue must not be decoded — its staging buffer
   * holds stale bytes, which would surface as a phantom duration or a phantom "hidden".
   */
  #abandonTelemetry(owners: Iterable<InternalTimer | InternalVisibility>): void {
    for (const owner of owners) {
      owner.finalizeFrame(ABANDONED_FRAME, this.#encoder);
      owner.frameSubmitted(this);
    }
  }

  /** Every telemetry instance this frame attached, discarded ones included. */
  #frameTelemetry(): (InternalTimer | InternalVisibility)[] {
    return [...this.#timers, ...this.#visibilities, ...this.#discardedTelemetry];
  }

  #discardTelemetry(timer: InternalTimer | undefined, visibility: InternalVisibility | undefined): void {
    if (timer) {
      this.#timers.delete(timer);
      this.#discardedTelemetry.add(timer);
    }
    if (visibility) {
      this.#visibilities.delete(visibility);
      this.#discardedTelemetry.add(visibility);
    }
  }

  #liveTimers(): InternalTimer[] {
    return [...this.#timers].filter((timer) => !this.#discardedTelemetry.has(timer));
  }

  #liveVisibilities(): InternalVisibility[] {
    return [...this.#visibilities].filter((visibility) => !this.#discardedTelemetry.has(visibility));
  }

  /** Registers the span for this frame; returns the owning timer so a failed pass can roll its telemetry back. */
  #attachTimerSpan(span: TimerSpan | undefined): { readonly owner: InternalTimer; readonly timestampWrites: GPURenderPassTimestampWrites | undefined } | undefined {
    if (span === undefined) return undefined;
    if (!isTimerSpan(span)) {
      throw timerInvalidError(`FramePassOptions.timer received ${previewValue(span)}; expected a TimerSpan from timer.span(name).`, `Create const timer = gpu.timer() once, then pass timer.span("name") per pass.`, "Frame.pass");
    }
    const owner = span.owner;
    const alreadyAttached = this.#timers.has(owner);
    try {
      const timestampWrites = owner.attachSpan(span, this, this.device);
      this.#timers.add(owner);
      return { owner, timestampWrites };
    } catch (error) {
      // A duplicate/capacity error can occur after this timer already contributed an earlier pass
      // to the frame. The outer assignment has not completed yet, so discard it here rather than
      // letting submit() report that earlier pass as a successful partial frame.
      if (alreadyAttached) this.#discardTelemetry(owner, undefined);
      throw error;
    }
  }

  #attachVisibility(visibility: Visibility | undefined, resolvedTarget: Target): InternalVisibility | undefined {
    if (visibility === undefined) return undefined;
    if (!isVisibility(visibility)) {
      throw visibilityInvalidError(`FramePassOptions.visibility received ${previewValue(visibility)}; expected a Visibility from gpu.visibility().`, "Create const vis = gpu.visibility() once, then pass { target, visibility: vis } per pass.", "Frame.pass");
    }
    // Spec-legal but a dead option for culling: without a depth attachment nothing is depth-tested,
    // so any rasterized sample passes and every query reports "visible". Start strict.
    if (!resolvedTarget.depth) throw visibilityNoDepthError();
    visibility.attachFrame(this, this.device);
    this.#visibilities.add(visibility);
    return visibility;
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
  #occlusionActive = false;
  constructor(private readonly encoder: GPURenderPassEncoder, readonly target: Target, private readonly validations: ClaimedGroupValidationResult[], private readonly depthReadOnly = false, private readonly visibility?: InternalVisibility, private readonly frame?: Frame) {}
  draw(drawable: Draw | Effect, opts: DrawCallOptions = {}): void {
    if (this.depthReadOnly) assertDrawableAllowedInReadOnlyPass(drawable, this.target);
    encodeFrameDrawable(drawable, this.encoder, this.target, opts, (result) => this.validations.push(result));
  }
  /**
   * Wraps one or more draws in begin/endOcclusionQuery. The body ALWAYS executes; condition your
   * real draws on `q.hidden` outside.
   */
  occlusion(query: VisibilityQuery, body: Draw | Effect | (() => void)): void {
    if (!this.visibility) throw queryNoVisibilityError();
    // WebGPU beginOcclusionQuery: "no occlusion query must be active for this" — one scope at a time.
    if (this.#occlusionActive) throw queryNestedError();
    const index = this.visibility.beginQuery(query, this.frame);
    this.encoder.beginOcclusionQuery(index);
    this.#occlusionActive = true;
    try {
      if (typeof body === "function") body();
      else this.draw(body);
    } finally {
      // vgpu's scope shape makes an unclosed query structurally impossible: end in finally, so a
      // throwing body can never leave a query open at pass end (which would invalidate the encoder).
      this.#occlusionActive = false;
      this.encoder.endOcclusionQuery();
    }
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

// SHADE VARIANT SPECIALIZATION — the single place a shade pipeline's source is
// built, shared by the browser renderer (renderer.ts) and the headless harness
// (debug-render.mjs).
//
// There is exactly ONE shade shader in this directory. Every variant the perf
// A/B measures is a deterministic REWRITE of that one source, applied right
// before `gpu.effect`:
//
//   analytic   flips disk.wgsl's `DISK_NOISE_ANALYTIC` gate to true, which
//              compiles in the eight-hash noise instead of the lattice fetch.
//   tiled      the source exactly as written (what ships).
//   tiled-f16  rewrites disk.wgsl / stars.wgsl's precision ALIASES to half and
//              prepends `enable f16;`.
//
// Why rewriting instead of a `disk-f16.wgsl` next to `disk.wgsl`: a hand-kept
// copy is guaranteed to drift the first time someone tunes the look, and then
// the A/B measures two different shaders and calls the difference "precision".
// Every rewrite here therefore ASSERTS what it matched and throws on anything
// unexpected, because a silently failed substitution is worse than a crash: it
// reports a dead heat (or a fake win) that reads as a real measurement.
//
// Why not `pipeline-overridable` constants or a uniform: the point is to measure
// a specialized program. A uniform `if` keeps both arms in the compiled shader,
// so the register allocator has to satisfy the worse of the two and the cheap
// arm gets billed for the expensive one's live values. A `const` gate and a type
// rewrite both fold before register allocation.

/**
 * disk.wgsl's noise gate, matched AROUND the bundler's hash prefix.
 *
 * The WGSL bundler namespaces every module-level symbol as
 * `_vgsl_<contenthash>__NAME`, and that hash changes whenever disk.wgsl is
 * edited — hardcoding the mangled name would break on the next look tweak.
 */
const DISK_NOISE_SWITCH = /(const\s+[A-Za-z0-9_]*DISK_NOISE_ANALYTIC\s*:\s*bool\s*=\s*)false(\s*;)/g;

/**
 * The precision aliases (`hreal`, `hreal2`, `hreal3`, `hreal4`), same hash-prefix
 * tolerance as above. One declaration per module that uses them, so the match
 * count is "at least one" rather than a fixed number — the LEFTOVER check below
 * is what makes the rewrite total.
 */
const PRECISION_ALIAS = /(alias\s+[A-Za-z0-9_]*hreal[0-9]?\s*=\s*)(f32|vec2f|vec3f|vec4f)(\s*;)/g;

/** f32 spelling -> f16 spelling. The only substitutions the rewrite performs. */
const HALF_TYPES = { f32: 'f16', vec2f: 'vec2h', vec3f: 'vec3h', vec4f: 'vec4h' };

/**
 * A precision alias that survived the rewrite still bound to a 32-bit type.
 *
 * This is the check that makes the mechanism safe to extend: adding
 * `alias hreal2x2 = mat2x2f;` to a shader would leave a 32-bit alias behind, the
 * variant would silently be a slower copy of the f32 one, and the measurement
 * would be a lie. Instead it throws here, at init, with the offending line.
 *
 * The lookahead absorbs its own whitespace (`(?!\s*...)`) rather than relying on
 * the `\s*` before it: a greedy `\s*` backtracks to zero characters, which lets
 * the negative lookahead peek at a space instead of at the type and pass every
 * line. That bug reported "left at 32-bit" for a correctly rewritten `= f16;`.
 */
const LEFTOVER_ALIAS = /alias\s+[A-Za-z0-9_]*hreal[0-9a-z]*\s*=\s*(?!\s*(?:f16|vec2h|vec3h|vec4h)\b)[^;]*;/;

/**
 * Prepended to the f16 variant, and the reason this is not a one-line rewrite.
 *
 * `enable f16;` must precede every global declaration in the module. But
 * `gpu.effect` builds the module by PREPENDING a full-screen vertex entry to the
 * source it is given (`fullscreenSource` in packages/vgpu-api/src/effect.ts), so
 * a directive at the top of shade.wgsl would land in the middle of the final
 * module and fail to compile:
 *
 *   error: directives must come before all global declarations
 *
 * A source that already declares a vertex entry is passed through untouched, so
 * the variant brings its own copy of that entry and the directive can be first.
 * The copy below is verbatim vgpu's, and it has to stay that way — it is
 * verified by rendering: the f32 arm and this preamble over the same shade
 * source produce bit-identical images (see the RMSE note in GBUFFER.md).
 */
const F16_PREAMBLE = `enable f16;

// Verbatim copy of vgpu's own full-screen vertex entry (see the note in
// precision.mjs): declaring it here is what allows the enable directive above to
// be the first thing in the module.
struct VgpuFullscreenVertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vgpu_fullscreen_vs(@builtin(vertex_index) vi: u32) -> VgpuFullscreenVertexOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var out: VgpuFullscreenVertexOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = uv[vi];
  return out;
}

`;

/**
 * Every shade variant that can exist, in panel order: control, shipped, spike.
 *
 * `tiled-f16` additionally needs the `shader-f16` device feature, so it is
 * *possible* here but not always *available* — the renderer only builds it when
 * the adapter supports it (see `availableVariants`).
 */
export const SHADE_VARIANTS = ['analytic', 'tiled', 'tiled-f16'];

/** Variants that require the `shader-f16` device feature. */
export const F16_VARIANTS = ['tiled-f16'];

/** True when this variant cannot be compiled without `shader-f16`. */
export function variantNeedsF16(variant) {
  return F16_VARIANTS.includes(variant);
}

/**
 * Builds one variant's WGSL from the canonical shade source.
 *
 * @param {string} source resolved shade.wgsl (imports already inlined)
 * @param {'analytic' | 'tiled' | 'tiled-f16'} variant
 * @returns {string} the specialized source, ready for `gpu.effect`
 */
export function shadeVariantSource(source, variant) {
  switch (variant) {
    case 'tiled':
      return source;
    case 'analytic':
      return toAnalyticNoise(source);
    case 'tiled-f16':
      return toHalfPrecision(source);
    default:
      throw new Error(`[hero] unknown shade variant "${variant}"; expected ${SHADE_VARIANTS.join(' | ')}`);
  }
}

/** Flips the disk noise gate to the pre-optimization eight-hash implementation. */
function toAnalyticNoise(source) {
  const matches = source.match(DISK_NOISE_SWITCH);
  if (matches?.length !== 1) {
    throw new Error(
      `[hero] expected exactly 1 DISK_NOISE_ANALYTIC gate in the shade source, found ${matches?.length ?? 0}. ` +
        'The disk.wgsl A/B switch is broken — see DISK_NOISE_SWITCH in precision.mjs.',
    );
  }
  return source.replace(DISK_NOISE_SWITCH, '$1true$2');
}

/**
 * Rewrites the precision aliases to half and prepends the f16 preamble.
 *
 * Three assertions, all of them load-bearing:
 *  1. at least one alias was found (otherwise the "f16" variant is the f32 one);
 *  2. no `hreal*` alias is left bound to a 32-bit type (a partial rewrite);
 *  3. the source does not already declare a vertex entry, which would make the
 *     preamble a duplicate declaration.
 */
function toHalfPrecision(source) {
  if (/@vertex/.test(source)) {
    throw new Error(
      '[hero] the shade source already declares a @vertex entry, so the f16 preamble cannot be prepended. ' +
        'Move `enable f16;` into that entry\'s module instead — see F16_PREAMBLE in precision.mjs.',
    );
  }
  const matches = source.match(PRECISION_ALIAS);
  if (!matches || matches.length === 0) {
    throw new Error(
      '[hero] found no `alias hreal* = f32|vecNf` declaration in the shade source, so the f16 variant would be ' +
        'identical to the f32 one and the A/B would report a dead heat. See PRECISION_ALIAS in precision.mjs.',
    );
  }
  const rewritten = source.replace(PRECISION_ALIAS, (_all, head, type, tail) => `${head}${HALF_TYPES[type]}${tail}`);
  const leftover = LEFTOVER_ALIAS.exec(rewritten);
  if (leftover) {
    throw new Error(
      `[hero] precision alias left at 32-bit width by the f16 rewrite: ${leftover[0].trim()}. ` +
        'Add its type to HALF_TYPES in precision.mjs (or do not name it `hreal*`).',
    );
  }
  return F16_PREAMBLE + rewritten;
}

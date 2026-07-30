# Hero black hole — G-buffer contract

The hero renderer is split into a **one-shot bake** (expensive geodesic
raymarch, runs only when the camera/geometry changes) and a **cheap frame pass**
(reads the baked G-buffer and shades it). This document is the contract between
the infrastructure and the two shading workstreams.

```
bake.wgsl ──► G-buffer (MRT, 4 attachments) ──► shade.wgsl ──► canvas
 one-shot                                       every frame
                                                   ├── disk.wgsl   (disk pixels)
                                                   ├── stars.wgsl  (escaped rays)
                                                   └── tonemap()   (ACES + vignette, in place)
```

**Two passes, not three.** `shade.wgsl` tone maps in a register and writes the
swap chain directly. There is no intermediate `scene` target and no
`composite.wgsl`: that pass was pure bandwidth (an `rgba16float` write plus a
filtered 1:1 read of the whole frame, ~15.8 MiB of traffic at 1920x1080) for a
handful of ALU ops. See [Tone mapping](#tone-mapping-lives-at-the-end-of-shadewgsl).

## File ownership

| File | Owner | Edit? |
|---|---|---|
| `bake.wgsl` | infrastructure | no |
| `gbuffer.wgsl` | infrastructure | no (read it — it defines `GBufferSample`) |
| `shade.wgsl` | infrastructure | no (thin dispatcher + debug views + tone map) |
| `renderer.ts` | infrastructure | only to add a new look field (see below) |
| `hero-black-hole.tsx` | infrastructure | only to add a GUI row for a new field |
| **`disk.wgsl`** | **disk workstream** | **yes — this is your file** |
| **`stars.wgsl`** | **stars workstream** | **yes — this is your file** |
| ~~`composite.wgsl`~~ | — | **deleted** — absorbed into `shade.wgsl::tonemap` |
| `debug-render.mjs` | shared harness | run it, extend it if useful |
| `noise-volume.mjs` | shared (renderer + harness) | only to change the lattice |

Two agents can work at the same time: the disk agent touches only `disk.wgsl`,
the stars agent only `stars.wgsl`. Neither needs `shade.wgsl` or `renderer.ts`.

## MRT decision

vgpu supports multiple render targets in a single pass
(`gpu.target({ colors: [{ format }, ...] })`, documented in
`packages/vgpu-api/src/target.docs.md`), and a `gpu.effect` fragment entry may
return a struct with several `@location` outputs. So the bake is **one pass with
4 color attachments** — no multi-pass fallback.

### The byte budget (read before adding an attachment)

The attachment *count* is not the binding constraint — 8 are allowed and we use
4. The constraint is **`maxColorAttachmentBytesPerSample`, which WebGPU only
guarantees to be 32**, and the layout spends exactly 32:

| Attachment | Format | Bytes |
|---|---|---|
| `gHit1` | `rg32float` | 8 |
| `gHit2` | `rg32float` | 8 |
| `gSky` | `rgba16float` | 8 |
| `gView` | `rgba16float` | 8 |
| | | **32 / 32** |

The single-hit layout it replaced (`rgba32float` + 2x `rgba16float`) also cost
exactly 32, so the second disk hit was paid for entirely out of redundancy, not
out of extra bandwidth:

- the normalized disk radius was stored, though it is just
  `(|plane| - ISCO) / (diskOuter - ISCO)` — dropped, recomputed on read;
- `side` was stored, though a photon landing on the top face is by definition
  travelling downward — dropped, recovered as `-sign(dir.y)`;
- the hit direction was stored as a full `vec3`, though it is a unit vector —
  now 2 numbers (`y` + azimuth of `xz`), which is *more* accurate near edge-on
  than three f16s were.

If you need another channel, take it from redundancy the same way, or measure
`maxColorAttachmentBytesPerSample` on the target hardware first. Simply appending
an attachment will validate fine on a desktop GPU and fail on a spec-minimum
device.

## G-buffer layout

Created in `renderer.ts::createTargets`, size = canvas size in physical pixels =
**CSS size**: the dpr is pinned to `RENDER_DPR = 1`, not clamped to a range. See
[Cost defaults — dpr 1 and 60 fps](#cost-defaults--dpr-1-and-60-fps). Cleared to
`[0,0,0,1]` before the bake.

| # | Binding in `shade.wgsl` | Format | Channels |
|---|---|---|---|
| 0 | `gHit1` | `rg32float` | `x` = **first** hit world **x**, `y` = first hit world **z** |
| 1 | `gHit2` | `rg32float` | `x` = **second** hit world **x**, `y` = second hit world **z** |
| 2 | `gSky` | `rgba16float` | `xyz` = final lensed ray direction (unit), `w` = flags |
| 3 | `gView` | `rgba16float` | `xy` = direction at hit 1 `(y, azimuth)`, `zw` = direction at hit 2 `(y, azimuth)` |

Channel details:

- **hit position** — the disk lives on the plane `y = 0`, so only `(x, z)` is
  stored; the world position is `vec3f(gHit1.x, 0, gHit1.y)`. Range
  `[-diskRadius, +diskRadius]`. `f32` because half floats quantize to ~0.6 px at
  r ≈ 15 and visibly contour the radial noise.
- **"no hit" needs no flag** — the annulus starts at `ISCO = 3`, and a missing
  crossing is written as a plain `(0, 0)`, so `|xy| < ISCO` unambiguously means
  *no hit*. `decodeGBuffer` does that test for you and sets `isHit`.
- **`side` / normal is derived, not stored** — a photon that lands on the TOP
  face is travelling downward, so `side = -sign(dir.y)`. Still exposed as
  `+1` / `-1` / `0` on `GBufferSample`; test with `abs(side) > 0.5`, never
  `side == 1.0`.
- **direction encoding** — each hit direction is a unit vector stored as
  `(y, atan2(z, x))` and rebuilt exactly unit-length by `decodeGBuffer`.
- **flags** (`gSky.w`) — bit 0 (`1.0`) = `isBlackHole`, the ray is SHADOW; bit 1
  (`2.0`) = `escaped`, the ray really did reach the escape radius moving outwards
  and only then is `gSky.xyz` a meaningful sky direction. They are mutually
  exclusive, and exactly one of them is always set. Decoded for you into two
  `bool`s.
  - `isBlackHole` covers **two** endings: the ray fell inside the horizon
    (`r < 1.004`), or it ran out of the bake's 768 steps while still orbiting.
    The second case is the band of impact parameters just above
    `b_crit = 3*sqrt(3)/2 = 2.598`, which winds around the photon sphere many
    times. It used to be flagged `escaped`, with `gSky.xyz` holding the direction
    the ray happened to be pointing when the loop gave up (measured at
    `b = 2.62`: 117 deg of deflection instead of the true 252 deg) — i.e. a
    random sky direction, which is speckle waiting to happen. Black is the far
    better approximation for a photon that is still circling, so it is folded
    into the shadow. Cost: the shadow edge is ~2 px larger at 720p (188 -> 190 px
    measured), which is inside the ~4 % the flat-frame ray launch already adds.
- **normalized disk radius** is recomputed from the hit position on read, and
  arrives as `diskUv.x`, clamped `0..1` (`0` at ISCO, `1` at `diskRadius`).
- The ray is **not** terminated at either disk hit: the bake keeps marching, so
  `gSky` / the flags describe what is *behind* both disk layers. That is what
  lets the disk shader be semi-transparent and let stars bleed through its
  fringes.

Units: `HORIZON = 1.0` (Schwarzschild radius), `ISCO = 3.0`, camera distance
`settings.distance` (default 13.5), escape radius `max(30, distance + 8)`.

### The two disk hits

A geodesic that grazes the hole crosses the disk plane **more than once**, so the
front band hides a second, lensed image of the disk. The bake records the first
two crossings of the `[ISCO, diskOuter]` annulus, nearest first:

- `gHit1` = the crossing closest to the camera → the band you see in front.
- `gHit2` = the next crossing along the same ray → the image the front band
  partly hides. Only ever written when a first hit exists, so
  `back.isHit ⟹ front.isHit`.

With the shipped defaults the second hit covers ~3% of the frame, as a crescent
hugging the **bottom** of the shadow (the underside of the disk, bent up around
the hole). Debug view **7** shows exactly where it lands; the *disk layers*
dropdown (or `--diskLayers 1`) turns it off for an A/B.

Crossing detection uses a strict side change (`prevSide != curSide`, with
`y == 0` folded into the positive side) rather than `prevY * y <= 0`. With two
slots, a step landing exactly on `y = 0` would satisfy the product test on two
consecutive steps and record the same crossing as both hits.

### Decoded form — `GBufferSample`

`shade.wgsl` calls `decodeGBuffer()` (in `gbuffer.wgsl`) and passes the result
to your shader. You never touch raw texels. One call decodes **both** layers:

```wgsl
struct GBufferLayers {
  front: GBufferSample,  // crossing nearest the camera
  back: GBufferSample,   // the crossing it hides; isHit only if front.isHit
}
fn decodeGBuffer(hit1: vec2f, hit2: vec2f, sky: vec4f, view: vec4f, diskOuter: f32) -> GBufferLayers
```

Each layer is the same `GBufferSample` the single-hit version used — `shadeDisk`
shades one layer at a time and never has to know which one it got. Values that
belong to the ray rather than to a crossing (`rayDirection`, `isBlackHole`,
`escaped`) are duplicated into both layers.

```wgsl
struct GBufferSample {
  position: vec3f,      // world hit position, y == 0 (zero when !isHit)
  normal: vec3f,        // (0, ±1, 0), zero when !isHit
  diskUv: vec2f,        // x = radius 0 at ISCO -> 1 at rim, y = azimuth 0..1
  diskPolar: vec2f,     // x = world radius (>= ISCO), y = azimuth in radians (-PI..PI)
  rayDirection: vec3f,  // final lensed direction — for the sky
  viewDirection: vec3f, // direction at the disk hit — for Doppler
  side: f32,            // +1 / -1 / 0
  isHit: bool,
  isBlackHole: bool,
  escaped: bool,
}
```

## The two shading entry points

### `disk.wgsl`

```wgsl
export struct DiskLook {  // uniform payload, mirrored by HeroSettings.disk in renderer.ts
  brightness: f32, speed: f32, stretch: f32, detail: f32, turbulence: f32,
  density: f32, doppler: f32,
  spare0: f32, spare1: f32, spare2: f32, spare3: f32,
}

export struct DiskSample {
  color: vec3f,   // linear HDR emission (already multiplied by its own coverage)
  alpha: f32,     // 0..1, occludes the baked background behind the disk
  density: f32,   // raw coverage, shown by the "disk density" debug view
}

export fn shadeDisk(g: GBufferSample, look: DiskLook, time: f32, footprint: f32) -> DiskSample
```

- Called only when `g.isHit` is true.
- `time` is seconds since start (`gpu.time`).
- `footprint` is the screen-space size of one pixel measured in disk-noise
  units. It is computed with `fwidth` in `shade.wgsl` because derivatives are
  only valid in uniform control flow — you cannot call `fwidth` inside
  `shadeDisk`. Use it to fade octaves smaller than a pixel, otherwise the disk
  turns into moiré rings where it is seen edge-on.

#### `shade.wgsl` imports `SHEAR_PERIOD` from `disk.wgsl` (do not drop it)

`diskFootprint` has to measure the *same* coordinate the disk actually samples,
so it replicates the disk's Keplerian flow angle:

```wgsl
let noiseAngle = g.diskPolar.y - min(shade.time, SHEAR_PERIOD * 0.5) * (disk.speed * 0.55 / pow(g.diskPolar.x, 1.5));
```

The `min` is load-bearing. Keplerian rotation is differential, so the accumulated
phase `t * omega(r)` has a radial derivative `t * omega'(r)` that grows **without
bound**: with a raw `shade.time` the measured `fwidth` grows linearly with the
clock, saturates the `min(..., 4.0)` clamp after a couple of minutes, and from
then on every noise octave fades to its mean — the disk slowly melts into a gray
smear during a long session. That is a footprint bug, not a look bug: it happens
even with a completely frozen noise field.

`disk.wgsl` bounds its own shear by advecting the differential part of the
rotation with a recycled sawtooth clock (two lobes half a period out of phase,
cross-dissolved), so the coordinate it samples never accumulates more than
`SHEAR_PERIOD / 2` seconds of shear. Clamping the time here makes the estimator
agree with that, and keeps the whole thing stable as `t -> infinity`.

`SHEAR_PERIOD` is exported by `disk.wgsl` (same pattern as `HORIZON` / `ISCO`
from `gbuffer.wgsl`) because the disk owns the flow model. If the disk workstream
changes its recycling period, this estimator follows automatically — that is the
point of importing it instead of hard-coding a number here. **Do not replace it
with a literal, and do not put the raw `shade.time` back.**
- `shade.wgsl` composites as
  `mix(background, color, alpha) + color * alpha * 0.35` (a small additive
  glow term), and then tone maps that value in place — exposure 1.15, ACES,
  vignette, gamma and full desaturation (`SATURATION = 0` — the hero is
  monochrome, do not fight it with hue work). See
  [Tone mapping](#tone-mapping-lives-at-the-end-of-shadewgsl).
- **What `shadeDisk` returns is still linear HDR**: values above 1 are expected
  and intended (they are what makes the edge-on band read as incandescent). The
  tone map is applied once, by `shade.wgsl`, after both layers are composited —
  never inside `disk.wgsl`.

#### The tiled noise volume

`shadeDisk` does not hash its noise any more. The value-noise lattice is baked
once into an `r8unorm` `texture_3d` by `noise-volume.mjs` — which both
`renderer.ts` and `debug-render.mjs` import, so the browser and the headless
harness get byte-identical volumes — and each of the ~52 noise evaluations per
pixel is now one trilinear fetch instead of eight inline hashes (~215 ALU).
`disk.wgsl` documents the kernel itself; what matters at this level:

- **The cubic fade is applied to the coordinate, not to the values.** Hardware
  filtering is linear; sampling at `(i + u + 0.5) / size` with
  `u = f*f*(3-2f)` makes the linear weights land on the cubic ones. Sampling at
  `(i + f + 0.5) / size` would be plain linear interpolation and would visibly
  soften every ridged filament. This is the single most breakable line here.
- **The sampler must be `repeat` on all three axes** — that is what closes the
  tile. It also means the shader does no coordinate wrapping of its own.
- **The tiling is invisible in φ by construction.** The disk samples through a
  cylindrical embedding (`cos`/`sin` of the azimuth on XY, radius on Z), which
  is already exactly periodic in the azimuth, so there is no seam to align.
  Only the radial axis actually wraps, at 64 noise units.
- **64³ (256 KiB) is the shipped size, and 128³ is not better.** Measured
  side by side, 128³ has no less visible repetition and slightly *lower* frame
  contrast, for 8x the memory. `--noiseSize 128` in `debug-render.mjs` exists so
  you can re-check that yourself, not because it is a quality setting.

##### Why the lattice has a seed

Tiling re-rolls which *realization* of the noise you get, because wrapping the
radial axis re-slices every octave. That is not a small effect: the disk's
large-scale contrast is set by the `flow` layer, which spans only about three
lattice planes, so it is a very small sample. Re-rolling the inline-hash noise
of the previous implementation (shifting every octave's z by a constant) moves
the frame's masked luma std over 0.092..0.117 and the blown-out-crest fraction
over 0.61%..2.13% — and the look the hero shipped with sits at the very top of
that range. It is a lucky draw, and the disk was hand-tuned against it.

So `NOISE_VOLUME_SEED` is chosen, not defaulted: it is the lattice, out of 16,
whose contrast statistics land closest to that shipped frame, verified on times
it was not selected on. If you ever regenerate the volume, expect to re-pick it,
and expect the filaments to be *arranged* differently — that is realization
noise, not a regression.

##### Measuring it yourself

The tiled volume was landed WITHOUT a real-GPU measurement (the machine it was
developed on has no GPU: everything ran on lavapipe, where a trilinear fetch is
eight dependent scalar loads and the tiled path is ~28% *slower*). It has one
now, and the number is why this section is short: on a real GPU the lattice is
**1.24x faster** than the eight inline hashes it replaced (4.10 ms → 3.30 ms of
shade-pass GPU time). Both implementations used to live in this file behind a
`const` gate so the `?debug` panel could switch and time them; once the number
came in, the loser was deleted. Same story for a half-precision arm, which came
out **1.18x slower** than plain f32 (3.88 ms) and is likewise gone.

What remains is the timer, under **perf (frame time)** in the `?debug` panel:

| Control | What it does |
|---|---|
| **`▶ measure frame time`** | Times ~180 frames of the real loop, prints the full JSON and puts it on the clipboard. One click, nothing to configure. |
| `last measurement` | The headline, with `(copied)` when the clipboard has it. If the page lost focus during the run the browser refuses the write, so it says `(click the page to copy)` and the next click anywhere does it. |

What lands on the clipboard is the pasteable form of the run: the full
`MeasureResult` (both medians, both means, sample count, method, resolution) plus
the context nobody remembers to include — timestamp, user agent and
`devicePixelRatio`. The console gets the identical text:
`JSON.stringify(..., null, 2)`, never the raw object, because Chrome copies a
logged object as the literal string `{...}`.

**Prefer the GPU number when it is there.** With `timestamp-query` available
(requested only under `?debug`) the result includes the shade pass's own GPU
time, which excludes the bake, the present and all CPU submit cost. Wall-clock
ms/frame is capped **twice** — by the display, and by the renderer's own 60 fps
pacer — so on a healthy machine it reads ~16.7 ms whatever the shader costs, and
cannot show a shader change at all. The panel detects that case and flags it as
`VSYNC-CAPPED`; the result also carries `targetFps: 60` so a pasted measurement
says which cadence produced it.

`measure()` deliberately does **not** turn the pacer off: a frame time collected
at a cadence the hero never runs at would be measuring a different renderer. The
timestamp query is unaffected by pacing — it times the shade pass on the GPU
timeline, not the interval between presents — so the A/B number keeps working
exactly as before. What the cap does change is the shape of a run: ~180 samples
at 60 fps take ~3 s, so `MEASURE_MAX_MS` (4 s) now truncates the sample count on
displays the cap steps down harder (90/144 Hz → 45/48 fps). The stats are still
medians of >= 2 intervals, and the wall-clock median staying *above* ~16.7 ms is
the one wall-clock signal that still means something: the frame no longer fits in
its slot.

`measure()` renders 30 warmup frames first (absorbing any pending re-bake), then
suppresses the bake entirely while sampling, so a geodesic re-bake can never land
inside a sample. It also forces the loop to run even when the hero is scrolled out
of view — but it cannot beat a hidden tab, where the browser stops
`requestAnimationFrame` outright, so it rejects after 6 s of no frames instead of
hanging.

**To measure a change to the shade shader**, measure before and after: there is
one pipeline now, so the A/B is across two builds rather than two arms in the
same build. If you need them side by side in one session again, the mechanism
that was deleted is worth re-reading in git history (`a93cdf6` and its parent):
one separately compiled pipeline per arm, selected by rewriting a `const` gate or
a type alias in the shared source, never a uniform `if` — a uniform branch keeps
both arms resident and the register allocator bills the cheap one for the
expensive one's live values.

### `stars.wgsl`

```wgsl
export struct StarLook {  // uniform payload, mirrored by HeroSettings.stars
  brightness: f32, density: f32, contrast: f32, warmth: f32, twinkle: f32,
}

export fn shadeStars(direction: vec3f, look: StarLook, time: f32, ddx: vec3f, ddy: vec3f) -> vec3f
```

- Called when the ray escaped and did not hit the disk-facing black hole
  (`!isBlackHole && escaped`).
- `direction` is `g.rayDirection`, i.e. **already bent by gravity** — lensing of
  the star field is free, do not re-derive it.
- The camera is frozen by the bake and there is **no pointer parallax**: the sky
  only ever moves as a whole, together with the disk, when the mouse rotates the
  scene around Y (`Shade.sceneYaw`, see below). `shade.wgsl` hands you the
  already-rotated `rayDirection`, so `stars.wgsl` needs no changes and must not
  add a rotation of its own — a second, different rate would slide the sky
  against the disk. Apart from that, `time` is the only thing that may move
  (e.g. twinkle).
- Returns linear HDR color.

##### The field itself (three species, power-law magnitudes)

Three jittered cube-face cell grids, each with its own angular star size, and a
power-law brightness distribution *inside* every one of them:

| species | cells / face | fill | angular radius | = px @720p | peak | count in frame |
|---|---|---|---|---|---|---|
| anchors | 36 | 0.75 | 1.10e-3 rad | 1.11 (`gain` 1.0) | 1.00 | ~280 |
| field | 93 | 0.75 | 0.70e-3 rad | 0.70 (`gain` 0.49) | 0.45 | ~1890 |
| dust | 151 | 0.75 | 0.40e-3 rad | 0.40 (`gain` 0.16) | 0.22 | ~4980 |

- **Magnitudes are drawn from truncated star counts**, `P(flux > f) ~ f^-2` on
  `[peak / contrast, peak]`, inverted in closed form. `contrast` (the panel's
  *magnitude range*) is the brightest:faintest ratio inside a species; at the
  shipped `13` about 2% of a species lands within a factor of two of its peak, so
  bright stars are rare and each reads as an individual. Slope 2 rather than the
  Euclidean 1.5 both biases a little further towards faint stars and collapses the
  inverse CDF to one `inverseSqrt` and the mean to `2 / (contrast + 1)` — which
  matters at one hash per species. The tone map then spreads the ~7200 stars in a
  1280x720 frame over roughly 25 at display 210+, 175 at 160+, 630 at 90+ and
  ~4700 visible at all; the rest is sub-threshold texture. `contrast = 1` collapses
  the distribution and reproduces the old uniform field.
- `brightness` is a **pure exposure**: `stars.wgsl` owns the absolute scale
  (`STAR_INTENSITY` plus each species' peak) and `1.0` is the calibrated look,
  with the brightest anchors landing at the top of the ACES curve. `density`
  multiplies every species' per-cell probability (`fill`), so it is a true
  population knob — the previous one was clamped to 1 inside the shader and dead
  above it, which is why the shipped `2.92` did nothing.
- Star size varies **per species, never per star**: brightness is the hierarchy
  inside a species, angular size is the hierarchy between them (and it is what the
  prefilter turns into `gain`, so the three read as three distances).
- **Colour** is a chroma-only temperature ramp, ~3900 K to ~9500 K, both ends
  normalised to Rec.709 luma 1, blended toward white by `warmth`. Temperature
  therefore cannot change a star's brightness at any setting. NOTE: `tonemap` in
  `shade.wgsl` runs `SATURATION = 0`, i.e. the hero is fully desaturated on output,
  so this is currently invisible **by construction** (measured: max channel spread
  0 over a whole 1280x720 frame). It costs ~4 ALU per star and turns on the moment
  that constant is lifted off zero.
- **Gnomonic correction** — cube-face cells are equal area in `(u, v)`, not in
  solid angle (`dOmega/dA = (1 + u^2 + v^2)^-1.5`, 1 at a face centre and 1/5.2 at
  a cube corner). So `fill` is scaled by `(1 + u^2 + v^2)^-1.5` and the angular
  radius by `(1 + u^2 + v^2)^0.75`: stars per steradian and angular star size are
  both constant across the sky. Without it the frame carries a smooth 2x density
  ramp that slides as the mouse yaws. The two factors cancel exactly in
  `fill * (radius * cells)^2`, so the mean radiance below is uniform too — which
  is the invariant an isotropic field must have.
- Resolution dependence is deliberate: `gain` grows with pixel density, so a
  sub-pixel star's peak value rises as pixels shrink (radiance is what is
  conserved, not the pixel value). At dpr 2 the dust species crosses one pixel and
  the field reads brighter and denser. The old field did the same; it is inherent
  to flux-conserving point sampling. The shipped hero pins the dpr to 1, so what
  the reader sees is the CSS-resolution end of that behaviour on every display.

#### Lensing aliasing — the sky PREFILTER (read this before tuning stars)

`shadeStars` takes the screen-space derivatives of the lensed direction and
prefilters the field with them. Do not remove them, and know they exist before
you judge how your field looks near the shadow.

Gravitational lensing compresses the entire sky into ever thinner rings as the
impact parameter approaches the photon sphere, so `rayDirection` sweeps faster
and faster across the screen as you approach the shadow. Measured with debug
view 6 at `500x500`, in units of the finest star cell (1/210 of a cube face):

| distance from shadow center | star cells crossed per pixel |
|---|---|
| 3.2 shadow radii | 0.5 |
| 2.25 | 1.0 |
| 1.5 | 2.3 |
| 1.2 | 5.1 |
| 1.05 and inward | 14 – 16 |

Past ~1 cell per pixel, point-sampling that map returns an essentially
uncorrelated cell per pixel, and the lensed sky degenerates into uniform
speckle — which reads as a band of *unlensed* stars hugging the shadow, the
exact opposite of the extreme bending that belongs there. On top of that, a star
is only 0.28 px across at 720p (0.53 px at 1350p), so even far from the hole
point sampling misses ~3 of every 4 of them and the survivors pop in and out as
the scene yaws.

`shade.wgsl` used to multiply the whole field by
`starLod = 1 - smoothstep(STAR_CELL, 4*STAR_CELL, skyFootprint)`, i.e. fade the
sky to black past one cell per pixel. **That fade is gone.** It was wrong in the
limit — radiance is conserved along rays (Liouville), so a magnified patch of sky
gets fainter per pixel and covers more of them, it never goes dark — and it cost
exactly the effect it was protecting: an 88 px ring of empty sky around the
shadow at 720p (24 % of the half-height, i.e. everything out to ~1.32 shadow
radii), which is precisely the annulus where the lensed images pile up. The
Einstein ring was the one thing guaranteed not to render.

What replaced it lives in `stars.wgsl` (`skyFilter`, `resolveSpecies`,
`starSpecies`) and is a
flux-conserving prefilter — a cone trace of a point sky:

1. **The filter is a pixel, and it is elliptical in sky space.** `shade.wgsl`
   hands `shadeStars` `dpdx`/`dpdy` of the lensed direction (both, separately).
   `skyFilter` differentiates the cube-face projection along a *pinned* face axis,
   inverts the resulting 2x2 Jacobian, and every star's falloff is evaluated in
   SCREEN space, where a pixel is isotropic by construction. A single scalar
   footprint (the old `max` over axes and components) is a 3–10x too wide filter
   along the well-sampled axis, because the lensing map is strongly anisotropic
   (~3x more sky per pixel radially than tangentially at 32 deg off axis with the
   shipped camera); it turns every star into a tangential dash. Do not go back to
   a scalar.
2. **Every star is at least one pixel wide, and pays for it in brightness.**
   `starPixels = faceRadius / sqrt(|det J|)` is the star's own radius in pixels —
   the determinant carries both the local magnification and the resolution — and
   `gain = min(1, starPixels^2)` is the fraction of the pixel it covers, i.e. the
   flux-conserving dimming. `faceRadius` is per SPECIES (the three have different
   angular sizes), the determinant is per pixel, so `SkyFilter` exports
   `pixelsPerFace = 1 / sqrt(|det J|)` and each species converts with it. This also fixes the sub-pixel
   sampling: at `>= 1 px` the 4.9e-4 f16 quantum of `gSky` no longer matters, so
   the sky stops flickering as the scene yaws, and `gSky` does not need a higher
   precision format.
3. **One tap per species, and the population is designed around it.** Budget:
   three `pcg3d` per pixel for the whole sky — the count this file had *before* the
   prefilter, and a quarter of the 2x2-tap version that first shipped with it.
   Everything the prefilter adds is per-pixel, not per-star (one cube-face
   projection pair, one 2x2 inverse, two square roots).

   A prefiltered star is at least a pixel wide, so with a single tap it has to fit
   inside its own cell — only the pixels whose own cell owns the star can see it.
   That is why `fill` is high and `cells` is low: a given star count is reachable
   with many sparse cells or few crowded ones, and only the crowded layout is safe.
   At the shipped numbers a star's radius is 0.05 / 0.12 / 0.20 of a cell at the
   frame edge (0.09 / 0.22 / 0.36 mid-frame). Worst case — the 0.8 jitter pushing a
   dust star to 0.1 cells from an edge — cuts the profile where the squared
   smoothstep has already fallen to 0.25 and costs ~8% of that star's flux: a
   brightness nudge on the faintest species, not a shape (at 1 px radius a "half
   moon" is one pixel). Closer in, where a cell compresses to about a pixel, the
   clip reaches ~15-20%, and that band is exactly where the mean-radiance limit
   takes over, so it is absorbed rather than displayed. Measured cost of the whole
   trade-off: the radial profile of the sky moves by 4-18% against the 2x2 version
   (`/home/user/reports/stars-rewrite/`), with no visible clipping or grid.

   Do not "fix" a clipping worry by making cells finer — that makes it worse. Make
   `fill` bigger and `cells` smaller.
4. **The mean-radiance limit.** Once a pixel spans more than a few cells along the
   footprint's major axis, no small tap count can find all the stars in it, and
   the exact band-limited value stops depending on which ones they are:
   `mean = peak * E[flux] * fill * STAR_FLUX_AREA * (faceRadius * cells)^2`
   — a constant, the species' own surface brightness, with the footprint cancelled
   out. That is Liouville again, and it is what `starSpecies` cross-fades to
   between 1 and 3 cells per pixel, per species (the 36-, 93- and 151-cell grids
   alias at very different rates, which is exactly what one global threshold could
   not express). `E[flux] = 2 / (contrast + 1)` is the closed-form mean of the
   count distribution, so the limit stays exact for any panel setting. The old comment called this mean "essentially black"; it is small,
   but it is the same brightness the unlensed sky already has, which is why fading
   past it left a visible hole.

Measured effect of the prefilter itself on the sky alone (`--disk.brightness 0`,
1280x720, radial mean of the de-gamma'd image): the 170–230 px band goes from
**exactly 0** to `0.5–1.5e-4`, the far field (>= 410 px) is unchanged within
+/-13 %, and the transition band (250–390 px) reads 0.2–0.8x of the old value
because the same flux is now spread over many faint pixels instead of a few bright
ones (ACES compresses the faint end, so display-space energy drops even though
radiance is conserved).

Measured effect of the **field rewrite** on top of that (same method, uniform field
-> three species with power-law magnitudes): the far field drops to 0.55x and the
190–270 px ring band to 0.6-0.8x, i.e. the ring band gained ~30% *relative* to the
far field. The old field reached its brightness by carpeting the sky in ~6000
identical near-threshold dots; the new one spends the same order of flux on a
distribution, which is dimmer in total and reads far brighter per star.

Prerequisite, and the reason the two fixes ship together: the out-of-steps rays
just outside the shadow (see the `flags` bullet in the layout section) used to be
flagged `escaped` with a truncated direction. Relaxing the star LOD without
reclassifying them would have uncovered a ring of speckle from those garbage
directions right where the prefilter now keeps the sky alive.

## Uniforms and bindings (entry shader)

| Binding | Name | Type | Set from |
|---|---|---|---|
| `@group(0) @binding(0)` | `shade` | `Shade` uniform | `renderer.ts::setShadeUniforms` |
| `@group(0) @binding(1)` | `gHit1` | `texture_2d<f32>` | `gbuffer.colors[0]` |
| `@group(0) @binding(2)` | `gHit2` | `texture_2d<f32>` | `gbuffer.colors[1]` |
| `@group(0) @binding(3)` | `gSky` | `texture_2d<f32>` | `gbuffer.colors[2]` |
| `@group(0) @binding(4)` | `gView` | `texture_2d<f32>` | `gbuffer.colors[3]` |
| `@group(0) @binding(5)` | `disk` | `DiskLook` uniform | `settings.disk` (verbatim) |
| `@group(0) @binding(6)` | `stars` | `StarLook` uniform | `settings.stars` (verbatim) |
| `@group(0) @binding(7)` | `noiseVolume` | `texture_3d<f32>` (`r8unorm`) | `noise-volume.mjs::createNoiseVolume` |
| `@group(0) @binding(8)` | `noiseSampler` | `sampler` (linear, `repeat` xyz) | `noise-volume.mjs::noiseVolumeSampler` |

`Shade` carries `resolution`, `time`, `diskOuter`, `debugView`, `diskLayers` and
`sceneYaw` — nothing camera-related, the bake froze it (`sceneYaw` rotates the
*scene*, not the camera; see below). G-buffer textures are read with
`textureLoad` (no sampler): the 32-bit float formats are not filterable, and
interpolating G-buffer values across silhouettes would be wrong anyway.

Bindings 7 and 8 are the **only** sampled resources in the pipeline, and they
belong to the disk's noise (see ["The tiled noise volume"](#the-tiled-noise-volume)).
Note that
`disk.wgsl` does not declare them: the disk module takes the texture and the
sampler as ordinary function parameters and `shade.wgsl` passes them in, so the
rule that **the entry shader owns every `@group`/`@binding`** still holds. The
volume is created once, outlives resize (it is not part of `Targets`), and so
`renderer.ts` has to destroy it explicitly in `dispose` — `destroyTargets` will
not do it for you.

### How the two disk layers are composited

`shade.wgsl` calls the **same** `shadeDisk` twice — once per layer — and
composites strictly back to front:

```
color = stars (or black)
color = compositeDisk(color, backSample)    // the hidden crossing
color = compositeDisk(color, frontSample)   // the band in front

compositeDisk(under, s) = s.color * s.alpha * 1.35 + under * (1 - s.alpha)
```

That is emission-absorption "over": a layer adds its own emergent intensity
`color * alpha` (= `S * (1 - exp(-tau))`, the convention `disk.wgsl` documents)
and transmits `1 - alpha` of everything behind it. **Energy stays correct** —
the hidden image is attenuated by exactly the front band's opacity, so neither
layer can contribute twice.

Both composites run unconditionally: an absent layer has `alpha = 0`, which makes
`compositeDisk` an exact no-op, so a pixel with a single crossing produces
bit-for-bit what the single-layer version produced. The `1.35` is carried over
from that version (`mix(bg, S, a) + S*a*0.35`) and is applied identically to both
layers, so adding the second one does not change how bright the front band is.

Each layer gets its **own** noise footprint (`diskFootprint`), because the second
crossing sits at a different radius and azimuth. Both are measured in uniform
control flow — `fwidth` is undefined inside the `isHit` branches.

### Tone mapping lives at the end of `shade.wgsl`

There used to be a third pass, `composite.wgsl`, that sampled an intermediate
`rgba16float` scene target and graded it. It is gone: `shade.wgsl::tonemap` does
the same arithmetic on a value that is still in a register, and shade draws
straight to the swap chain.

```
color = compositeDisk(compositeDisk(stars, back), front)   // linear HDR
  ├── debugView 1..7 ─► return RAW, before the tone map
  └── debugView 0     ─► return tonemap(color, uv)
```

`tonemap` is, in this exact order:

| Step | Value |
|---|---|
| exposure | `* EXPOSURE` (1.15) |
| tone curve | ACES (Narkowicz fit), clamped to `0..1` |
| vignette | `* mix(0.72, 1.0, 1 - smoothstep(0.55, 1.15, length(uv - 0.5) * 1.6))` |
| gamma | `pow(color, 1/2.2)` |
| desaturation | `mix(luma, color, SATURATION)`, `SATURATION = 0` |

Three things about it are load-bearing:

- **The `uv` is the canvas uv, not a disk coordinate.** The vignette is a lens
  effect and must stay anchored to the frame. It is the same varying the old
  composite pass received, because that pass sampled the scene 1:1 with no
  offset — which is why the fusion is a no-op image-wise.
- **The order does not commute.** The vignette darkens the *tone mapped* value
  and the gamma comes *after* it. Swapping any two of these visibly changes the
  falloff at the corners.
- **Debug views return before it** (see [Debugging](#debugging)).

`EXPOSURE` and `SATURATION` are `const`, not uniforms: nothing in the panel or
the harness ever varied them, and keeping them as uniforms would have kept a
bind group alive to carry two numbers that never change.

Measured cost of the fusion: one full-screen pass, one `rgba16float` write and
one filtered read of the whole frame (~15.8 MiB of traffic at 1920x1080), plus
the allocation itself. Verified image-identical against the pre-fusion harness
over `t = 0 / 2.5 / 9.9 / 10.1`, `yaw = 0 / ±0.15`, `diskLayers = 1 / 2`, all 8
views: **worst RMSE 0.18/255, max error 1/255** (pure 8-bit rounding — the old
path quantized through f16 first).

### Adding a look parameter

Free option (no shared files): use `spare0..spare3` for the disk. The star
uniform deliberately has no spare knobs: its previous population and size spares
were removed when the public brightness-range controls and uniform point size
became the shipped design.

Permanent option, three one-line edits:

1. `disk.wgsl` / `stars.wgsl` — add the field to `DiskLook` / `StarLook`.
2. `renderer.ts` — add the same name with a default inside the `disk: { ... }`
   or `stars: { ... }` block of `defaultHeroSettings()`, and mirror it in the
   `DiskLook` / `StarLook` TS interface.
3. `hero-black-hole.tsx` — add one `folder.add(settings.disk, 'name', min, max, step)` row.

The JS object is uploaded verbatim, so **the field names must match the WGSL
struct exactly** — a missing or extra field is a runtime binding error.

## Shipped defaults

Picked by the user in the panel and captured with **copy JSON**. They live in
`defaultHeroSettings()` (`renderer.ts`) and are mirrored by `DEFAULT_SETTINGS` in
`debug-render.mjs` — keep the two in sync or the harness stops rendering the same
image as the page.

| Geometry (re-bakes) | | Disk (per frame) | | Stars (per frame) | |
|---|---|---|---|---|---|
| `cameraY` | `0.085` | `brightness` | `0.098` | `brightness` (exposure) | `1` |
| `distance` | `13.5` | `speed` | `0.75` | `density` | `1` |
| `diskRadius` | `6.9` | `stretch` | `5.75` | `contrast` (magnitude range) | `13` |
| `fov` | `2.67` | `detail` | `3.44` | `warmth` (colour temperature) | `0.5` |
| `centerY` | `0` | `turbulence` | `4.46` | `twinkle` | `0` |
| | | `density` | `1.38` | | |
| | | `doppler` | `1.21` | | |
| | | `spare0..3` | `0.43`, `-0.25`, `-0.67`, `0.69` | | |

Plus `debugView: 0`, `diskLayers: 2` and `mouseYaw: 0.15` (the mouse rotation
amplitude, ~8.6 deg each way; slider `0..0.4`, `0` disables the interaction).

Two things to know about these values:

- **`disk.brightness = 0.098` is not a typo.** `disk.wgsl` carries a large
  internal gain, so the useful range of this knob is near zero; its slider is
  `0..0.6` with a `0.002` step for that reason. If `disk.wgsl` ever rebalances
  its gain, this default has to be re-picked with it.
- **The star defaults sit mid-slider on purpose**, unlike the pinned-at-maximum
  set they replace (`brightness 3` of `0..3` with `brightnessMin === brightnessMax
  === 4`, which made every star identical, plus a `density 2.92` the shader
  clamped to 1 — three effectively dead knobs). Now `brightness` is a pure
  exposure with `1.0` calibrated and headroom to `3`, and `density` scales the
  per-cell probability directly. Two things to know:
  - `density` is honest up to ~1.3; past that the species saturate one by one as
    `fill * density` clamps at 1 (the shipped `fill` is `0.75` for all three), so
    the slider's top end compresses rather than dying.
  - `warmth` is a no-op in the shipped image because `tonemap` runs
    `SATURATION = 0`. It is not broken — see the `stars.wgsl` section.
- Every other default is kept with headroom on both sides, and each defaults
  revision has needed the check: `detail`/`turbulence` were once pinned at their
  maximum, and the star sliders themselves were widened from `0..1` / `0..3` to a
  shared `0..4` when an earlier `1` / `2.93` landed on their old tops. When you
  change a default, check its slider still has room.

## Cost defaults — dpr 1 and 60 fps

Two constants in `renderer.ts` set what the hero costs, and neither is a look
decision. Heat is **work per frame x frames per second**, and before these two the
page handed both factors to the reader's hardware: a Retina ProMotion laptop ran
2.25x the fragments at 2x the rate of a plain 60 Hz 1x display — ~4.5x the work
for an image nobody could tell apart in motion.

| Constant | Value | What it bounds |
|---|---|---|
| `RENDER_DPR` | `1` | Pixels: every buffer in the chain is CSS size x this |
| `TARGET_FPS` | `60` | Rate: the rAF loop skips ticks above it |

**`RENDER_DPR = 1`** is pinned, not clamped to a `[min, max]` range like the
`MAX_DPR = 1.5` it replaced. It is the single biggest lever on cost in the whole
hero — the bake is a geodesic raymarch per pixel and the G-buffer is 32 bytes per
sample — so at dpr 1 a Retina hero shades **~56% fewer fragments** than at 1.5 and
~75% fewer than an uncapped 2. What it buys back is a softer photon-ring edge,
which is the cheapest place to spend softness in a scene that is otherwise smooth
gradients and glow.

Because it is a fixed number, physical size **is** CSS size, and that has two
consequences worth knowing:

- the value is used in **both** places that can size the swap chain,
  `surface({ dpr })` at init and the `resize()` path — they must agree, or the
  shade pass (a 1:1 `textureLoad` of the G-buffer) would sample at the wrong
  scale;
- `ResizeObserver` on the canvas is now the **only** resize input. The old
  `window` `resize` listener existed to catch a `devicePixelRatio` change (moving
  the window to another monitor), which can no longer change any buffer size, so
  it is gone. `resize()` reads `clientWidth/clientHeight` — the same two
  properties vgpu's surface uses — so the two chains cannot round a fractional
  CSS width to different integers.

**`TARGET_FPS = 60`** is enforced by the loop itself (`startPacedLoop`), not by
vsync: a tick renders only if `timestamp - lastRendered >= 1000/60 -
FRAME_PACING_EPSILON_MS`. Notes, in the order they bite:

- The **epsilon (2 ms) is load-bearing.** A bare `>= 1000/60` halves the rate on a
  display that already runs at 60 Hz, because vsync intervals land on both sides
  of 16.667 ms and every other frame misses by microseconds. It also has to stay
  well *below* one refresh interval of the displays being capped (8.33 ms at
  120 Hz), or two consecutive ticks would pass and the cap would do nothing.
- Since rAF only fires on a refresh boundary, the achievable cadence is
  `refreshHz / n`: **60 and 120 Hz both land exactly on 60 fps**, while 90 and
  144 Hz step down to 45 and 48 (the next step up, 90 and 72, would break the
  cap).
- It paces on the **rAF timestamp**, not `performance.now()`: the timestamp is the
  frame's vsync time, so intervals are clean multiples of the refresh period,
  while the callback's own dispatch latency jitters by whole milliseconds and
  would randomly trip the threshold.
- It is a hand-rolled rAF chain rather than `frameLoop(gpu, cb, { fps: 60 })`
  because vgpu's knob compares intervals exactly (no epsilon — the 30 fps trap
  above), and because a skipped tick here opens **no frame at all**: gating inside
  the frame callback would still create a command encoder and submit an empty
  command buffer 60 times a second. `dispose()` stops the loop before
  `gpu.dispose()`, which is the ordering vgpu's own scheduler registration used to
  guarantee.
- Nothing in the animation depends on the cadence: the disk clock is in seconds
  and the mouse yaw is smoothed with `1 - exp(-dt/tau)`. That is a precondition,
  not a coincidence — see [Mouse rotation](#mouse-rotation--shadesceneyaw-no-re-bake).
- `measure()` measures the paced loop and reports `targetFps`; the shade pass's
  GPU time is what survives, exactly as under a vsync cap. See
  [Measuring it yourself](#measuring-it-yourself).

## Bake invalidation

| Setting | Re-bakes? |
|---|---|
| `cameraY`, `distance`, `diskRadius`, `fov`, `centerY` (= `BAKE_KEYS`) | **yes** (automatic, throttled) |
| canvas resize (CSS box; the dpr is pinned, so a monitor change resizes nothing) | **yes** (immediate) |
| `re-bake` button / `renderer.rebake()` | **yes** (immediate) |
| everything under `disk`, `stars`, `debugView` and `diskLayers` | no — per-frame |
| `mouseYaw` / moving the mouse (scene rotation) | **no, by design** — one uniform per frame |

### How invalidation is detected

The render loop **polls** `BAKE_KEYS` every frame and compares them against the
values the current G-buffer was baked with. Nothing has to call `rebake()` — the
GUI geometry sliders deliberately have **no `onChange` wiring**.

That is on purpose. Geometry values are pure bake inputs; the shade pass never
reads them. If an invalidation were ever missed, the slider would silently do
nothing (this actually happened with `fov`). Polling makes that failure mode
impossible, and it also covers settings mutated from the console or by pasting
a JSON blob.

### Re-bake throttle

Dragging a slider fires a change per pointer tick, and a bake is a full
768-step geodesic trace per pixel. So bakes are throttled to one per
`BAKE_THROTTLE_MS` (200 ms, in `renderer.ts`) **with a guaranteed trailing
edge**: because the "baked" snapshot keeps differing from `settings` until a
bake actually runs, the loop necessarily catches the final released value one
frame after the window closes. Explicit `rebake()` and resize bypass the
throttle.

## Camera, orientation and framing

There is **no camera parallax**: the bake freezes the camera and the G-buffer is
sampled 1:1 (`uv` -> texel, no offset). The camera never moves, not even for the
mouse — what the mouse moves is the **scene**, see the next section.

## Mouse rotation — `Shade.sceneYaw` (no re-bake)

The pointer rotates the whole scene around the **Y axis**, and that reuses the
baked G-buffer *exactly*, so a mouse move costs one uniform write and never a
bake.

**Why it is exact.** The scene is invariant under rotation about Y: Schwarzschild
gravity is spherically symmetric and the disk is an axisymmetric annulus on
`y = 0`. So rotating the scene by `theta` and re-baking would produce the same
photons as rotating the *baked result* by `theta`.

> **Precondition — read before adding geometry.** This stops being exact the
> moment the Y symmetry breaks: a warped or tilted disk, an occluder, a
> non-spherical metric, or any world-space lighting that does not rotate with the
> scene. Anything like that means the mouse has to go back to a real re-bake.

**Sign.** `Shade.sceneYaw` is an **active rotation of the scene**;
`Bake.yaw` is a **camera** yaw. They are opposite:

```
scene sceneYaw = +theta   ==   camera Bake.yaw = -theta
```

so the frame pass evaluates the baked samples in the inverse frame,
`R_y(-sceneYaw)`, with

```
R_y(a)(x, y, z) = (cos(a)x + sin(a)z, y, -sin(a)x + cos(a)z)
```

Mouse to the **right** => `sceneYaw > 0`. If the UX ever wants the opposite
feel, flip the *mouse mapping* in `renderer.ts`, never the shader formula.

**What gets transformed.** `shade.wgsl` decodes the G-buffer normally and then
runs `rotateSample()` on **both** layers, front and back:

| Quantity | Under `sceneYaw = theta` |
|---|---|
| `position` (`y = 0`) | `R_y(-theta) position` |
| `viewDirection` | `R_y(-theta) viewDirection` |
| `rayDirection` | `R_y(-theta) rayDirection` |
| `diskPolar.y`, `diskUv.y` | `azimuth + theta`, wrapped to `(-PI, PI]` |
| `diskPolar.x`, `diskUv.x`, `normal`, `side`, `isHit`, flags | unchanged — invariant |

Position, view direction and ray direction have to rotate **together**. The
matrix is orthogonal, so every dot product survives: Doppler beaming
(`dot(tangent, -viewDirection)`) and the edge-on term (`abs(viewDirection.y)`)
come out bit-for-bit the same as in the unrotated scene. Rotating only the disk
azimuth would be a phase scrub, not a rotation — it would leave the sky behind
and slide the bright Doppler lobe. Likewise, disk and stars must rotate at the
**same** rate.

**Footprints are measured BEFORE the rotation.** `diskFootprint` and
`skyFootprint` take a per-component `max` of `fwidth` — an L-inf norm, which is
*not* rotation invariant, even though a rigid rotation preserves the true
derivative magnitude. Measuring after the rotation would make the LOD breathe by
up to ~sqrt(2) while the mouse moves. So `fs_main` measures on `baked` and only
then builds the rotated layers.

**Renderer side** (`renderer.ts`): a passive `window` `pointermove` listener
(the canvas is `pointer-events-none`, events bubble up from the hero copy)
stores `pointerXNormalized` in `-1..1`; nothing else. Per frame the loop
computes `target = pointerXNormalized * settings.mouseYaw` and smooths it
frame-rate independently with `k = 1 - exp(-dt / 0.325s)` (`dt` clamped to
0..0.1 s), which reproduces the classic `lerp(..., 0.05)` feel at 60 fps without
doubling the speed at 120 Hz. That independence is what lets the loop pace itself
to 60 fps (see [Cost defaults](#cost-defaults--dpr-1-and-60-fps)) without the
mouse feeling any different: `dt` grows, `k` grows with it. Touch and pen are ignored (`pointerType`), and
`pointerout` off the window, `blur` and a hidden tab all send the target back to
0 so the scene drifts home instead of freezing off-center. The first frame is
always exactly 0. All four listeners are removed in `dispose()`.

**Verified equivalence** (harness, `960x540`, `t=2.5`, RMSE on the 8-bit PNGs):

| Comparison | `final` | `diskuv` | `raydir` |
|---|---|---|---|
| `sceneYaw = 0` vs the pre-feature shader | **0** (bit-identical) | **0** | **0** |
| `--yaw 0.15` vs `--bakeYaw -0.15` (real re-bake) | 0.0050 | 0.0014 | 0.0004 |
| `--yaw 0.15` vs `--bakeYaw +0.15` (wrong sign) | 0.0289 | 0.0435 | — |

The residual in the matching pair is silhouette-edge and geodesic-integration
noise (it lives on one-pixel outlines in the diff), and it is 6x to 30x smaller
than the wrong-sign pair — which is how the sign was pinned down.

The only other motion in the scene is `time` inside `disk.wgsl` (and
`stars.wgsl` if it uses twinkle).

### uv orientation — read this before touching `bake.wgsl`

vgpu's generated fullscreen vertex shader (`fullscreenSource` in
`packages/vgpu-api/src/effect.ts`) emits **`uv = (0,0)` at the TOP-LEFT** of the
target and `(1,1)` at the bottom-right — the WebGPU texture convention, y down.

Camera space is **+Y up**, so `bake.wgsl` flips y exactly once when it builds
the ray:

```wgsl
let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
```

This is the **only** place the convention is converted. Every other pass is a
pass-through (`shade.wgsl` does `uv * dimensions` -> `textureLoad`, and the same
`uv` positions the vignette), so the browser and the node harness stay consistent
automatically. Feeding `uv.y * 2 - 1` straight into the camera `up` vector
renders the entire scene upside down — that was a real bug, and it is invisible
in a symmetric test image, so verify with `cameraY > 0`: the camera is **above**
the plane, so you must see the **top** face of the disk, the lensed far side
arcs **over** the shadow, and the near side crosses **in front, below** it.

### `centerY` and centering

`centerY` shifts the image vertically in NDC units; **positive moves the black
hole up** on screen. The default is **`0`**, and it should stay there: the canvas
now covers the whole hero, so the shadow is meant to sit dead center.

Verified, not assumed — `flags` view, shadow = green channel:

| Render | Shadow | Center | Offset |
|---|---|---|---|
| harness `960x540` | 226x226 px circle | (479.5, 269.5) vs (480, 270) | **(-0.5, -0.5) px** |
| browser `1434x900` | 378x378 px circle | (716.5, 449.5) vs (717, 450) | **(-0.5, -0.5) px** |

(Re-measured after the geometry defaults changed — the shadow grew from 188 to
226 px at `960x540`, and stayed centered.)

Sub-pixel in both. If the hole *looks* high, that is the luminance
distribution, not the geometry: the bright disk band sits below the shadow while
the lensed arc rises above it. The luminance centroid is only 1.4% of the frame
height off center. Measure before shifting `centerY`, with
`/home/user/reports/tools/center.mjs`.

## Debugging

### In the browser

The lil-gui panel has a **debug** folder with a *g-buffer view* dropdown:

| Value | View | What you see |
|---|---|---|
| 0 | off | final image |
| 1 | normals / side | `normal * 0.5 + 0.5` — green ≷ 0.5 tells you which face was hit |
| 2 | disk coords | R = normalized radius, G = azimuth, B = 0.35 flat on hits |
| 3 | flags | R = `isHit`, G = `isBlackHole`, B = `escaped` |
| 4 | lensed ray dir | `rayDirection * 0.5 + 0.5` |
| 5 | disk density | `DiskSample.density` |
| 6 | sky footprint / star prefilter | R = star cells crossed per pixel ÷ 16, G = `starPrefilterRatio` (1 = star at least a pixel wide and at full brightness, → 0 = one pixel swallows many cells and every star is dimmed by the square of it), B = 1 where stars are sampled. G → 0 no longer means "no sky here": the flux is still rendered, spread out. |
| 7 | second disk hit | **B = 1 exactly where a hidden second crossing exists**, R/G = its normalized disk coords (radius, azimuth) |

Views 1–5 describe the **front** crossing. Next to the dropdown, **disk layers**
switches between `front hit only` (what the renderer did before the second hit
existed) and `front + hidden hit` (the default) — the quickest way to see what
the second layer contributes.

A separate **perf (frame time)** folder times ~180 frames of the real loop and
copies the result as JSON — see [Measuring it yourself](#measuring-it-yourself).

While a debug view is active `shade.wgsl` **returns before `tonemap`**, so the
channels are the raw values — no exposure, no ACES, no vignette, no gamma, no
desaturation. Those early returns are load-bearing: they are the only thing
keeping the debug bypass alive now that there is no separate composite pass to
skip. If you add a view, add it in the same block, **above** the final
`return vec4f(tonemap(color, uv), 1.0)`.

The **debug** folder also has a **hide UI** toggle (default **on**), which drops
the hero copy — header, H1, tagline, CTAs, tabs and the legibility gradient — so
the shader can be judged on its own. It only adds `.hero-solo` to `<html>`
(rule in `app/globals.css`, elements marked `data-hero-overlay`), so it unmounts
nothing and is instantly reversible.

> **Gotcha:** `.wgsl` edits are *not* picked up by hot reload. After changing a
> shader you must reload the page (`agent-browser ... reload`) — otherwise you
> are looking at the previous shader and will chase ghosts.

Browser session that actually has WebGPU in this sandbox:

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
agent-browser --session bh --webgpu --headed open http://localhost:3010/
agent-browser --session bh --webgpu --headed set viewport 1440 900
agent-browser --session bh --webgpu --headed screenshot canvas /home/user/reports/hero.png
```

Without `--webgpu --headed` there is no adapter and the page silently shows the
static PNG fallback.

### Headless, no browser — `debug-render.mjs`

Runs the real pipeline (bake → shade, tone mapped in place) on the Node/Dawn
adapter and writes PNGs. This is the fastest iteration loop for shader work.

It draws shade straight into an `rgba8unorm` target, exactly as the browser draws
it into the swap chain, so the harness image is the page image — there is no HDR
scene target in either path to drift apart.

```bash
# from the worktree root
node apps/docs/components/hero/debug-render.mjs                        # all views, 1280x720
node apps/docs/components/hero/debug-render.mjs --size 960x540 --time 4
node apps/docs/components/hero/debug-render.mjs --views final,density
node apps/docs/components/hero/debug-render.mjs --disk.stretch 3 --disk.detail 1.6
node apps/docs/components/hero/debug-render.mjs --stars.density 2 --stars.contrast 40
node apps/docs/components/hero/debug-render.mjs --diskRadius 12 --cameraY 0.3
node apps/docs/components/hero/debug-render.mjs --set '{"disk":{"brightness":2}}' --json
node apps/docs/components/hero/debug-render.mjs --views final,hit2                 # second-hit check
node apps/docs/components/hero/debug-render.mjs --views final --diskLayers 1 --out /tmp/before
node apps/docs/components/hero/debug-render.mjs --views final,raydir --yaw 0.15        # scene rotation
node apps/docs/components/hero/debug-render.mjs --views final,raydir --bakeYaw -0.15   # its ground truth
```

- Output directory: `--out` (default `/home/user/reports/hero-debug/`), one PNG
  per view: `final.png`, `normals.png`, `diskuv.png`, `flags.png`,
  `raydir.png`, `density.png`, `skylod.png`, `hit2.png`.
- It prints `mean` and `std` luminance per image — use them as objective
  regression numbers (a black frame is `mean=0`, a blown-out one is `mean≈1`).
- The script resolves the WGSL import graph with `resolveShader`, exactly like
  the webpack/turbopack loader, so an import mistake fails here first.
- Reference numbers at `960x540`, **current** default settings, `t=2.5`:
  `final mean≈0.037 std≈0.088`, `normals mean≈0.708`, `diskuv mean≈0.352`,
  `flags mean≈0.273`, `raydir mean≈0.448`, `density mean≈0.136`,
  `skylod mean≈0.650`, `hit2 mean≈0.023`.
  At `1280x720` after the sky prefilter and the out-of-steps reclassification:
  `final mean≈0.038 std≈0.078`, `raydir mean≈0.448`, `flags mean≈0.275`
  (was `0.273` — the ~2 px shadow band that changed from `escaped` to shadow),
  `skylod mean≈0.302` (was `0.673`; the G channel is now the prefilter ratio,
  which is < 1 nearly everywhere, so this number is NOT comparable to the old
  `starLod` one).
  These move with every defaults revision — re-measure them when you change one
  rather than treating a mismatch as a regression. (`final` roughly doubled from
  the previous set purely because `disk.brightness` went `0.05 -> 0.098`.)
- A/B for the second disk hit, measured at the *previous* defaults:
  `--diskLayers 1` gives `final mean=0.0214`, `--diskLayers 2` gives `0.0225`
  (**+5.1%** light, RMSE 0.0081), all of it in the crescent under the shadow.
- Useful analysis helpers live in `/home/user/reports/tools/`:
  `center.mjs` (shadow circle + centering offset from a `flags` PNG),
  `profile.mjs` (radial star-cells-per-pixel profile from a `skylod` PNG),
  `compare.mjs` / `crop.mjs` in `/home/user/reports/` (A/B diff stats, zoomed
  side-by-side crops — how the prefilter was validated),
  `speckle.mjs` (high-frequency energy in the annulus hugging the shadow —
  the objective metric for lensing aliasing).
- To isolate the sky, render with `--diskRadius 3.02` (just above `ISCO`), which
  removes the disk and leaves the lensed star field and the shadow alone.
- Dawn prints `XDG_RUNTIME_DIR` / Vulkan warnings and falls back to the lavapipe
  CPU renderer in this sandbox. That is expected and harmless; a 1280x720 run
  takes a few seconds.
- Keep `DEFAULT_SETTINGS` in the script in sync with `defaultHeroSettings()`.

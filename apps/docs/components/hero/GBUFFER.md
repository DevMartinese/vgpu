# Hero black hole — G-buffer contract

The hero renderer is split into a **one-shot bake** (expensive geodesic
raymarch, runs only when the camera/geometry changes) and a **cheap frame pass**
(reads the baked G-buffer and shades it). This document is the contract between
the infrastructure and the two shading workstreams.

```
bake.wgsl ──► G-buffer (MRT, 3 attachments) ──► shade.wgsl ──► scene (rgba16float) ──► composite.wgsl ──► canvas
 one-shot                                       every frame                            every frame
                                                   ├── disk.wgsl   (disk pixels)
                                                   └── stars.wgsl  (escaped rays)
```

## File ownership

| File | Owner | Edit? |
|---|---|---|
| `bake.wgsl` | infrastructure | no |
| `gbuffer.wgsl` | infrastructure | no (read it — it defines `GBufferSample`) |
| `shade.wgsl` | infrastructure | no (thin dispatcher + debug views) |
| `renderer.ts` | infrastructure | only to add a new look field (see below) |
| `hero-black-hole.tsx` | infrastructure | only to add a GUI row for a new field |
| **`disk.wgsl`** | **disk workstream** | **yes — this is your file** |
| **`stars.wgsl`** | **stars workstream** | **yes — this is your file** |
| `composite.wgsl` | infrastructure | no (ACES + vignette + `SATURATION 0`) |
| `debug-render.mjs` | shared harness | run it, extend it if useful |

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

Created in `renderer.ts::createTargets`, size = canvas size in physical pixels
(dpr clamped to 1.6). Cleared to `[0,0,0,1]` before the bake.

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
- **flags** (`gSky.w`) — bit 0 (`1.0`) = `isBlackHole`, the ray ended inside the
  horizon (`r < 1.004`), render black; bit 1 (`2.0`) = `escaped`, the ray reached
  the escape radius and only then is `gSky.xyz` a meaningful sky direction. They
  are mutually exclusive. Decoded for you into two `bool`s.
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
- `shade.wgsl` composites as
  `mix(background, color, alpha) + color * alpha * 0.35` (a small additive
  glow term), then the composite pass applies exposure 1.15, ACES, vignette,
  gamma and full desaturation (`SATURATION = 0` — the hero is monochrome, do
  not fight it with hue work).
- Output is linear HDR: values above 1 are expected and intended (they are what
  makes the edge-on band read as incandescent).

### `stars.wgsl`

```wgsl
export struct StarLook {  // uniform payload, mirrored by HeroSettings.stars
  brightness: f32, brightnessMin: f32, brightnessMax: f32,
  density: f32, twinkle: f32,
}

export fn shadeStars(direction: vec3f, look: StarLook, time: f32) -> vec3f
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
- Star emission is `brightness * mix(brightnessMin, brightnessMax, hash)`: the
  global `brightness` scales the complete field, while `brightnessMin` and
  `brightnessMax` set the faintest and strongest per-star emission respectively.
  The star hash is stable, so this does not animate the sky.
- Stars have one uniform angular point radius. Bright anchors are distinguished
  by emission, never by a larger footprint.

#### Lensing aliasing — the `starLod` fade (read this before tuning stars)

`shade.wgsl` multiplies the return value of `shadeStars` by a `starLod` weight.
Do not remove it, and know it exists before you judge how your field looks near
the shadow.

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
exact opposite of the extreme bending that belongs there. The correct
band-limited value is the sky's mean radiance, which for a sparse star field is
essentially black, so `shade.wgsl` fades the field out between 1 and 4 cells per
pixel:

```wgsl
let starLod = 1.0 - smoothstep(STAR_CELL, STAR_CELL * 4.0, skyFootprint);
```

This is the same class of fix as the disk's `footprint` LOD. It is applied in
`shade.wgsl` (a single global fade) rather than inside `stars.wgsl` only because
of file ownership. **The better long-term fix lives in `stars.wgsl`**: take a
footprint parameter and fade *each* `starLayer` toward its own mean at its own
Nyquist limit, since the 34-, 92- and 210-cell layers alias at very different
rates. If you do that, add `footprint: f32` to `shadeStars` and drop the global
fade in `shade.wgsl`.

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

`Shade` carries `resolution`, `time`, `diskOuter`, `debugView`, `diskLayers` and
`sceneYaw` — nothing camera-related, the bake froze it (`sceneYaw` rotates the
*scene*, not the camera; see below). G-buffer textures are read with
`textureLoad` (no sampler): the 32-bit float formats are not filterable, and
interpolating G-buffer values across silhouettes would be wrong anyway.

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
| `cameraY` | `0.085` | `brightness` | `0.098` | `brightness` (global) | `0.82` |
| `distance` | `13.5` | `speed` | `0.75` | `brightnessMin` | `1` |
| `diskRadius` | `10.8` | `stretch` | `5.75` | `brightnessMax` | `2.93` |
| `fov` | `2.67` | `detail` | `3.44` | `density` | `2.92` |
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
- Slider ranges in `hero-black-hole.tsx` are kept wide enough that **every**
  default sits with headroom on both sides. Each defaults revision has needed
  one: `detail`/`turbulence` were once pinned at their maximum, and the star
  `brightnessMin`/`brightnessMax` sliders were widened from `0..1` / `0..3` to a
  shared `0..4` when the current `1` / `2.93` landed on their old tops. When you
  change a default, check its slider still has room — a default pinned at the
  end of its range means the next person cannot tune past it.

## Bake invalidation

| Setting | Re-bakes? |
|---|---|
| `cameraY`, `distance`, `diskRadius`, `fov`, `centerY` (= `BAKE_KEYS`) | **yes** (automatic, throttled) |
| canvas resize / dpr change | **yes** (immediate) |
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
doubling the speed at 120 Hz. Touch and pen are ignored (`pointerType`), and
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
pass-through (`shade.wgsl` does `uv * dimensions` -> `textureLoad`, `composite`
samples at `uv`), so the browser and the node harness stay consistent
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
| 6 | sky footprint / star LOD | R = star cells crossed per pixel ÷ 16, G = applied `starLod`, B = 1 where stars are sampled |
| 7 | second disk hit | **B = 1 exactly where a hidden second crossing exists**, R/G = its normalized disk coords (radius, azimuth) |

Views 1–5 describe the **front** crossing. Next to the dropdown, **disk layers**
switches between `front hit only` (what the renderer did before the second hit
existed) and `front + hidden hit` (the default) — the quickest way to see what
the second layer contributes.

While a debug view is active the composite pass **skips** tone mapping and
desaturation, so the channels are the raw values.

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

Runs the real pipeline (bake → shade → composite) on the Node/Dawn adapter and
writes PNGs. This is the fastest iteration loop for shader work.

```bash
# from the worktree root
node apps/docs/components/hero/debug-render.mjs                        # all views, 1280x720
node apps/docs/components/hero/debug-render.mjs --size 960x540 --time 4
node apps/docs/components/hero/debug-render.mjs --views final,density
node apps/docs/components/hero/debug-render.mjs --disk.stretch 3 --disk.detail 1.6
node apps/docs/components/hero/debug-render.mjs --stars.density 2 --stars.twinkle 0.5
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
  These move with every defaults revision — re-measure them when you change one
  rather than treating a mismatch as a regression. (`final` roughly doubled from
  the previous set purely because `disk.brightness` went `0.05 -> 0.098`.)
- A/B for the second disk hit, measured at the *previous* defaults:
  `--diskLayers 1` gives `final mean=0.0214`, `--diskLayers 2` gives `0.0225`
  (**+5.1%** light, RMSE 0.0081), all of it in the crescent under the shadow.
- Useful analysis helpers live in `/home/user/reports/tools/`:
  `center.mjs` (shadow circle + centering offset from a `flags` PNG),
  `profile.mjs` (radial star-cells-per-pixel profile from a `skylod` PNG),
  `speckle.mjs` (high-frequency energy in the annulus hugging the shadow —
  the objective metric for lensing aliasing).
- To isolate the sky, render with `--diskRadius 3.02` (just above `ISCO`), which
  removes the disk and leaves the lensed star field and the shadow alone.
- Dawn prints `XDG_RUNTIME_DIR` / Vulkan warnings and falls back to the lavapipe
  CPU renderer in this sandbox. That is expected and harmless; a 1280x720 run
  takes a few seconds.
- Keep `DEFAULT_SETTINGS` in the script in sync with `defaultHeroSettings()`.

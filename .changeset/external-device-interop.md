---
"vgpu": minor
"@vgpu/core": minor
---

Adopt a `GPUDevice` vgpu did not create, so an ML runtime and vgpu can share one device and one queue instead of round-tripping tensors through the CPU.

`initFromDevice(device)` — exported from `vgpu`, `vgpu/node` and `vgpu/mock` — returns the same `Gpu` as `init()`, wrapping a device owned by someone else (ONNX Runtime Web, WebLLM, transformers.js, a host engine). It is a separate entry point rather than an `init()` option on purpose: a program that lets vgpu create its own device never bundles the adoption path. Adoption is non-owning — `gpu.dispose()` drops vgpu's wrapper and leaves the native device to its owner — and because that owner can destroy or lose the device at any time, every entry point re-checks it instead of trusting the handle. The device is validated structurally (not by `instanceof`, so a device from a worker, an iframe or a test double is accepted) and a malformed one throws `VGPU-INIT-DEVICE-INVALID`; a device that is already lost is detected before `initFromDevice()` resolves, so you never get back a `Gpu` that fails on first use.

`Device.wrapBuffer(gpuBuffer)` (`@vgpu/core`) wraps a caller-owned `GPUBuffer` as a vgpu `Buffer` without taking ownership of its native lifetime — size, usage and label are read off the buffer itself. Disposing the wrapper releases only vgpu's handle; the runtime that allocated the buffer still owns it. A value that is not a live `GPUBuffer` with finite `size`/`usage` throws `VGPU-EXTERNAL-BUFFER-INVALID`.

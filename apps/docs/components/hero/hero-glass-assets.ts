import type { Geometry, Gpu } from "vgpu";
import { geometry } from "vgpu";
import type { Texture } from "vgpu/core";
import { cubeView } from "vgpu/core";

const GLASS_MESH_URL = "/hero/rounded-tetrahedron.mesh?v=bevel-3";
const FRACTAL_MESH_URL = "/hero/fractal-tetrahedron-l7.mesh?v=face-1";
const ENVIRONMENT_URL = "/hero/studio-cubemap.png";
const MESH_HEADER_SIZE = 40;
const CUBEMAP_COLUMNS = 3;
const CUBEMAP_ROWS = 2;

export interface HeroGlassAssets {
  readonly geometry: Geometry;
  readonly wireframeGeometry: Geometry;
  readonly meshMin: readonly [number, number, number];
  readonly meshMax: readonly [number, number, number];
  readonly fractalGeometry: Geometry;
  readonly fractalWireframeGeometry: Geometry;
  readonly fractalMeshMin: readonly [number, number, number];
  readonly fractalMeshMax: readonly [number, number, number];
  readonly environment: Texture;
  readonly environmentView: GPUTextureView;
  dispose(): void;
}

/** Loads only after the desktop light hero mounts; neither asset enters JS. */
export async function loadHeroGlassAssets(gpu: Gpu): Promise<HeroGlassAssets> {
  const [glassMeshResponse, fractalMeshResponse, environmentResponse] =
    await Promise.all([
      fetch(GLASS_MESH_URL),
      fetch(FRACTAL_MESH_URL),
      fetch(ENVIRONMENT_URL),
    ]);
  if (!glassMeshResponse.ok) {
    throw new Error(
      `Failed to load ${GLASS_MESH_URL}: HTTP ${glassMeshResponse.status}`
    );
  }
  if (!fractalMeshResponse.ok) {
    throw new Error(
      `Failed to load ${FRACTAL_MESH_URL}: HTTP ${fractalMeshResponse.status}`
    );
  }
  if (!environmentResponse.ok) {
    throw new Error(
      `Failed to load ${ENVIRONMENT_URL}: HTTP ${environmentResponse.status}`
    );
  }

  const [glassMeshBuffer, fractalMeshBuffer, environmentBlob] =
    await Promise.all([
      glassMeshResponse.arrayBuffer(),
      fractalMeshResponse.arrayBuffer(),
      environmentResponse.blob(),
    ]);
  const glassMesh = decodeMesh(gpu, glassMeshBuffer, "glass-pyramid");
  let fractalMesh: ReturnType<typeof decodeMesh>;
  try {
    fractalMesh = decodeMesh(gpu, fractalMeshBuffer, "fractal-pyramid-face-l7");
  } catch (error) {
    glassMesh.geometry.destroy();
    glassMesh.wireframeGeometry.destroy();
    throw error;
  }
  let environment: Texture | undefined;
  try {
    const bitmap = await createImageBitmap(environmentBlob);
    try {
      if (
        bitmap.width % CUBEMAP_COLUMNS !== 0 ||
        bitmap.height % CUBEMAP_ROWS !== 0 ||
        bitmap.width / CUBEMAP_COLUMNS !== bitmap.height / CUBEMAP_ROWS
      ) {
        throw new Error(
          "Hero cubemap atlas must contain six square 3x2 faces."
        );
      }
      const faceSize = bitmap.width / CUBEMAP_COLUMNS;
      const mipLevelCount = Math.floor(Math.log2(faceSize)) + 1;
      environment = gpu.device.createTexture({
        size: [faceSize, faceSize, 6],
        format: "rgba8unorm-srgb",
        usage: ["texture_binding", "copy_dst"],
        mipLevelCount,
        label: "homepage-light-glass-studio-cubemap",
      });
      uploadPrefilteredCubemapAtlas(
        gpu,
        environment,
        bitmap,
        faceSize,
        mipLevelCount
      );
    } finally {
      bitmap.close();
    }
  } catch (error) {
    glassMesh.geometry.destroy();
    glassMesh.wireframeGeometry.destroy();
    fractalMesh.geometry.destroy();
    fractalMesh.wireframeGeometry.destroy();
    environment?.destroy();
    throw error;
  }

  const loadedEnvironment = environment;
  if (!loadedEnvironment) {
    glassMesh.geometry.destroy();
    glassMesh.wireframeGeometry.destroy();
    fractalMesh.geometry.destroy();
    fractalMesh.wireframeGeometry.destroy();
    throw new Error("Hero cubemap texture was not created.");
  }
  const environmentView = cubeView(loadedEnvironment, {
    // Use the compatibility-safe array view and perform the direction-to-face
    // lookup in WGSL. Some browser WebGPU implementations return zero when the
    // same uploaded texture is sampled through a native cube view.
    compat: true,
    label: "homepage-light-glass-studio-cubemap-array-view",
  });
  let disposed = false;
  return {
    ...glassMesh,
    fractalGeometry: fractalMesh.geometry,
    fractalWireframeGeometry: fractalMesh.wireframeGeometry,
    fractalMeshMin: fractalMesh.meshMin,
    fractalMeshMax: fractalMesh.meshMax,
    environment: loadedEnvironment,
    environmentView,
    dispose() {
      if (disposed) return;
      disposed = true;
      glassMesh.geometry.destroy();
      glassMesh.wireframeGeometry.destroy();
      fractalMesh.geometry.destroy();
      fractalMesh.wireframeGeometry.destroy();
      loadedEnvironment.destroy();
    },
  };
}

function uploadPrefilteredCubemapAtlas(
  gpu: Gpu,
  environment: Texture,
  bitmap: ImageBitmap,
  faceSize: number,
  mipLevelCount: number
): void {
  // Cropped copyExternalImageToTexture calls into non-zero array layers produce
  // zero-filled faces in some browser WebGPU implementations. Read each atlas
  // tile once and upload tightly packed bytes instead; 256 * RGBA is already
  // aligned to WebGPU's 256-byte row requirement.
  for (let face = 0; face < 6; face++) {
    let source = createPixelCanvas(faceSize);
    let sourceContext = pixelCanvasContext(source);
    sourceContext.drawImage(
      bitmap,
      (face % CUBEMAP_COLUMNS) * faceSize,
      Math.floor(face / CUBEMAP_COLUMNS) * faceSize,
      faceSize,
      faceSize,
      0,
      0,
      faceSize,
      faceSize
    );

    for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel++) {
      const mipSize = Math.max(1, faceSize >> mipLevel);
      if (mipLevel > 0) {
        const next = createPixelCanvas(mipSize);
        const nextContext = pixelCanvasContext(next);
        nextContext.imageSmoothingEnabled = true;
        nextContext.imageSmoothingQuality = "high";
        nextContext.drawImage(source, 0, 0, mipSize, mipSize);
        source = next;
        sourceContext = nextContext;
      }
      uploadCubemapMip(
        gpu,
        environment,
        sourceContext.getImageData(0, 0, mipSize, mipSize).data,
        face,
        mipLevel,
        mipSize
      );
    }
  }
}

type PixelCanvas = HTMLCanvasElement | OffscreenCanvas;
type PixelCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

function createPixelCanvas(size: number): PixelCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(size, size);
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function pixelCanvasContext(canvas: PixelCanvas): PixelCanvasContext {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not decode the hero cubemap atlas.");
  return context as PixelCanvasContext;
}

function uploadCubemapMip(
  gpu: Gpu,
  environment: Texture,
  pixels: Uint8ClampedArray,
  face: number,
  mipLevel: number,
  size: number
): void {
  const sourceBytesPerRow = size * 4;
  const bytesPerRow = Math.ceil(sourceBytesPerRow / 256) * 256;
  const upload = new Uint8Array(bytesPerRow * size);
  for (let row = 0; row < size; row++) {
    upload.set(
      pixels.subarray(row * sourceBytesPerRow, (row + 1) * sourceBytesPerRow),
      row * bytesPerRow
    );
  }
  gpu.gpu.queue.writeTexture(
    { texture: environment.gpu, mipLevel, origin: [0, 0, face] },
    upload,
    { bytesPerRow, rowsPerImage: size },
    [size, size, 1]
  );
}

function decodeMesh(
  gpu: Gpu,
  buffer: ArrayBuffer,
  label: string
): Pick<
  HeroGlassAssets,
  "geometry" | "wireframeGeometry" | "meshMin" | "meshMax"
> {
  if (buffer.byteLength < MESH_HEADER_SIZE) {
    throw new Error("Hero glass mesh header is truncated.");
  }
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== "HGP1") throw new Error("Unsupported hero glass mesh format.");
  const vertexCount = view.getUint32(4, true);
  const indexCount = view.getUint32(8, true);
  const vertexStride = view.getUint32(12, true);
  if (vertexStride !== 16 || vertexCount <= 0 || indexCount <= 0) {
    throw new Error("Hero glass mesh layout is invalid.");
  }
  const meshMin = [
    view.getFloat32(16, true),
    view.getFloat32(20, true),
    view.getFloat32(24, true),
  ] as const;
  const meshMax = [
    view.getFloat32(28, true),
    view.getFloat32(32, true),
    view.getFloat32(36, true),
  ] as const;
  const vertexByteLength = vertexCount * vertexStride;
  const indexOffset = MESH_HEADER_SIZE + vertexByteLength;
  const expectedLength = indexOffset + indexCount * 2;
  if (expectedLength !== buffer.byteLength) {
    throw new Error("Hero glass mesh payload length is invalid.");
  }
  const vertexData = new Uint8Array(
    buffer.slice(MESH_HEADER_SIZE, indexOffset)
  );
  const indices = new Uint16Array(buffer.slice(indexOffset));
  const wireframeIndices = triangleEdges(indices);
  const buffers = [
    {
      data: vertexData,
      stride: vertexStride,
      attributes: {
        packed_position: "unorm16x4" as const,
        packed_normal: "snorm16x4" as const,
      },
    },
  ];
  return {
    geometry: geometry(gpu, {
      label: `homepage-light-${label}`,
      buffers,
      indices,
    }),
    wireframeGeometry: geometry(gpu, {
      label: `homepage-light-${label}-wireframe`,
      topology: "line-list",
      buffers,
      indices: wireframeIndices,
    }),
    meshMin,
    meshMax,
  };
}

function triangleEdges(indices: Uint16Array): Uint16Array {
  const edges = new Set<string>();
  const result: number[] = [];
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    appendEdge(indices[triangle], indices[triangle + 1]);
    appendEdge(indices[triangle + 1], indices[triangle + 2]);
    appendEdge(indices[triangle + 2], indices[triangle]);
  }
  return new Uint16Array(result);

  function appendEdge(a: number, b: number): void {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const key = `${start}:${end}`;
    if (edges.has(key)) return;
    edges.add(key);
    result.push(start, end);
  }
}

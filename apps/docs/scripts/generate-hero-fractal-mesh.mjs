import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRACTAL_LEVELS = 7;
const CANONICAL_FACE = 2;
const CAVITY_DEPTH = 0.22;
const CAVITY_APEX_AO = 0.45;
// The source tetrahedron has circumradius 1 and volume 8 / (9 * sqrt(3)).
// This sphere radius preserves that volume: 4/3 * PI * r^3 = tetra volume.
const EQUAL_VOLUME_SPHERE_RADIUS = Math.cbrt(2 / (3 * Math.PI * Math.sqrt(3)));
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  process.argv[2] ??
    resolve(
      scriptDirectory,
      `../public/hero/fractal-tetrahedron-l${FRACTAL_LEVELS}.mesh`
    )
);

// These vertices and the cavity depth intentionally match hero-fractal-sdf.wgsl.
// The recursive topology emits the visible boundary directly: three retained
// corner triangles and the three inward walls of each central tetrahedral cut.
const tetrahedronVertices = [
  [0, 1, 0],
  [0.94280904158, -0.33333333333, 0],
  [-0.47140452079, -0.33333333333, 0.81649658093],
  [-0.47140452079, -0.33333333333, -0.81649658093],
];
const positions = [];
const spherePositions = [];
const normals = [];
const ambientOcclusion = [];
const indices = [];
const vertexLookup = new Map();

const canonicalCorners = tetrahedronVertices.filter(
  (_vertex, index) => index !== CANONICAL_FACE
);
addFractalFace(tetrahedronVertices[CANONICAL_FACE], ...canonicalCorners, 0, 1);

if (positions.length / 3 > 65535) {
  throw new Error("Hero fractal mesh exceeds the uint16 vertex limit.");
}

const boundsMin = [Infinity, Infinity, Infinity];
const boundsMax = [-Infinity, -Infinity, -Infinity];
for (let index = 0; index < positions.length; index += 3) {
  for (let axis = 0; axis < 3; axis++) {
    boundsMin[axis] = Math.min(boundsMin[axis], positions[index + axis]);
    boundsMax[axis] = Math.max(boundsMax[axis], positions[index + axis]);
  }
}

// Keep the compact hero layout, then append a unit sphere target. The target's
// xyz is both the morphed position and its smooth normal; w stores the fully
// exposed AO target used when the fractal has become a sphere.
const vertexCount = positions.length / 3;
const vertexStride = 24;
const headerSize = 40;
const vertexBytes = Buffer.alloc(vertexCount * vertexStride);
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const source = vertex * 3;
  const target = vertex * vertexStride;
  for (let axis = 0; axis < 3; axis++) {
    const extent = boundsMax[axis] - boundsMin[axis];
    const unit = (positions[source + axis] - boundsMin[axis]) / extent;
    vertexBytes.writeUInt16LE(
      Math.round(Math.min(1, Math.max(0, unit)) * 65535),
      target + axis * 2
    );
    vertexBytes.writeInt16LE(
      Math.round(Math.min(1, Math.max(-1, normals[source + axis])) * 32767),
      target + 8 + axis * 2
    );
    vertexBytes.writeInt16LE(
      Math.round(
        Math.min(1, Math.max(-1, spherePositions[source + axis])) * 32767
      ),
      target + 16 + axis * 2
    );
  }
  vertexBytes.writeUInt16LE(
    Math.round(Math.min(1, Math.max(0, ambientOcclusion[vertex])) * 65535),
    target + 6
  );
  vertexBytes.writeInt16LE(32767, target + 14);
  vertexBytes.writeInt16LE(32767, target + 22);
}

const indexBytes = Buffer.alloc(indices.length * 2);
for (let index = 0; index < indices.length; index++) {
  indexBytes.writeUInt16LE(indices[index], index * 2);
}

const header = Buffer.alloc(headerSize);
header.write("HGP2", 0, "ascii");
header.writeUInt32LE(vertexCount, 4);
header.writeUInt32LE(indices.length, 8);
header.writeUInt32LE(vertexStride, 12);
for (let axis = 0; axis < 3; axis++) {
  header.writeFloatLE(boundsMin[axis], 16 + axis * 4);
  header.writeFloatLE(boundsMax[axis], 28 + axis * 4);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.concat([header, vertexBytes, indexBytes]));
console.log(
  `Wrote ${outputPath}: face ${CANONICAL_FACE}, ${FRACTAL_LEVELS} levels, ` +
    `${vertexCount} vertices, ` +
    `${indices.length / 3} triangles, ` +
    `${
      header.byteLength + vertexBytes.byteLength + indexBytes.byteLength
    } bytes.`
);

function addFractalFace(inward, a, b, c, level, layerScale) {
  const outward = scale3(inward, -1);
  if (level >= FRACTAL_LEVELS) {
    addFlatTriangle(a, b, c, outward);
    return;
  }

  const midpointAB = midpoint3(a, b);
  const midpointBC = midpoint3(b, c);
  const midpointCA = midpoint3(c, a);
  const faceCenter = scale3(add3(a, add3(b, c)), 1 / 3);
  const apex = add3(faceCenter, scale3(inward, CAVITY_DEPTH * layerScale));
  const cavityCenter = scale3(
    add3(midpointAB, add3(midpointBC, add3(midpointCA, apex))),
    0.25
  );

  // The visible cavity apex moves inward in fractal space, but its sphere
  // target stays at the center of the un-inset surface triangle. These three
  // anchor triangles partition the central region without overlapping.
  addCavityWall(
    midpointAB,
    midpointBC,
    apex,
    faceCenter,
    cavityCenter,
    level
  );
  addCavityWall(
    midpointBC,
    midpointCA,
    apex,
    faceCenter,
    cavityCenter,
    level
  );
  addCavityWall(
    midpointCA,
    midpointAB,
    apex,
    faceCenter,
    cavityCenter,
    level
  );

  const nextLevel = level + 1;
  const nextScale = layerScale * 0.5;
  addFractalFace(inward, a, midpointAB, midpointCA, nextLevel, nextScale);
  addFractalFace(inward, b, midpointBC, midpointAB, nextLevel, nextScale);
  addFractalFace(inward, c, midpointCA, midpointBC, nextLevel, nextScale);
}

function addCavityWall(a, b, c, surfaceApex, cavityCenter, level) {
  const wallCenter = scale3(add3(a, add3(b, c)), 1 / 3);
  // Every cavity edge must reach the same final subdivision as the retained
  // outer triangles beside it. Otherwise the normalized sphere projection
  // bends the finely split side into an arc while its coarse neighbour stays
  // a chord, leaving visible T-junctions during the morph.
  const sphereTessellation = Math.max(0, FRACTAL_LEVELS - level - 1);
  addFlatTriangle(
    a,
    b,
    c,
    normalize(sub3(cavityCenter, wallCenter)),
    [1, 1, CAVITY_APEX_AO],
    sphereTessellation,
    [a, b, surfaceApex]
  );
}

function addFlatTriangle(
  a,
  b,
  c,
  expectedNormal,
  ao = [1, 1, 1],
  tessellation = 0,
  sphereAnchors = [a, b, c]
) {
  if (tessellation > 0) {
    const midpointAB = midpoint3(a, b);
    const midpointBC = midpoint3(b, c);
    const midpointCA = midpoint3(c, a);
    const sphereMidpointAB = midpoint3(sphereAnchors[0], sphereAnchors[1]);
    const sphereMidpointBC = midpoint3(sphereAnchors[1], sphereAnchors[2]);
    const sphereMidpointCA = midpoint3(sphereAnchors[2], sphereAnchors[0]);
    const aoAB = (ao[0] + ao[1]) * 0.5;
    const aoBC = (ao[1] + ao[2]) * 0.5;
    const aoCA = (ao[2] + ao[0]) * 0.5;
    const next = tessellation - 1;
    addFlatTriangle(
      a,
      midpointAB,
      midpointCA,
      expectedNormal,
      [ao[0], aoAB, aoCA],
      next,
      [sphereAnchors[0], sphereMidpointAB, sphereMidpointCA]
    );
    addFlatTriangle(
      b,
      midpointBC,
      midpointAB,
      expectedNormal,
      [ao[1], aoBC, aoAB],
      next,
      [sphereAnchors[1], sphereMidpointBC, sphereMidpointAB]
    );
    addFlatTriangle(
      c,
      midpointCA,
      midpointBC,
      expectedNormal,
      [ao[2], aoCA, aoBC],
      next,
      [sphereAnchors[2], sphereMidpointCA, sphereMidpointBC]
    );
    addFlatTriangle(
      midpointAB,
      midpointBC,
      midpointCA,
      expectedNormal,
      [aoAB, aoBC, aoCA],
      next,
      [sphereMidpointAB, sphereMidpointBC, sphereMidpointCA]
    );
    return;
  }
  const geometricNormal = cross(sub3(b, a), sub3(c, a));
  const ordered =
    dot(geometricNormal, expectedNormal) >= 0
      ? [
          [a, ao[0]],
          [b, ao[1]],
          [c, ao[2]],
        ]
      : [
          [a, ao[0]],
          [c, ao[2]],
          [b, ao[1]],
        ];
  const orderedSphereAnchors =
    dot(geometricNormal, expectedNormal) >= 0
      ? sphereAnchors
      : [sphereAnchors[0], sphereAnchors[2], sphereAnchors[1]];
  const normal = normalize(expectedNormal);
  for (let vertex = 0; vertex < 3; vertex++) {
    const [position, vertexAo] = ordered[vertex];
    indices.push(
      addVertex(position, normal, vertexAo, orderedSphereAnchors[vertex])
    );
  }
}

function addVertex(position, normal, ao, sphereAnchor) {
  // Sharing only identical position/normal/AO/anchor tuples preserves every
  // hard cavity edge while keeping the mesh inside the uint16 index range.
  const key = [...position, ...normal, ao, ...sphereAnchor]
    .map((value) => Math.round(value * 1e9))
    .join(":");
  const existing = vertexLookup.get(key);
  if (existing !== undefined) return existing;
  const index = positions.length / 3;
  positions.push(...position);
  spherePositions.push(
    ...scale3(normalize(sphereAnchor), EQUAL_VOLUME_SPHERE_RADIUS)
  );
  normals.push(...normal);
  ambientOcclusion.push(ao);
  vertexLookup.set(key, index);
  return index;
}

function midpoint3(a, b) {
  return scale3(add3(a, b), 0.5);
}

function normalize(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(value, scale) {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

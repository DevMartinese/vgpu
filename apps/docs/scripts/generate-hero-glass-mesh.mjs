import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BEVEL_RADIUS = 0.025;
const BEVEL_SEGMENTS = 6;
const TETRAHEDRON_PLANE = 1 / 3;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  process.argv[2] ?? resolve(scriptDirectory, '../public/hero/rounded-tetrahedron.mesh'),
);

// The solid is a rounded tetrahedron: a smaller tetrahedral core plus a sphere
// of BEVEL_RADIUS. This gives us four untouched planar faces, six cylindrical
// bevel strips, and four small spherical caps without tessellating the faces.
// These vertices exactly match hero-fractal-sdf.wgsl.
const tetrahedronVertices = [
  [0, 1, 0],
  [0.94280904158, -0.33333333333, 0],
  [-0.47140452079, -0.33333333333, 0.81649658093],
  [-0.47140452079, -0.33333333333, -0.81649658093],
];
const planeNormals = tetrahedronVertices.map((vertex) => scale3(vertex, -1));
const coreScale = (TETRAHEDRON_PLANE - BEVEL_RADIUS) / TETRAHEDRON_PLANE;
const coreVertices = tetrahedronVertices.map((vertex) => scale3(vertex, coreScale));
const positions = [];
const normals = [];
const indices = [];

addPlanarFaces();
addEdgeBevels();
addVertexCaps();

if (positions.length / 3 > 65535) {
  throw new Error('Hero glass mesh exceeds the uint16 vertex limit.');
}

const boundsMin = [Infinity, Infinity, Infinity];
const boundsMax = [-Infinity, -Infinity, -Infinity];
for (let index = 0; index < positions.length; index += 3) {
  for (let axis = 0; axis < 3; axis++) {
    boundsMin[axis] = Math.min(boundsMin[axis], positions[index + axis]);
    boundsMax[axis] = Math.max(boundsMax[axis], positions[index + axis]);
  }
}

// Two packed vec4 values per vertex. Position is unorm16 and decoded from the
// stored bounds in the vertex shader; normal is snorm16 and arrives normalized.
const vertexCount = positions.length / 3;
const vertexStride = 16;
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
      target + axis * 2,
    );
    vertexBytes.writeInt16LE(
      Math.round(Math.min(1, Math.max(-1, normals[source + axis])) * 32767),
      target + 8 + axis * 2,
    );
  }
  vertexBytes.writeUInt16LE(65535, target + 6);
  vertexBytes.writeInt16LE(32767, target + 14);
}

const indexBytes = Buffer.alloc(indices.length * 2);
for (let index = 0; index < indices.length; index++) {
  indexBytes.writeUInt16LE(indices[index], index * 2);
}

const header = Buffer.alloc(headerSize);
header.write('HGP1', 0, 'ascii');
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
  `Wrote ${outputPath}: ${vertexCount} vertices, ` +
  `${indices.length / 3} triangles, ` +
  `${header.byteLength + vertexBytes.byteLength + indexBytes.byteLength} bytes.`,
);

function addPlanarFaces() {
  for (let face = 0; face < 4; face++) {
    const corners = [];
    for (let vertex = 0; vertex < 4; vertex++) {
      if (vertex === face) continue;
      corners.push(addVertex(
        add3(coreVertices[vertex], scale3(planeNormals[face], BEVEL_RADIUS)),
        planeNormals[face],
      ));
    }
    addTriangle(corners[0], corners[1], corners[2]);
  }
}

function addEdgeBevels() {
  for (let startVertex = 0; startVertex < 4; startVertex++) {
    for (let endVertex = startVertex + 1; endVertex < 4; endVertex++) {
      const adjacentFaces = [0, 1, 2, 3].filter(
        (face) => face !== startVertex && face !== endVertex,
      );
      const strip = [];
      for (let segment = 0; segment <= BEVEL_SEGMENTS; segment++) {
        const progress = segment / BEVEL_SEGMENTS;
        const normal = normalize(mix3(
          planeNormals[adjacentFaces[0]],
          planeNormals[adjacentFaces[1]],
          progress,
        ));
        strip.push([
          addVertex(
            add3(coreVertices[startVertex], scale3(normal, BEVEL_RADIUS)),
            normal,
          ),
          addVertex(
            add3(coreVertices[endVertex], scale3(normal, BEVEL_RADIUS)),
            normal,
          ),
        ]);
      }
      for (let segment = 0; segment < BEVEL_SEGMENTS; segment++) {
        const current = strip[segment];
        const next = strip[segment + 1];
        addTriangle(current[0], current[1], next[1]);
        addTriangle(current[0], next[1], next[0]);
      }
    }
  }
}

function addVertexCaps() {
  for (let vertex = 0; vertex < 4; vertex++) {
    const incidentNormals = planeNormals.filter((_normal, face) => face !== vertex);
    const rows = [];
    for (let row = 0; row <= BEVEL_SEGMENTS; row++) {
      const vertices = [];
      for (let column = 0; column <= BEVEL_SEGMENTS - row; column++) {
        const weight0 = row / BEVEL_SEGMENTS;
        const weight1 = column / BEVEL_SEGMENTS;
        const weight2 = 1 - weight0 - weight1;
        const normal = normalize(add3(
          scale3(incidentNormals[0], weight0),
          add3(
            scale3(incidentNormals[1], weight1),
            scale3(incidentNormals[2], weight2),
          ),
        ));
        vertices.push(addVertex(
          add3(coreVertices[vertex], scale3(normal, BEVEL_RADIUS)),
          normal,
        ));
      }
      rows.push(vertices);
    }

    for (let row = 0; row < BEVEL_SEGMENTS; row++) {
      for (let column = 0; column < BEVEL_SEGMENTS - row; column++) {
        const a = rows[row][column];
        const b = rows[row + 1][column];
        const c = rows[row][column + 1];
        addTriangle(a, b, c);
        if (column < BEVEL_SEGMENTS - row - 1) {
          const d = rows[row + 1][column + 1];
          addTriangle(b, d, c);
        }
      }
    }
  }
}

function addVertex(position, normal) {
  const index = positions.length / 3;
  positions.push(...position);
  normals.push(...normal);
  return index;
}

function addTriangle(a, b, c) {
  const positionA = positions.slice(a * 3, a * 3 + 3);
  const positionB = positions.slice(b * 3, b * 3 + 3);
  const positionC = positions.slice(c * 3, c * 3 + 3);
  const normalA = normals.slice(a * 3, a * 3 + 3);
  const normalB = normals.slice(b * 3, b * 3 + 3);
  const normalC = normals.slice(c * 3, c * 3 + 3);
  const geometricNormal = cross(
    sub3(positionB, positionA),
    sub3(positionC, positionA),
  );
  const expectedNormal = add3(normalA, add3(normalB, normalC));
  indices.push(...(
    dot(geometricNormal, expectedNormal) >= 0 ? [a, b, c] : [a, c, b]
  ));
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

function mix3(a, b, progress) {
  return [
    a[0] + (b[0] - a[0]) * progress,
    a[1] + (b[1] - a[1]) * progress,
    a[2] + (b[2] - a[2]) * progress,
  ];
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

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const FACE_SIZE = 256;
const FACE_COLUMNS = 3;
const FACE_ROWS = 2;
const STUDIO_PANELS = [
  {
    direction: [-0.32, 0.91, 0.27],
    size: [0.2, 0.055],
    feather: 0.018,
    color: [1, 0.95, 0.87],
    intensity: 8.5,
  },
  {
    direction: [0.08, 0.97, 0.23],
    size: [0.15, 0.045],
    feather: 0.015,
    color: [1, 0.99, 0.96],
    intensity: 9.5,
  },
  {
    direction: [0.51, 0.83, 0.23],
    size: [0.18, 0.05],
    feather: 0.016,
    color: [0.82, 0.91, 1],
    intensity: 8,
  },
  {
    direction: [0.86, 0.43, -0.28],
    size: [0.06, 0.17],
    feather: 0.018,
    color: [0.74, 0.86, 1],
    intensity: 7.25,
  },
  {
    direction: [-0.86, 0.43, -0.28],
    size: [0.065, 0.16],
    feather: 0.018,
    color: [1, 0.79, 0.68],
    intensity: 6.75,
  },
  {
    direction: [-0.22, 0.81, -0.54],
    size: [0.16, 0.045],
    feather: 0.014,
    color: [0.96, 0.91, 0.86],
    intensity: 8,
  },
  {
    direction: [0.26, 0.76, -0.6],
    size: [0.12, 0.04],
    feather: 0.014,
    color: [0.78, 0.87, 1],
    intensity: 7.5,
  },
  {
    direction: [0.3, 0.2, 0.93],
    size: [0.18, 0.055],
    feather: 0.016,
    color: [0.82, 0.91, 1],
    intensity: 11,
  },
  {
    direction: [-0.97, -0.03, -0.23],
    size: [0.15, 0.05],
    feather: 0.016,
    color: [1, 0.86, 0.76],
    intensity: 10,
  },
];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  process.argv[2] ?? resolve(scriptDirectory, '../public/hero/studio-cubemap.png'),
);
const image = new PNG({
  width: FACE_SIZE * FACE_COLUMNS,
  height: FACE_SIZE * FACE_ROWS,
});

// Atlas order: +X, -X, +Y / -Y, +Z, -Z. The environment is evaluated from
// direction rather than painted per face, so values remain continuous at seams.
for (let face = 0; face < 6; face++) {
  const atlasX = face % FACE_COLUMNS;
  const atlasY = Math.floor(face / FACE_COLUMNS);
  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < FACE_SIZE; x++) {
      const u = ((x + 0.5) / FACE_SIZE) * 2 - 1;
      const v = ((y + 0.5) / FACE_SIZE) * 2 - 1;
      const direction = cubeDirection(face, u, v);
      const color = studio(direction);
      const offset = (
        (atlasY * FACE_SIZE + y) * image.width +
        atlasX * FACE_SIZE + x
      ) * 4;
      image.data[offset] = toByte(color[0]);
      image.data[offset + 1] = toByte(color[1]);
      image.data[offset + 2] = toByte(color[2]);
      image.data[offset + 3] = 255;
    }
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, PNG.sync.write(image, { colorType: 6 }));
console.log(`Wrote ${outputPath} (${image.width}x${image.height}).`);

function cubeDirection(face, u, v) {
  const direction = face === 0 ? [1, -v, -u]
    : face === 1 ? [-1, -v, u]
    : face === 2 ? [u, 1, v]
    : face === 3 ? [u, -1, -v]
    : face === 4 ? [u, -v, 1]
    : [-u, -v, -1];
  return normalize(direction);
}

function studio(direction) {
  const floorBlend = smoothstep(0.08, -0.18, direction[1]);
  const wallWarmth = 0.5 + 0.5 * direction[0];
  const room = mix3(
    [0.055 + wallWarmth * 0.018, 0.065, 0.085 - wallWarmth * 0.012],
    [0.84, 0.82, 0.77],
    floorBlend,
  );
  const horizon = Math.exp(-Math.abs(direction[1]) * 14) * 0.12;
  let color = add3(room, [horizon, horizon * 0.95, horizon * 0.9]);

  for (const light of STUDIO_PANELS) {
    color = add3(color, scale3(
      light.color,
      panel(
        direction,
        light.direction,
        light.size,
        light.feather,
      ) * light.intensity,
    ));
  }

  // Filmic compression keeps the asset LDR while preserving distinct panel shapes.
  return color.map((channel) => {
    const mapped = channel / (1 + channel);
    return Math.pow(Math.max(0, mapped), 1 / 2.2);
  });
}

function panel(direction, forwardInput, size, feather) {
  const forward = normalize(forwardInput);
  const helper = Math.abs(forward[1]) > 0.92 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(helper, forward));
  const up = cross(forward, right);
  const facing = dot(direction, forward);
  if (facing <= 0.01) return 0;
  const localX = Math.abs(dot(direction, right) / facing);
  const localY = Math.abs(dot(direction, up) / facing);
  const edgeX = 1 - smoothstep(size[0], size[0] + feather, localX);
  const edgeY = 1 - smoothstep(size[1], size[1] + feather, localY);
  return edgeX * edgeY;
}

function normalize(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function smoothstep(edge0, edge1, value) {
  const progress = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function mix3(a, b, progress) {
  return [
    a[0] + (b[0] - a[0]) * progress,
    a[1] + (b[1] - a[1]) * progress,
    a[2] + (b[2] - a[2]) * progress,
  ];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(value, scale) {
  return [value[0] * scale, value[1] * scale, value[2] * scale];
}

function toByte(value) {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

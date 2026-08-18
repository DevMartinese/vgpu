// The canonical asset stores tetrahedron face 2. Instance 0 leaves it in
// place; instance 1 applies the tetrahedral symmetry (0 1)(2 3), a proper
// 180-degree rotation that maps it onto face 3 without changing winding.
const FACE_2_TO_FACE_3 = mat3x3f(
  vec3f(0.33333333333, 0.94280904158, 0.0),
  vec3f(0.94280904158, -0.33333333333, 0.0),
  vec3f(0.0, 0.0, -1.0),
);

export fn heroFractalFacePosition(position: vec3f, instance: u32) -> vec3f {
  return select(position, FACE_2_TO_FACE_3 * position, instance == 1u);
}

export fn heroFractalFaceNormal(normal: vec3f, instance: u32) -> vec3f {
  return select(normal, FACE_2_TO_FACE_3 * normal, instance == 1u);
}

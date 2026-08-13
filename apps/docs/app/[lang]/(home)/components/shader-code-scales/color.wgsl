export fn palette(t: f32) -> vec3f {
  let phase = vec3f(0.0, 0.33, 0.67);
  return 0.55 + 0.45 * cos(6.28318 * (t + phase));
}

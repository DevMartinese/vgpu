fn cieX(wavelength: f32) -> f32 {
  let t1 = (wavelength - 442.0) * select(0.0374, 0.0624, wavelength < 442.0);
  let t2 = (wavelength - 599.8) * select(0.0323, 0.0264, wavelength < 599.8);
  let t3 = (wavelength - 501.1) * select(0.0382, 0.0490, wavelength < 501.1);
  return 0.362 * exp(-0.5 * t1 * t1)
    + 1.056 * exp(-0.5 * t2 * t2)
    - 0.065 * exp(-0.5 * t3 * t3);
}

fn cieY(wavelength: f32) -> f32 {
  let t1 = (wavelength - 568.8) * select(0.0247, 0.0213, wavelength < 568.8);
  let t2 = (wavelength - 530.9) * select(0.0322, 0.0613, wavelength < 530.9);
  return 0.821 * exp(-0.5 * t1 * t1) + 0.286 * exp(-0.5 * t2 * t2);
}

fn cieZ(wavelength: f32) -> f32 {
  let t1 = (wavelength - 437.0) * select(0.0278, 0.0845, wavelength < 437.0);
  let t2 = (wavelength - 459.0) * select(0.0725, 0.0385, wavelength < 459.0);
  return 1.217 * exp(-0.5 * t1 * t1) + 0.681 * exp(-0.5 * t2 * t2);
}

// CIE standard illuminant D65, 400–700 nm in 10 nm steps. Every wavelength
// shares one exposure so their overlap reconstructs daylight white.
fn d65SpectralPower(wavelength: f32) -> f32 {
  let values = array<f32, 31>(
    82.7549, 91.486, 93.4318, 86.6823, 104.865, 117.008, 117.812,
    114.861, 115.923, 108.811, 109.354, 107.802, 104.79, 107.689,
    104.405, 104.046, 100.0, 96.3342, 95.788, 88.6856, 90.0062,
    89.5991, 87.6987, 83.2886, 83.6992, 80.0268, 80.2146, 82.2778,
    78.2842, 69.7213, 71.6091,
  );
  let coordinate = clamp((wavelength - 400.0) / 10.0, 0.0, 30.0);
  let lower = min(u32(coordinate), 29u);
  let fraction = coordinate - f32(lower);
  return mix(values[lower], values[lower + 1u], fraction) * 0.01;
}

export fn wavelengthToBeamRgb(wavelength: f32) -> vec3f {
  let clamped = clamp(wavelength, 400.0, 700.0);
  let xyz = vec3f(cieX(clamped), cieY(clamped), cieZ(clamped));
  let linearRgb = vec3f(
    3.2406 * xyz.x - 1.5372 * xyz.y - 0.4986 * xyz.z,
    -0.9689 * xyz.x + 1.8758 * xyz.y + 0.0415 * xyz.z,
    0.0557 * xyz.x - 0.2040 * xyz.y + 1.0570 * xyz.z,
  );
  let neutralOffset = min(min(linearRgb.r, linearRgb.g), min(linearRgb.b, 0.0));
  let positive = linearRgb - vec3f(neutralOffset);
  let hue = positive
    / max(max(positive.r, positive.g), max(positive.b, 0.000001));
  let photopicPower = d65SpectralPower(clamped) * xyz.y / 1.0347;
  let exposure = 4.5;
  let displayPower = (1.0 - exp(-exposure * photopicPower))
    / (1.0 - exp(-exposure));
  let whiteBalance = vec3f(1.1868, 1.0, 2.2495);
  return hue * displayPower * whiteBalance;
}

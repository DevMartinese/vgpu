import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three/webgpu";
import { createObjectOrbitControls } from "../src/object-orbit-controls.ts";

const orbitState = vi.hoisted(() => ({
  instances: [] as Array<{
    object: THREE.PerspectiveCamera;
    enableDamping: boolean;
    enablePan: boolean;
    enableZoom: boolean;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    enableDamping = false;
    enablePan = true;
    enableZoom = true;
    dispose = vi.fn();

    constructor(readonly object: THREE.PerspectiveCamera) {
      orbitState.instances.push(this);
    }

    update() {}
  },
}));

describe("createObjectOrbitControls", () => {
  beforeEach(() => {
    orbitState.instances.length = 0;
  });

  it("transfers inverse orbit rotation to the object without moving the render camera", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.2, 4.2);
    camera.lookAt(0, 0, 0);
    const originalPosition = camera.position.clone();
    const originalQuaternion = camera.quaternion.clone();
    const object = new THREE.Group();
    const objectControls = createObjectOrbitControls(
      camera,
      object,
      {} as HTMLElement
    );
    const orbit = orbitState.instances[0]!;

    expect(orbit.enableDamping).toBe(true);
    expect(orbit.enablePan).toBe(false);
    expect(orbit.enableZoom).toBe(false);

    const cameraDelta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0.25
    );
    orbit.object.quaternion
      .copy(cameraDelta)
      .multiply(originalQuaternion);
    objectControls.update(0);

    expect(camera.position.equals(originalPosition)).toBe(true);
    expect(camera.quaternion.equals(originalQuaternion)).toBe(true);
    expect(object.quaternion.angleTo(cameraDelta.clone().invert())).toBeLessThan(
      1e-7
    );
  });

  it("keeps automatic rotation speed stable across frame rates", () => {
    const runForOneSecond = (fps: number) => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.z = 4;
      camera.lookAt(0, 0, 0);
      const object = new THREE.Group();
      const objectControls = createObjectOrbitControls(
        camera,
        object,
        {} as HTMLElement
      );

      objectControls.update(0);
      for (let frame = 1; frame <= fps; frame++) {
        objectControls.update((frame / fps) * 1_000);
      }
      return object.quaternion;
    };

    expect(runForOneSecond(30).angleTo(runForOneSecond(120))).toBeLessThan(
      1e-7
    );
  });
});

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const AUTO_ROTATION_RADIANS_PER_SECOND = 0.072;
const MAX_FRAME_DELTA_SECONDS = 0.1;

/**
 * Reuses OrbitControls' pointer handling and damping without ever moving the
 * render camera. A private camera absorbs the orbit, then its inverse angular
 * delta is transferred to the object so dragging feels like orbiting it.
 */
export function createObjectOrbitControls(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  domElement: HTMLElement
) {
  const orbitCamera = camera.clone();
  const controls = new OrbitControls(orbitCamera, domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.update();

  const previousCameraQuaternion = orbitCamera.quaternion.clone();
  const inversePreviousCameraQuaternion = new THREE.Quaternion();
  const objectDelta = new THREE.Quaternion();
  let previousFrameTime: number | undefined;

  return {
    update(frameTime: number) {
      const deltaSeconds =
        previousFrameTime === undefined
          ? 0
          : Math.min(
              Math.max((frameTime - previousFrameTime) / 1_000, 0),
              MAX_FRAME_DELTA_SECONDS
            );
      previousFrameTime = frameTime;

      controls.update();
      inversePreviousCameraQuaternion
        .copy(previousCameraQuaternion)
        .invert();
      objectDelta
        .copy(orbitCamera.quaternion)
        .multiply(inversePreviousCameraQuaternion)
        .invert();
      object.quaternion.premultiply(objectDelta).normalize();
      object.rotateY(AUTO_ROTATION_RADIANS_PER_SECOND * deltaSeconds);
      previousCameraQuaternion.copy(orbitCamera.quaternion);
    },
    dispose: () => controls.dispose(),
  };
}

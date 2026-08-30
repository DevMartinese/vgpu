import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDemoCamera, createDemoScene } from "./scenes";
import { createBloomPipeline } from "./post";

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
}

export interface ExampleRenderer {
  /** Resolves once the first frame has been scheduled; rejects on setup failure. */
  readonly ready: Promise<void>;
  dispose(): void;
}

export function createRenderer({ canvas }: RendererOptions): ExampleRenderer {
  let disposed = false;
  const cleanups: Array<() => void> = [];

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // Run in reverse so the renderer outlives the objects that reference it.
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch {
        // A failed teardown step must not strand the ones after it.
      }
    }
  }

  const ready = (async () => {
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    await renderer.init();
    if (disposed) {
      renderer.dispose();
      return;
    }
    cleanups.push(() => renderer.dispose());

    const scene = await createDemoScene();
    if (disposed) {
      scene.dispose();
      return;
    }
    cleanups.push(() => scene.dispose());

    const camera = createDemoCamera(
      Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1)
    );
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    cleanups.push(() => controls.dispose());

    const postProcessing = createBloomPipeline(renderer, scene.scene, camera);
    cleanups.push(() => postProcessing.dispose());

    const resize = new ResizeObserver(() => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resize.observe(canvas);
    cleanups.push(() => resize.disconnect());

    renderer.setAnimationLoop(() => {
      scene.mesh.rotation.y += 0.0012;
      controls.update();
      postProcessing.render();
    });
    cleanups.push(() => renderer.setAnimationLoop(null));
  })();

  return { ready, dispose };
}

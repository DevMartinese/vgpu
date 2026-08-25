import { useEffect, useRef } from "react";
import GUI, { type Controller } from "lil-gui";

import {
  addReflectionFolders,
  reflectionGuiValues,
  type ReflectionGuiValuesByTheme,
} from "./controls/reflection";
import {
  addTransmissionFolders,
  transmissionFromGui,
  transmissionGuiValues,
  type TransmissionGuiValuesByTheme,
} from "./controls/transmission";
import { normalizeControls } from "./runtime/normalize-controls";
import {
  DEFAULT_PRISM_CONTROLS,
  PRISM_BEAM_MOUSE_Y_RANGES,
  PRISM_BEAM_WIDTH_RANGE,
  PRISM_CAMERA_RANGES,
  PRISM_DISPERSION_LABELS,
  PRISM_DISPERSION_ORDER,
  PRISM_DISPERSION_PRESETS,
  PRISM_LIGHT_FADE_RANGES,
  PRISM_POSTPROCESS_RANGES,
  PRISM_SPECTRAL_DISPERSION_RANGES,
  PRISM_VIEW_LABELS,
  PRISM_VIEW_ORDER,
  type PrismControls,
  type PrismDispersion,
} from "./types";

export interface ControlsProps {
  initialValue?: Readonly<PrismControls>;
  onChange(value: PrismControls): void;
  disabled?: boolean;
}

type GuiView = (typeof PRISM_VIEW_ORDER)[number];

interface GuiValues {
  dispersion: PrismDispersion;
  dispersionBase: number;
  dispersionStrength: number;
  view: GuiView;
  cameraFov: number;
  beamWidth: number;
  beamMouseYTop: number;
  beamMouseYBottom: number;
  beamOpacity: number;
  edgeFalloff: number;
  rainbowFalloffRate: number;
  rainbowFalloffPower: number;
  wallColor: string;
  wireframe: boolean;
  lightWireframe: boolean;
  environmentDebug: boolean;
  transmission: TransmissionGuiValuesByTheme;
  reflection: ReflectionGuiValuesByTheme;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
}

function options<T extends string>(
  order: readonly T[],
  labels: Readonly<Record<T, string>>
): Record<string, T> {
  return Object.fromEntries(order.map((value) => [labels[value], value]));
}

function guiView(value: unknown): GuiView {
  return value === "back" ? "back" : "glass";
}

/** lil-gui owns its small mutable model; React only owns the mount point. */
export function Controls({
  initialValue = DEFAULT_PRISM_CONTROLS,
  onChange,
  disabled = false,
}: ControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Fall back per-field as well as per-object so Fast Refresh can safely
    // cross control-schema changes without rebuilding the renderer.
    const glass = normalizeControls(initialValue).glass;
    const postprocess =
      initialValue.postprocess ?? DEFAULT_PRISM_CONTROLS.postprocess;
    const lightFade =
      initialValue.lightFade ?? DEFAULT_PRISM_CONTROLS.lightFade;
    const beamMouseY =
      initialValue.beamMouseY ?? DEFAULT_PRISM_CONTROLS.beamMouseY;
    const legacyLightFade = lightFade as typeof lightFade & {
      rainbowFalloff?: number;
    };
    const spectralDispersion =
      initialValue.spectralDispersion ??
      PRISM_DISPERSION_PRESETS[
        initialValue.dispersion ?? DEFAULT_PRISM_CONTROLS.dispersion
      ];
    const values: GuiValues = {
      dispersion: initialValue.dispersion ?? DEFAULT_PRISM_CONTROLS.dispersion,
      dispersionBase: spectralDispersion.base,
      dispersionStrength: spectralDispersion.strength,
      // Old Fast Refresh state may still hold the now-hidden wall/caustic
      // diagnostics. The public control always resumes at a composed view.
      view: guiView(initialValue.view),
      cameraFov: initialValue.cameraFov ?? DEFAULT_PRISM_CONTROLS.cameraFov,
      beamWidth: initialValue.beamWidth ?? DEFAULT_PRISM_CONTROLS.beamWidth,
      beamMouseYTop:
        beamMouseY.top ?? DEFAULT_PRISM_CONTROLS.beamMouseY.top,
      beamMouseYBottom:
        beamMouseY.bottom ?? DEFAULT_PRISM_CONTROLS.beamMouseY.bottom,
      beamOpacity:
        lightFade.beamOpacity ?? DEFAULT_PRISM_CONTROLS.lightFade.beamOpacity,
      edgeFalloff:
        lightFade.edgeFalloff ?? DEFAULT_PRISM_CONTROLS.lightFade.edgeFalloff,
      rainbowFalloffRate:
        lightFade.rainbowFalloffRate ??
        legacyLightFade.rainbowFalloff ??
        DEFAULT_PRISM_CONTROLS.lightFade.rainbowFalloffRate,
      rainbowFalloffPower:
        lightFade.rainbowFalloffPower ??
        DEFAULT_PRISM_CONTROLS.lightFade.rainbowFalloffPower,
      wallColor: initialValue.wallColor ?? DEFAULT_PRISM_CONTROLS.wallColor,
      wireframe: initialValue.wireframe ?? DEFAULT_PRISM_CONTROLS.wireframe,
      lightWireframe:
        initialValue.lightWireframe ?? DEFAULT_PRISM_CONTROLS.lightWireframe,
      environmentDebug:
        initialValue.environmentDebug ??
        DEFAULT_PRISM_CONTROLS.environmentDebug,
      transmission: transmissionGuiValues(glass.transmission),
      reflection: reflectionGuiValues(glass.reflection),
      bloomStrength:
        postprocess.bloomStrength ??
        DEFAULT_PRISM_CONTROLS.postprocess.bloomStrength,
      bloomThreshold:
        postprocess.bloomThreshold ??
        DEFAULT_PRISM_CONTROLS.postprocess.bloomThreshold,
      bloomRadius:
        postprocess.bloomRadius ??
        DEFAULT_PRISM_CONTROLS.postprocess.bloomRadius,
    };
    const gui = new GUI({ title: "Prism", container });
    Object.assign(gui.domElement.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      pointerEvents: "auto",
      maxHeight: "calc(100% - 16px)",
      overflowY: "auto",
    });

    const publish = () =>
      onChangeRef.current({
        dispersion: values.dispersion,
        spectralDispersion: {
          base: values.dispersionBase,
          strength: values.dispersionStrength,
        },
        view: values.view,
        cameraFov: values.cameraFov,
        beamWidth: values.beamWidth,
        beamMouseY: {
          top: values.beamMouseYTop,
          bottom: values.beamMouseYBottom,
        },
        lightFade: {
          beamOpacity: values.beamOpacity,
          edgeFalloff: values.edgeFalloff,
          rainbowFalloffRate: values.rainbowFalloffRate,
          rainbowFalloffPower: values.rainbowFalloffPower,
        },
        wallColor: values.wallColor,
        wireframe: values.wireframe,
        lightWireframe: values.lightWireframe,
        environmentDebug: values.environmentDebug,
        glass: {
          transmission: {
            dark: transmissionFromGui(values.transmission.dark),
            light: transmissionFromGui(values.transmission.light),
          },
          reflection: {
            dark: { ...values.reflection.dark },
            light: { ...values.reflection.light },
          },
        },
        postprocess: {
          bloomStrength: values.bloomStrength,
          bloomThreshold: values.bloomThreshold,
          bloomRadius: values.bloomRadius,
        },
      });

    const sceneFolder = gui.addFolder("Scene");
    const spectralFolder = sceneFolder.addFolder("Spectral optics");
    const lightPositionFolder = gui.addFolder("Light position");
    const lightFolder = gui.addFolder("Light fade");
    const cameraFolder = gui.addFolder("Camera");
    const glassFolder = gui.addFolder("Glass");
    const transmissionControllers = addTransmissionFolders(
      glassFolder,
      values.transmission,
      publish
    );
    const reflectionControllers = addReflectionFolders(
      glassFolder,
      values.reflection,
      publish
    );
    const postprocessFolder = gui.addFolder("Postprocessing");
    const debugFolder = gui.addFolder("Debug");
    const dispersionPresetController = spectralFolder
      .add(
        values,
        "dispersion",
        options(PRISM_DISPERSION_ORDER, PRISM_DISPERSION_LABELS)
      )
      .name("preset");
    const dispersionBaseController = spectralFolder
      .add(
        values,
        "dispersionBase",
        PRISM_SPECTRAL_DISPERSION_RANGES.base.min,
        PRISM_SPECTRAL_DISPERSION_RANGES.base.max,
        PRISM_SPECTRAL_DISPERSION_RANGES.base.step
      )
      .name("base IOR")
      .onChange(publish);
    const dispersionStrengthController = spectralFolder
      .add(
        values,
        "dispersionStrength",
        PRISM_SPECTRAL_DISPERSION_RANGES.strength.min,
        PRISM_SPECTRAL_DISPERSION_RANGES.strength.max,
        PRISM_SPECTRAL_DISPERSION_RANGES.strength.step
      )
      .name("dispersion B")
      .onChange(publish);
    dispersionPresetController.onChange((preset: PrismDispersion) => {
      const next = PRISM_DISPERSION_PRESETS[preset];
      values.dispersionBase = next.base;
      values.dispersionStrength = next.strength;
      dispersionBaseController.updateDisplay();
      dispersionStrengthController.updateDisplay();
      publish();
    });
    const controllers: Controller[] = [
      dispersionPresetController,
      dispersionBaseController,
      dispersionStrengthController,
      sceneFolder
        .add(
          values,
          "beamWidth",
          PRISM_BEAM_WIDTH_RANGE.min,
          PRISM_BEAM_WIDTH_RANGE.max,
          PRISM_BEAM_WIDTH_RANGE.step
        )
        .name("beam width")
        .onChange(publish),
      lightPositionFolder
        .add(
          values,
          "beamMouseYTop",
          PRISM_BEAM_MOUSE_Y_RANGES.top.min,
          PRISM_BEAM_MOUSE_Y_RANGES.top.max,
          PRISM_BEAM_MOUSE_Y_RANGES.top.step
        )
        .name("mouse top (deg)")
        .onChange(publish),
      lightPositionFolder
        .add(
          values,
          "beamMouseYBottom",
          PRISM_BEAM_MOUSE_Y_RANGES.bottom.min,
          PRISM_BEAM_MOUSE_Y_RANGES.bottom.max,
          PRISM_BEAM_MOUSE_Y_RANGES.bottom.step
        )
        .name("mouse bottom (deg)")
        .onChange(publish),
      sceneFolder
        .addColor(values, "wallColor")
        .name("wall color")
        .onChange(publish),
      lightFolder
        .add(
          values,
          "beamOpacity",
          PRISM_LIGHT_FADE_RANGES.beamOpacity.min,
          PRISM_LIGHT_FADE_RANGES.beamOpacity.max,
          PRISM_LIGHT_FADE_RANGES.beamOpacity.step
        )
        .name("beam opacity")
        .onChange(publish),
      lightFolder
        .add(
          values,
          "edgeFalloff",
          PRISM_LIGHT_FADE_RANGES.edgeFalloff.min,
          PRISM_LIGHT_FADE_RANGES.edgeFalloff.max,
          PRISM_LIGHT_FADE_RANGES.edgeFalloff.step
        )
        .name("edge falloff")
        .onChange(publish),
      lightFolder
        .add(
          values,
          "rainbowFalloffRate",
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffRate.min,
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffRate.max,
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffRate.step
        )
        .name("rainbow falloff rate")
        .onChange(publish),
      lightFolder
        .add(
          values,
          "rainbowFalloffPower",
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffPower.min,
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffPower.max,
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffPower.step
        )
        .name("rainbow falloff power")
        .onChange(publish),
      cameraFolder
        .add(
          values,
          "cameraFov",
          PRISM_CAMERA_RANGES.fov.min,
          PRISM_CAMERA_RANGES.fov.max,
          PRISM_CAMERA_RANGES.fov.step
        )
        .name("FOV")
        .onChange(publish),
      ...transmissionControllers,
      ...reflectionControllers,
      postprocessFolder
        .add(
          values,
          "bloomStrength",
          PRISM_POSTPROCESS_RANGES.bloomStrength.min,
          PRISM_POSTPROCESS_RANGES.bloomStrength.max,
          PRISM_POSTPROCESS_RANGES.bloomStrength.step
        )
        .name("bloom strength")
        .onChange(publish),
      postprocessFolder
        .add(
          values,
          "bloomThreshold",
          PRISM_POSTPROCESS_RANGES.bloomThreshold.min,
          PRISM_POSTPROCESS_RANGES.bloomThreshold.max,
          PRISM_POSTPROCESS_RANGES.bloomThreshold.step
        )
        .name("threshold")
        .onChange(publish),
      postprocessFolder
        .add(
          values,
          "bloomRadius",
          PRISM_POSTPROCESS_RANGES.bloomRadius.min,
          PRISM_POSTPROCESS_RANGES.bloomRadius.max,
          PRISM_POSTPROCESS_RANGES.bloomRadius.step
        )
        .name("radius")
        .onChange(publish),
      debugFolder
        .add(values, "view", options(PRISM_VIEW_ORDER, PRISM_VIEW_LABELS))
        .name("show")
        .onChange(publish),
      debugFolder
        .add(values, "wireframe")
        .name("prism wireframe")
        .onChange(publish),
      debugFolder
        .add(values, "lightWireframe")
        .name("light wireframe")
        .onChange(publish),
      debugFolder
        .add(values, "environmentDebug")
        .name("environment debug")
        .onChange(publish),
    ];
    if (disabled) controllers.forEach((controller) => controller.disable());

    return () => {
      gui.destroy();
    };
  }, [disabled, initialValue]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-50"
    />
  );
}

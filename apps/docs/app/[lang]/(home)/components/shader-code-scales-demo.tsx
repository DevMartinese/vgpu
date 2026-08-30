"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

const sourceFiles = ["index.ts", "main.wgsl", "color.wgsl"] as const;
type SourceFile = (typeof sourceFiles)[number];
type PreviewState = "poster" | "loading" | "running" | "unavailable";

const compiledSource = `struct U{r:vec2f}@group(0)@binding(0)var<uniform>u:U;
@fragment fn fs_main(@location(0)b:vec2f)->@location(0)vec4f{
let c=(b-0.5)*(u.r/min(u.r.x,u.r.y));let d=length(c);let e=atan2(c.y,c.x)/6.28318+0.5;
let f=exp(-95.0*pow(abs(d-0.31),2.0));let h=exp(-18.0*pow(abs(d-0.31),2.0));
let i=0.82+0.18*sin(e*25.13272+d*42.0);let g=a(e+d*0.65);
return vec4f(g*(f*i*2.0+h*0.22),1.0)}fn a(b:f32)->vec3f{let c=vec3f(0.0,0.33,0.67);
return 0.55+0.45*cos(6.28318*(b+c))}`;

function CodeLine({
  children,
  highlight = false,
  number,
}: {
  children?: ReactNode;
  highlight?: boolean;
  number: number;
}) {
  return (
    <span
      className={`relative block min-w-max pr-5 ${
        highlight
          ? "-mx-3 bg-[rgba(0,202,82,0.08)] px-3 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-[#00a844] dark:bg-[rgba(0,202,82,0.12)] dark:before:bg-[#00ca52] sm:-mx-5 sm:px-5"
          : ""
      }`}
    >
      <span className="mr-4 inline-block w-5 select-none text-right text-gray-700">
        {number}
      </span>
      {children ?? "\u00a0"}
    </span>
  );
}

function TypeScriptSource() {
  return (
    <>
      <CodeLine number={1}>
        <span className="text-red-800 dark:text-[#ff518d]">import</span>
        {" { effect, frame, init, surface } "}
        <span className="text-red-800 dark:text-[#ff518d]">from</span>{" "}
        <span className="text-green-800 dark:text-[#00ca52]">
          &quot;vgpu&quot;
        </span>
        ;
      </CodeLine>
      <CodeLine highlight number={2}>
        <span className="text-red-800 dark:text-[#ff518d]">import</span>
        {" shaderSource "}
        <span className="text-red-800 dark:text-[#ff518d]">from</span>{" "}
        <span className="text-green-800 dark:text-[#00ca52]">
          &quot;./main.wgsl&quot;
        </span>
        ;
      </CodeLine>
      <CodeLine number={3} />
      <CodeLine number={4}>
        <span className="text-red-800 dark:text-[#ff518d]">
          export async function
        </span>{" "}
        <span className="text-purple-800 dark:text-[#c472fb]">render</span>
        {"(canvas: HTMLCanvasElement) {"}
      </CodeLine>
      <CodeLine number={5}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">const</span>
        {" gpu = "}
        <span className="text-red-800 dark:text-[#ff518d]">await</span>{" "}
        <span className="text-purple-800 dark:text-[#c472fb]">init</span>
        {"();"}
      </CodeLine>
      <CodeLine number={6}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">const</span>
        {" output = "}
        <span className="text-purple-800 dark:text-[#c472fb]">surface</span>
        {"(gpu, canvas, { dpr: 1 });"}
      </CodeLine>
      <CodeLine number={7}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">const</span>
        {" shader = "}
        <span className="text-purple-800 dark:text-[#c472fb]">effect</span>
        {"(gpu, shaderSource);"}
      </CodeLine>
      <CodeLine number={8} />
      <CodeLine number={9}>
        {"  "}
        <span className="text-purple-800 dark:text-[#c472fb]">shader.set</span>
        {"({ uniforms: { resolution: output.size } });"}
      </CodeLine>
      <CodeLine number={10}>
        {"  "}
        <span className="text-purple-800 dark:text-[#c472fb]">frame</span>
        {"(gpu, (f) => f.pass(output, shader));"}
      </CodeLine>
      <CodeLine number={11}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">return</span>
        {" () => gpu."}
        <span className="text-purple-800 dark:text-[#c472fb]">dispose</span>
        {"();"}
      </CodeLine>
      <CodeLine number={12}>{"}"}</CodeLine>
    </>
  );
}

function MainShaderSource() {
  return (
    <>
      <CodeLine highlight number={1}>
        <span className="text-red-800 dark:text-[#ff518d]">import</span>
        {" { palette } "}
        <span className="text-red-800 dark:text-[#ff518d]">from</span>{" "}
        <span className="text-green-800 dark:text-[#00ca52]">
          &quot;./color.wgsl&quot;
        </span>
        ;
      </CodeLine>
      <CodeLine number={2} />
      <CodeLine number={3}>
        <span className="text-red-800 dark:text-[#ff518d]">struct</span>
        {" Uniforms {"}
      </CodeLine>
      <CodeLine number={4}>{"  resolution: vec2f,"}</CodeLine>
      <CodeLine number={5}>{"};"}</CodeLine>
      <CodeLine number={6} />
      <CodeLine number={7}>
        <span className="text-purple-800 dark:text-[#c472fb]">
          @group(0) @binding(0)
        </span>
        {" var<uniform> uniforms: Uniforms;"}
      </CodeLine>
      <CodeLine number={8} />
      <CodeLine number={9}>
        <span className="text-purple-800 dark:text-[#c472fb]">@fragment</span>
      </CodeLine>
      <CodeLine number={10}>
        <span className="text-red-800 dark:text-[#ff518d]">fn</span>{" "}
        <span className="text-purple-800 dark:text-[#c472fb]">fs_main</span>
        {"(@location(0) uv: vec2f) -> @location(0) vec4f {"}
      </CodeLine>
      <CodeLine number={11}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" shortest = min(uniforms.resolution.x, uniforms.resolution.y);"}
      </CodeLine>
      <CodeLine number={12}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" aspect = uniforms.resolution / shortest;"}
      </CodeLine>
      <CodeLine number={13}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" p = (uv - 0.5) * aspect;"}
      </CodeLine>
      <CodeLine number={14}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" radius = "}
        <span className="text-purple-800 dark:text-[#c472fb]">length</span>
        {"(p);"}
      </CodeLine>
      <CodeLine number={15}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" angle = atan2(p.y, p.x) / 6.28318 + 0.5;"}
      </CodeLine>
      <CodeLine number={16}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" ring = "}
        <span className="text-purple-800 dark:text-[#c472fb]">exp</span>
        {"(-95.0 * pow(abs(radius - 0.31), 2.0));"}
      </CodeLine>
      <CodeLine number={17}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" halo = "}
        <span className="text-purple-800 dark:text-[#c472fb]">exp</span>
        {"(-18.0 * pow(abs(radius - 0.31), 2.0));"}
      </CodeLine>
      <CodeLine number={18}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" bands = 0.82 + 0.18 * sin(angle * 25.13272 + radius * 42.0);"}
      </CodeLine>
      <CodeLine number={19}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" color = "}
        <span className="text-purple-800 dark:text-[#c472fb]">palette</span>
        {"(angle + radius * 0.65);"}
      </CodeLine>
      <CodeLine number={20}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">return</span>
        {" vec4f(color * (ring * bands * 2.0 + halo * 0.22), 1.0);"}
      </CodeLine>
      <CodeLine number={21}>{"}"}</CodeLine>
    </>
  );
}

function ColorShaderSource() {
  return (
    <>
      <CodeLine number={1}>
        <span className="text-red-800 dark:text-[#ff518d]">export fn</span>{" "}
        <span className="text-purple-800 dark:text-[#c472fb]">palette</span>
        {"(t: f32) -> vec3f {"}
      </CodeLine>
      <CodeLine number={2}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">let</span>
        {" phase = vec3f(0.0, 0.33, 0.67);"}
      </CodeLine>
      <CodeLine number={3}>
        {"  "}
        <span className="text-red-800 dark:text-[#ff518d]">return</span>
        {" 0.55 + 0.45 * "}
        <span className="text-purple-800 dark:text-[#c472fb]">cos</span>
        {"(6.28318 * (t + phase));"}
      </CodeLine>
      <CodeLine number={4}>{"}"}</CodeLine>
    </>
  );
}

function SourceEditor() {
  const [activeFile, setActiveFile] = useState<SourceFile>("index.ts");
  const codeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (codeRef.current) codeRef.current.scrollTop = 0;
  }, [activeFile]);

  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let nextIndex = index;
    if (event.key === "ArrowRight")
      nextIndex = (index + 1) % sourceFiles.length;
    else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + sourceFiles.length) % sourceFiles.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sourceFiles.length - 1;
    else return;

    event.preventDefault();
    const nextFile = sourceFiles[nextIndex];
    setActiveFile(nextFile);
    document.getElementById(`shader-source-tab-${nextFile}`)?.focus();
  }

  return (
    <section className="flex min-h-[28rem] min-w-0 flex-col bg-background-100 lg:min-h-[34rem]">
      <div
        aria-label="TypeScript and shader source files"
        className="flex h-12 shrink-0 items-stretch border-b border-gray-alpha-400 bg-background-200"
        role="tablist"
      >
        {sourceFiles.map((file, index) => {
          const active = file === activeFile;
          return (
            <button
              aria-controls="shader-source-panel"
              aria-selected={active}
              className={`interactive-tab relative shrink-0 border-r border-gray-alpha-400 px-3 font-mono text-xs transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-gray-1000 focus-visible:outline-offset-[-2px] sm:px-4 ${
                active
                  ? "text-gray-1000 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gray-1000"
                  : "text-gray-800 hover:text-gray-1000"
              }`}
              id={`shader-source-tab-${file}`}
              key={file}
              onClick={() => setActiveFile(file)}
              onKeyDown={(event) => handleTabKey(event, index)}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {file}
            </button>
          );
        })}
      </div>

      <pre
        aria-labelledby={`shader-source-tab-${activeFile}`}
        className="min-h-0 flex-1 overflow-auto px-3 py-5 font-mono text-[12px] leading-[1.65] text-gray-1000 sm:px-5 sm:text-[13px]"
        id="shader-source-panel"
        ref={codeRef}
        role="tabpanel"
      >
        {activeFile === "index.ts" ? <TypeScriptSource /> : null}
        {activeFile === "main.wgsl" ? <MainShaderSource /> : null}
        {activeFile === "color.wgsl" ? <ColorShaderSource /> : null}
      </pre>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-alpha-400 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-gray-800">
        <span>resolve imports</span>
        <span aria-hidden="true">→</span>
        <span>remove unused</span>
        <span aria-hidden="true">→</span>
        <span>minify</span>
      </div>
    </section>
  );
}

function ResultPoster() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden bg-black"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,#2b1740_0%,#11121d_40%,#000_72%)]" />
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-90 blur-[0.3px]"
        style={{
          background:
            "conic-gradient(from 20deg, #ff518d, #ffb347, #00ca52, #29b6f6, #8b5cf6, #ff518d)",
          height: "min(68cqw, 68cqh)",
          maskImage:
            "radial-gradient(circle, transparent 0 49%, black 55% 64%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(circle, transparent 0 49%, black 55% 64%, transparent 70%)",
          width: "min(68cqw, 68cqh)",
        }}
      />
    </div>
  );
}

function CompilerOutput({
  rootRef,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNear, setIsNear] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [previewState, setPreviewState] = useState<PreviewState>("poster");
  const isActive = isNear && isPageVisible;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      setIsNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsNear(entry.isIntersecting),
      { rootMargin: "320px 0px" }
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    function syncVisibility() {
      setIsPageVisible(document.visibilityState !== "hidden");
    }

    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isActive) return;

    let disposed = false;
    let stop: (() => void) | undefined;
    setPreviewState("loading");

    void import("./shader-code-scales-renderer")
      .then(({ renderShaderPreview }) => renderShaderPreview(canvas))
      .then((disposeRenderer) => {
        if (disposed) disposeRenderer();
        else {
          stop = disposeRenderer;
          setPreviewState("running");
        }
      })
      .catch(() => {
        if (!disposed) setPreviewState("unavailable");
      });

    return () => {
      disposed = true;
      stop?.();
    };
  }, [isActive]);

  return (
    <section className="relative flex min-w-0 flex-col border-t border-gray-alpha-400 bg-background-100 lg:border-l lg:border-t-0">
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-0 z-20 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-gray-alpha-500 bg-background-100 font-mono text-xs text-gray-900 lg:left-0 lg:top-1/2"
      >
        <span className="lg:hidden">↓</span>
        <span className="hidden lg:inline">→</span>
      </span>

      <div className="flex h-12 shrink-0 items-center border-b border-gray-alpha-400 px-4">
        <span className="font-mono text-xs text-gray-1000">result</span>
      </div>
      <div
        aria-label="Rainbow ring rendered from the compiled shader modules"
        className="relative aspect-[16/10] min-h-[17rem] overflow-hidden bg-black [container-type:size]"
        role="img"
      >
        <ResultPoster />
        <canvas
          aria-hidden="true"
          className={`absolute inset-0 size-full transition-opacity duration-500 ${
            previewState === "running" ? "opacity-100" : "opacity-0"
          }`}
          ref={canvasRef}
        />
      </div>

      <div className="flex h-12 items-center justify-between border-y border-gray-alpha-400 px-4">
        <span className="font-mono text-xs text-gray-1000">compiled.wgsl</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-800">
          397 B
        </span>
      </div>
      <pre className="min-h-36 flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-4 font-mono text-[10px] leading-5 text-gray-900 sm:text-[11px]">
        <code>{compiledSource}</code>
      </pre>
    </section>
  );
}

export function ShaderCodeScalesDemo() {
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="relative grid overflow-hidden rounded-card border border-gray-alpha-400 bg-background-100 shadow-[0_32px_100px_rgba(0,0,0,0.12)] lg:grid-cols-[1.15fr_0.85fr]"
      ref={rootRef}
    >
      <SourceEditor />
      <CompilerOutput rootRef={rootRef} />
    </div>
  );
}

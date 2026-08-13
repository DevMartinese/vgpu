"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

type OutputTone = "default" | "error" | "success";

interface CommandStep {
  readonly kind: "command";
  readonly command: string;
  readonly output: readonly string[];
  readonly phase?: string;
  readonly tone?: OutputTone;
  readonly holdMs: number;
}

interface EventStep {
  readonly kind: "event";
  readonly label: string;
  readonly phase: string;
  readonly holdMs: number;
}

type TimelineStep = CommandStep | EventStep;

interface Stage {
  readonly id: "docs" | "examples" | "check" | "doctor";
  readonly label: string;
  readonly detail: string;
  readonly initialPhase: string;
  readonly finalPhase: string;
  readonly timeline: readonly TimelineStep[];
}

const stages = [
  {
    id: "docs",
    label: "docs",
    detail: "read the API",
    initialPhase: "pending",
    finalPhase: "surface",
    timeline: [
      {
        kind: "command",
        command: "npx vgpu docs",
        output: [
          "Usage: vgpu docs <command> [args] [flags]",
          "Commands: ls · cat · grep · find · path · symbols",
        ],
        holdMs: 600,
      },
      {
        kind: "command",
        command: "npx vgpu docs ls /guides",
        output: [
          "getting-started.docs.md",
          "concepts-effects.docs.md",
          "shader-workflow.docs.md",
          "texture-formats.docs.md",
        ],
        holdMs: 600,
      },
      {
        kind: "command",
        command: 'npx vgpu docs find "surface"',
        output: [
          "Surface             vgpu    /vgpu/surface.docs.md",
          "SurfaceOptions      vgpu    /vgpu/surface.docs.md",
          "SurfaceResizeEvent  vgpu    /vgpu/surface.docs.md",
        ],
        holdMs: 650,
      },
      {
        kind: "command",
        command: "npx vgpu docs cat Surface",
        output: [
          "# Surface",
          "Canvas-backed render target created by surface(gpu, canvas, opts).",
        ],
        phase: "surface",
        holdMs: 900,
      },
    ],
  },
  {
    id: "examples",
    label: "examples",
    detail: "pull a reference",
    initialPhase: "pending",
    finalPhase: "pulled",
    timeline: [
      {
        kind: "command",
        command: "npx vgpu examples",
        output: [
          "Inspect canonical gallery source (never executes code)",
          "Commands: search · show · cat · pull · cache",
        ],
        holdMs: 600,
      },
      {
        kind: "command",
        command: 'npx vgpu examples search "black hole" --limit 1 --pretty',
        output: [
          "1 result",
          "black-hole · Black Hole",
          "6 files · webgpu · multi-pass",
          "revision baa4b04c…",
        ],
        phase: "found",
        holdMs: 700,
      },
      {
        kind: "command",
        command: "npx vgpu examples cat black-hole index.tsx",
        output: [
          "import { createRenderer } from './renderer';",
          "const renderer = createRenderer({ canvas, onError });",
        ],
        phase: "source",
        holdMs: 700,
      },
      {
        kind: "command",
        command:
          "npx vgpu examples pull black-hole --out ./black-hole --pretty",
        output: [
          "id: black-hole",
          "files: 6 · bytes: 25246",
          "aggregateSha256: fbeb1a1c…",
        ],
        phase: "pulled",
        holdMs: 950,
      },
    ],
  },
  {
    id: "check",
    label: "check",
    detail: "validate WGSL",
    initialPhase: "source",
    finalPhase: "success",
    timeline: [
      {
        kind: "command",
        command: "npx vgpu check ./shader.wgsl | jq -r -f reflection.jq",
        output: [
          "error[VGPU-WGSL-NAGA-UNKNOWN]",
          "shader.wgsl:7:26 — expected expression, found ';'",
          "7 │ override exposure: f32 = ;",
          "  │                          ^",
        ],
        phase: "error",
        tone: "error",
        holdMs: 1_100,
      },
      {
        kind: "event",
        label: "Edited shader.wgsl",
        phase: "fixed",
        holdMs: 650,
      },
      {
        kind: "command",
        command: "npx vgpu check ./shader.wgsl | jq -r -f reflection.jq",
        output: [
          "diagnostics: []",
          "bindings:",
          "  0:0  params         buffer",
          "  0:1  image          texture",
          "  0:2  image_sampler  sampler",
          "overrides: exposure = 1.0 · use_tint = true",
        ],
        phase: "success",
        tone: "success",
        holdMs: 1_000,
      },
    ],
  },
  {
    id: "doctor",
    label: "doctor",
    detail: "repair the runtime",
    initialPhase: "checking",
    finalPhase: "healthy",
    timeline: [
      {
        kind: "command",
        command: "npx vgpu doctor --pretty",
        output: [
          "Verdict: unhealthy · Adapter: none",
          "[FAIL] Vulkan loader libvulkan.so.1 was not found",
          "[FAIL] No WebGPU adapter available",
          "Fix: npx vgpu install-software-renderer",
        ],
        phase: "unhealthy",
        tone: "error",
        holdMs: 1_050,
      },
      {
        kind: "command",
        command: "npx vgpu install-software-renderer",
        output: [
          "Downloaded software renderer",
          "/home/node/.cache/vgpu/software-renderer/25.0.7-vgpu.1",
        ],
        phase: "repairing",
        holdMs: 1_050,
      },
      {
        kind: "command",
        command: "npx vgpu doctor --pretty",
        output: [
          "Verdict: healthy",
          "Adapter: llvmpipe (LLVM 19.1.7) (cpu)",
          "[OK] rendered and read back a 16×16 target",
        ],
        phase: "healthy",
        tone: "success",
        holdMs: 1_000,
      },
    ],
  },
] as const satisfies readonly Stage[];

type StageId = (typeof stages)[number]["id"];

interface ProofState {
  readonly stageId: StageId;
  readonly phase: string;
}

interface CommandEntry {
  readonly kind: "command";
  readonly command: string;
  readonly output?: readonly string[];
  readonly tone: OutputTone;
}

interface EventEntry {
  readonly kind: "event";
  readonly label: string;
}

type TerminalEntry = CommandEntry | EventEntry;

const TERMINAL_TOKEN_PATTERN = /\S+\s*/g;
const TERMINAL_TOKEN_DELAY_MS = 65;
const BEFORE_FIRST_COMMAND_MS = 360;
const AFTER_COMMAND_MS = 180;
const OUTPUT_LINE_DELAY_MS = 45;
const terminalPromptClass =
  "overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gray-1000 sm:text-sm";
const waitingDotKeys = ["one", "two", "three"] as const;

function tokenizeTerminalCommand(command: string) {
  return command.match(TERMINAL_TOKEN_PATTERN) ?? [];
}

function stageDuration(stage: Stage) {
  return (
    BEFORE_FIRST_COMMAND_MS +
    stage.timeline.reduce((duration, step) => {
      if (step.kind === "event") return duration + step.holdMs;
      return (
        duration +
        tokenizeTerminalCommand(step.command).length * TERMINAL_TOKEN_DELAY_MS +
        AFTER_COMMAND_MS +
        step.output.length * OUTPUT_LINE_DELAY_MS +
        step.holdMs
      );
    }, 0)
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}

const animationCss = [
  "@keyframes agent-terminal-token-in {",
  "  from { opacity: 0; filter: blur(4px); transform: translateY(0.12em); }",
  "  to { opacity: 1; filter: blur(0); transform: translateY(0); }",
  "}",
  "@keyframes agent-terminal-output-in {",
  "  from { opacity: 0; transform: translateY(0.35em); }",
  "  to { opacity: 1; transform: translateY(0); }",
  "}",
  "@keyframes agent-terminal-cursor {",
  "  0%, 46% { opacity: 1; }",
  "  47%, 100% { opacity: 0; }",
  "}",
  "@keyframes agent-command-waiting-dot {",
  "  0%, 60%, 100% { opacity: 0.2; }",
  "  30% { opacity: 1; }",
  "}",
  "@keyframes agent-command-proof-in {",
  "  from { opacity: 0; transform: translateY(6px); }",
  "  to { opacity: 1; transform: translateY(0); }",
  "}",
  "@keyframes agent-command-progress {",
  "  from { transform: scaleX(0); }",
  "  to { transform: scaleX(1); }",
  "}",
  "[data-agent-command-demo] .agent-terminal-token {",
  "  display: inline-block;",
  "  animation: agent-terminal-token-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;",
  "}",
  "[data-agent-command-demo] .agent-terminal-output-line,",
  "[data-agent-command-demo] .agent-terminal-event {",
  "  display: block;",
  "  animation: agent-terminal-output-in 220ms ease-out both;",
  "}",
  "[data-agent-command-demo] .agent-terminal-cursor {",
  "  animation: agent-terminal-cursor 900ms steps(1, end) infinite;",
  "}",
  "[data-agent-command-demo] .agent-command-waiting-dot {",
  "  animation: agent-command-waiting-dot 900ms ease-in-out infinite;",
  "}",
  "[data-agent-command-demo] [data-proof] {",
  "  animation: agent-command-proof-in 240ms ease-out both;",
  "}",
  "[data-agent-command-demo] .agent-command-progress {",
  "  transform-origin: left;",
  "  animation: agent-command-progress linear both;",
  "}",
  "@media (prefers-reduced-motion: reduce) {",
  "  [data-agent-command-demo] [data-proof],",
  "  [data-agent-command-demo] .agent-terminal-token,",
  "  [data-agent-command-demo] .agent-terminal-output-line,",
  "  [data-agent-command-demo] .agent-terminal-event,",
  "  [data-agent-command-demo] .agent-terminal-cursor,",
  "  [data-agent-command-demo] .agent-command-waiting-dot,",
  "  [data-agent-command-demo] .agent-command-progress { animation: none; }",
  "}",
].join("\n");

function StreamedCommand({ value }: { value: string }) {
  return tokenizeTerminalCommand(value).map((token, index) => (
    <span className="agent-terminal-token" key={index + "-" + token}>
      {token}
    </span>
  ));
}

function TerminalCursor() {
  return (
    <span
      aria-hidden="true"
      className="agent-terminal-cursor ml-[0.18em] inline-block h-[1em] w-[0.5em] translate-y-[0.12em] bg-gray-900"
    />
  );
}

function outputClass(tone: OutputTone) {
  if (tone === "error") return "text-red-800 dark:text-[#e5484d]";
  if (tone === "success") return "text-gray-900";
  return "text-gray-900";
}

function TerminalTimeline({
  setProofState,
  stage,
}: {
  setProofState: Dispatch<SetStateAction<ProofState>>;
  stage: Stage;
}) {
  const [entries, setEntries] = useState<readonly TerminalEntry[]>([]);
  const [complete, setComplete] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    setEntries([]);
    setComplete(false);
    setProofState({ stageId: stage.id, phase: stage.initialPhase });

    async function play() {
      if (reducedMotion) {
        setEntries(
          stage.timeline.map((step) =>
            step.kind === "event"
              ? { kind: "event", label: step.label }
              : {
                  kind: "command",
                  command: step.command,
                  output: step.output,
                  tone: step.tone ?? "default",
                }
          )
        );
        setProofState({ stageId: stage.id, phase: stage.finalPhase });
        setComplete(true);
        return;
      }

      await wait(BEFORE_FIRST_COMMAND_MS);

      for (const step of stage.timeline) {
        if (cancelled) return;

        if (step.kind === "event") {
          setEntries((current) => [
            ...current,
            { kind: "event", label: step.label },
          ]);
          setProofState({ stageId: stage.id, phase: step.phase });
          await wait(step.holdMs);
          continue;
        }

        setEntries((current) => [
          ...current,
          { kind: "command", command: "", tone: step.tone ?? "default" },
        ]);

        let streamedCommand = "";
        for (const token of tokenizeTerminalCommand(step.command)) {
          await wait(TERMINAL_TOKEN_DELAY_MS);
          if (cancelled) return;
          streamedCommand += token;
          const command = streamedCommand;
          setEntries((current) => [
            ...current.slice(0, -1),
            {
              kind: "command",
              command,
              tone: step.tone ?? "default",
            },
          ]);
        }

        await wait(AFTER_COMMAND_MS);
        if (cancelled) return;
        setEntries((current) => [
          ...current.slice(0, -1),
          {
            kind: "command",
            command: step.command,
            output: step.output,
            tone: step.tone ?? "default",
          },
        ]);
        if (step.phase) {
          setProofState({ stageId: stage.id, phase: step.phase });
        }
        await wait(step.output.length * OUTPUT_LINE_DELAY_MS + step.holdMs);
      }

      if (!cancelled) setComplete(true);
    }

    void play();
    return () => {
      cancelled = true;
    };
  }, [setProofState, stage]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [entries, complete]);

  return (
    <div
      className="h-full min-h-0 overflow-y-auto p-5 font-mono [scrollbar-width:none] sm:p-7 [&::-webkit-scrollbar]:hidden"
      ref={viewportRef}
    >
      {entries.map((entry, entryIndex) => {
        if (entry.kind === "event") {
          return (
            <p
              className="agent-terminal-event mt-5 text-xs text-green-800 dark:text-[#00ca52] sm:text-[13px]"
              key={entryIndex + "-" + entry.label}
            >
              <span aria-hidden="true">●</span> {entry.label}
            </p>
          );
        }

        const streaming = !entry.output && !complete;
        return (
          <div className={entryIndex === 0 ? "" : "mt-5"} key={entryIndex}>
            <p className={terminalPromptClass}>
              <span className="text-gray-700">$</span>{" "}
              <StreamedCommand value={entry.command} />
              {streaming ? <TerminalCursor /> : null}
            </p>
            {entry.output ? (
              <pre
                className={`mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-5 sm:text-[11px] ${outputClass(
                  entry.tone
                )}`}
              >
                {entry.output.map((line, lineIndex) => (
                  <span
                    className="agent-terminal-output-line"
                    key={lineIndex + "-" + line}
                    style={{
                      animationDelay: lineIndex * OUTPUT_LINE_DELAY_MS + "ms",
                    }}
                  >
                    {line || "\u00a0"}
                  </span>
                ))}
              </pre>
            ) : null}
          </div>
        );
      })}

      {entries.length === 0 || complete ? (
        <p
          aria-hidden="true"
          className={`${terminalPromptClass} ${
            entries.length === 0 ? "" : "mt-5"
          }`}
        >
          <span className="text-gray-700">$</span> <TerminalCursor />
        </p>
      ) : null}
    </div>
  );
}

function ProofPending() {
  return (
    <div className="grid h-full place-items-center p-8" data-proof>
      <div
        aria-label="Waiting for output"
        className="flex h-6 items-center justify-center gap-2"
        role="status"
      >
        {waitingDotKeys.map((dot, index) => (
          <span
            aria-hidden="true"
            className="agent-command-waiting-dot size-1.5 rounded-full bg-gray-800"
            key={dot}
            style={{ animationDelay: index * 120 + "ms" }}
          />
        ))}
      </div>
    </div>
  );
}

function DocsProof() {
  return (
    <div className="flex h-full flex-col p-5 sm:p-7" data-proof>
      <div className="flex items-start justify-between gap-4 border-b border-gray-alpha-400 pb-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-blue-800 dark:text-[#29b6f6]">
            /vgpu/surface.docs.md
          </p>
          <h3 className="mt-2 text-pretty text-xl text-gray-1000">Surface</h3>
        </div>
        <span className="rounded-full border border-gray-alpha-400 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-800">
          installed
        </span>
      </div>

      <p className="mt-5 max-w-lg text-pretty text-sm leading-relaxed text-gray-900">
        Canvas-backed render target created by{" "}
        <code className="font-mono text-gray-1000">surface(gpu, canvas)</code>.
        Use it for browser canvases, offscreen rendering, and resize-driven
        targets.
      </p>

      <pre className="mt-6 overflow-x-auto rounded-lg border border-gray-alpha-400 bg-gray-100 p-4 font-mono text-[11px] leading-6 text-gray-950 sm:text-xs">
        <code>
          <span className="text-red-800 dark:text-[#ff518d]">interface</span>
          {" Surface "}
          <span className="text-gray-800">extends</span>
          {" Target {\n"}
          {"  readonly canvas: HTMLCanvasElement;\n"}
          {"  readonly size: readonly [number, number];\n"}
          {"  resize(size: readonly [number, number]): void;\n"}
          {"}"}
        </code>
      </pre>
    </div>
  );
}

function ExamplesProof({ phase }: { phase: string }) {
  const pulled = phase === "pulled";
  const source = phase === "source";

  return (
    <div className="flex h-full flex-col" data-proof>
      <div className="relative aspect-video overflow-hidden border-b border-gray-alpha-400 bg-black">
        <Image
          alt="Black Hole canonical vgpu example"
          className="object-cover"
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          src="/examples/black-hole.card.png"
        />
        <span className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/70 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/65 backdrop-blur-sm">
          official
        </span>
      </div>
      <div className="grid flex-1 gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-end sm:p-7">
        <div>
          <h3 className="text-pretty text-xl text-gray-1000">Black Hole</h3>
          <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-gray-900">
            {pulled
              ? "Six source files are pinned to one revision and ready in the agent's workspace."
              : source
              ? "The agent is inspecting the canonical entry point before pulling the complete source."
              : "The canonical gallery returned one matching WebGPU reference."}
          </p>
        </div>
        <div className="font-mono text-[10px] leading-5 text-gray-800">
          <p>6 files</p>
          <p>25.2 KB</p>
          <p className="text-green-800 dark:text-[#00ca52]">
            {pulled
              ? "integrity verified"
              : source
              ? "source inspected"
              : "match found"}
          </p>
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  change,
  children,
  number,
}: {
  change?: "added" | "removed";
  children: ReactNode;
  number: number;
}) {
  const changeClass =
    change === "removed"
      ? "bg-red-100 before:bg-red-800 dark:before:bg-[#e5484d]"
      : change === "added"
      ? "bg-green-100 before:bg-green-800 dark:before:bg-[#00ca52]"
      : "";

  return (
    <span
      className={`relative -mx-5 block min-w-max px-5 before:absolute before:left-0 before:top-[0.2em] before:h-[1.25em] before:w-0.5 before:content-[''] ${changeClass}`}
    >
      <span
        className={`mr-2 inline-block w-3 select-none text-center ${
          change === "removed"
            ? "text-red-800 dark:text-[#e5484d]"
            : change === "added"
            ? "text-green-800 dark:text-[#00ca52]"
            : "text-transparent"
        }`}
      >
        {change === "removed" ? "−" : change === "added" ? "+" : "·"}
      </span>
      <span className="mr-4 inline-block w-4 select-none text-right text-gray-700">
        {number}
      </span>
      {children}
    </span>
  );
}

function CheckSource({ edited }: { edited: boolean }) {
  return (
    <pre className="overflow-x-auto px-5 py-6 font-mono text-[11px] leading-6 text-gray-950 sm:text-xs">
      <code>
        <SourceRow number={1}>
          <span className="text-red-800 dark:text-[#ff518d]">struct</span>
          {" Params { tint: vec4f }"}
        </SourceRow>
        <SourceRow number={2}>{"\u00a0"}</SourceRow>
        <SourceRow number={3}>
          <span className="text-purple-800 dark:text-[#c472fb]">
            @group(0) @binding(0)
          </span>
          {" var<uniform> params: Params;"}
        </SourceRow>
        <SourceRow number={4}>
          <span className="text-purple-800 dark:text-[#c472fb]">
            @group(0) @binding(1)
          </span>
          {" var image: texture_2d<f32>;"}
        </SourceRow>
        <SourceRow number={5}>
          <span className="text-purple-800 dark:text-[#c472fb]">
            @group(0) @binding(2)
          </span>
          {" var image_sampler: sampler;"}
        </SourceRow>
        <SourceRow number={6}>{"\u00a0"}</SourceRow>
        {edited ? (
          <>
            <SourceRow change="removed" number={7}>
              <span className="text-red-800 dark:text-[#ff518d]">override</span>
              {" exposure: f32 = ;"}
            </SourceRow>
            <SourceRow change="added" number={7}>
              <span className="text-red-800 dark:text-[#ff518d]">override</span>
              {" exposure: f32 = 1.0;"}
            </SourceRow>
          </>
        ) : (
          <SourceRow number={7}>
            <span className="text-red-800 dark:text-[#ff518d]">override</span>
            {" exposure: f32 = ;"}
          </SourceRow>
        )}
        <SourceRow number={8}>
          <span className="text-red-800 dark:text-[#ff518d]">override</span>
          {" use_tint: bool = true;"}
        </SourceRow>
      </code>
    </pre>
  );
}

function CheckProof({ phase }: { phase: string }) {
  const edited = phase === "fixed" || phase === "success";

  return (
    <div className="h-full" data-proof>
      <CheckSource edited={edited} />
    </div>
  );
}

function DoctorProof({ phase }: { phase: string }) {
  const healthy = phase === "healthy";
  const unhealthy = phase === "unhealthy";
  const repairing = phase === "repairing";
  const title = healthy
    ? "Ready to render"
    : unhealthy
    ? "No WebGPU adapter"
    : repairing
    ? "Installing renderer"
    : "Checking runtime";
  const status = healthy
    ? "healthy"
    : unhealthy
    ? "unhealthy"
    : repairing
    ? "repairing"
    : "checking";
  const statusClass = healthy
    ? "text-green-800 dark:text-[#00ca52]"
    : unhealthy
    ? "text-red-800 dark:text-[#e5484d]"
    : "text-gray-800";
  const detail = healthy
    ? "llvmpipe · 16×16 render and readback passed"
    : unhealthy
    ? "No adapter found. A portable renderer is required."
    : repairing
    ? "Downloading and verifying the software renderer."
    : "Inspecting the runtime and requesting an adapter.";

  return (
    <div className="grid h-full place-items-center p-8" data-proof>
      <div className="w-full max-w-sm text-center">
        <span
          className={`inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] ${statusClass}`}
        >
          <span className="size-1.5 rounded-full bg-current" /> {status}
        </span>
        <h3 className="mt-4 text-pretty text-2xl text-gray-1000">{title}</h3>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-gray-900">
          {detail}
        </p>
      </div>
    </div>
  );
}

function ProofPanel({ phase, stage }: { phase: string; stage: Stage }) {
  if (stage.id === "docs") {
    return phase === "pending" ? <ProofPending /> : <DocsProof />;
  }
  if (stage.id === "examples") {
    return phase === "pending" ? (
      <ProofPending />
    ) : (
      <ExamplesProof phase={phase} />
    );
  }
  if (stage.id === "check") return <CheckProof phase={phase} />;
  return <DoctorProof phase={phase} />;
}

function tabClass(active: boolean) {
  const state = active
    ? "text-gray-1000"
    : "text-gray-800 hover:text-gray-1000";
  return (
    "interactive-tab relative min-w-0 border-r border-gray-alpha-400 px-2 py-3 text-left font-mono " +
    "transition-colors last:border-r-0 focus-visible:z-10 focus-visible:outline " +
    "focus-visible:outline-1 focus-visible:outline-gray-1000 focus-visible:outline-offset-[-2px] " +
    "sm:px-4 " +
    state
  );
}

export function AgentCommandDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [animationRun, setAnimationRun] = useState(0);
  const activeStage: Stage = stages[activeIndex];
  const [proofState, setProofState] = useState<ProofState>({
    stageId: activeStage.id,
    phase: activeStage.initialPhase,
  });
  const progressDuration = stageDuration(activeStage);
  const visiblePhase =
    proofState.stageId === activeStage.id
      ? proofState.phase
      : activeStage.initialPhase;

  useEffect(() => {
    if (
      !autoplay ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % stages.length);
    }, progressDuration);
    return () => window.clearTimeout(timeout);
  }, [autoplay, progressDuration]);

  function selectStage(index: number) {
    const stage = stages[index];
    setAutoplay(false);
    setActiveIndex(index);
    setProofState({ stageId: stage.id, phase: stage.initialPhase });
    setAnimationRun((current) => current + 1);
  }

  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % stages.length;
    else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + stages.length) % stages.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = stages.length - 1;
    else return;

    event.preventDefault();
    selectStage(nextIndex);
    document
      .getElementById("agent-command-tab-" + stages[nextIndex].id)
      ?.focus();
  }

  return (
    <div
      className="overflow-hidden rounded-card border border-gray-alpha-400 bg-background-100 shadow-[0_32px_100px_rgba(0,0,0,0.12)]"
      data-agent-command-demo
    >
      <style>{animationCss}</style>

      <div
        aria-label="vgpu CLI capabilities"
        className="grid grid-cols-4 border-b border-gray-alpha-400 bg-background-200"
        role="tablist"
      >
        {stages.map((stage, index) => {
          const active = index === activeIndex;
          return (
            <button
              aria-controls="agent-command-panel"
              aria-selected={active}
              className={tabClass(active)}
              id={"agent-command-tab-" + stage.id}
              key={stage.id}
              onClick={() => selectStage(index)}
              onKeyDown={(event) => handleTabKey(event, index)}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <span className="block truncate text-[11px] sm:text-xs">
                {stage.label}
              </span>
              <span className="mt-1 hidden truncate text-[11px] text-gray-800 md:block">
                {stage.detail}
              </span>
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-gray-alpha-400"
                >
                  <span
                    className="agent-command-progress block h-full w-full bg-gray-1000"
                    key={
                      activeStage.id +
                      "-" +
                      animationRun +
                      "-" +
                      (autoplay ? "auto" : "manual")
                    }
                    style={{ animationDuration: progressDuration + "ms" }}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={"agent-command-tab-" + activeStage.id}
        className="grid lg:h-[30rem] lg:grid-cols-[0.92fr_1.08fr]"
        id="agent-command-panel"
        role="tabpanel"
      >
        <section className="h-[25rem] min-w-0 overflow-hidden border-b border-gray-alpha-400 bg-background-100 sm:h-[28rem] lg:h-full lg:border-b-0 lg:border-r">
          <TerminalTimeline
            key={activeStage.id + "-" + animationRun}
            setProofState={setProofState}
            stage={activeStage}
          />
        </section>

        <section className="h-[25rem] min-w-0 overflow-hidden bg-background-100 sm:h-[28rem] lg:h-full">
          <ProofPanel phase={visiblePhase} stage={activeStage} />
        </section>
      </div>
    </div>
  );
}

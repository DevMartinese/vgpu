'use client';

import { Component, lazy, Suspense, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { getExampleComponentLoader } from '@/lib/example-components';
import { type ExampleSlug } from '@/lib/example-slugs';

interface ExampleCanvasProps {
  slug: ExampleSlug;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function postPreviewError(slug: ExampleSlug, message: string): void {
  window.parent?.postMessage(
    { type: 'vgpu-example-error', slug, message },
    window.location.origin,
  );
}

function ErrorDisplay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 overflow-auto bg-black/90 p-4 font-mono text-xs leading-5 text-red-200">
      <div className="mb-2 font-sans text-sm font-semibold text-red-100">Preview error</div>
      <pre className="whitespace-pre-wrap">{message}</pre>
    </div>
  );
}

interface PreviewErrorBoundaryProps {
  readonly slug: ExampleSlug;
  readonly children: ReactNode;
}

interface PreviewErrorBoundaryState {
  readonly message: string | null;
}

class PreviewErrorBoundary extends Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  state: PreviewErrorBoundaryState = { message: null };
  private posted = false;

  static getDerivedStateFromError(error: unknown): PreviewErrorBoundaryState {
    return { message: messageOf(error) };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    if (this.posted) return;
    this.posted = true;
    postPreviewError(this.props.slug, messageOf(error));
  }

  render() {
    if (this.state.message) return <ErrorDisplay message={this.state.message} />;
    return this.props.children;
  }
}

function ReactExampleCanvas({ slug }: { slug: ExampleSlug }) {
  const loader = getExampleComponentLoader(slug);
  const LazyExample = useMemo(
    () => lazy(() => loader().then((module) => ({ default: module.Example }))),
    [loader],
  );
  return (
    <Suspense fallback={<div className="h-full w-full bg-black" aria-label="Loading example" />}>
      <LazyExample />
    </Suspense>
  );
}

export function ExampleCanvas({ slug }: ExampleCanvasProps) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <PreviewErrorBoundary key={slug} slug={slug}>
        <ReactExampleCanvas slug={slug} />
      </PreviewErrorBoundary>
    </div>
  );
}

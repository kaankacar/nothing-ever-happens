"use client";

import { Component, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  label: string;
  children: ReactNode;
}

interface State {
  err: Error | null;
}

/**
 * Local error boundary: if a child component throws (most often the
 * force-graph canvas under React 19), render a fallback panel so the rest
 * of the UI stays alive. We log to the console for debugging but never
 * propagate the error up.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  override componentDidCatch(err: Error): void {
    console.warn(`[${this.props.label}] component crashed`, err);
  }

  override render(): ReactNode {
    if (this.state.err) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

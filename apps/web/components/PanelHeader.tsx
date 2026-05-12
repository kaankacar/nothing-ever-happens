"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PanelProps {
  title: string;
  /** Optional small suffix shown faded after the title (e.g. counts). */
  suffix?: string;
  /** When set, an info icon appears that opens this tooltip on click. */
  hint?: string;
  children: ReactNode;
  /** Extra classes for the outer .panel container. */
  className?: string;
  /** If provided, the panel renders this instead of `children` when in
   *  fullscreen mode. Useful for panels whose fullscreen view should expand
   *  to show much more data than the compact inline version. */
  renderFullscreen?: () => ReactNode;
}

/**
 * Standard panel wrapper. Provides a title bar, optional info hint, and a
 * fullscreen toggle. When fullscreen, the panel is portaled to body so it
 * overlays the rest of the layout.
 */
export function Panel({ title, suffix, hint, children, className, renderFullscreen }: PanelProps) {
  const [full, setFull] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);

  const body = full && renderFullscreen ? renderFullscreen() : children;

  const inner = (
    <div className={`panel ${className ?? ""} ${full ? "panel-full" : ""}`}>
      <div className="panel-title">
        <span>
          {title}
          {suffix && <span style={{ color: "var(--fg-dim)", marginLeft: 8 }}>{suffix}</span>}
        </span>
        <div className="panel-actions">
          {hint && (
            <button
              className="panel-btn"
              aria-label="What is this panel?"
              onClick={() => setHintOpen((v) => !v)}
              title="What is this panel?"
            >
              i
            </button>
          )}
          <button
            className="panel-btn"
            aria-label={full ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => setFull((v) => !v)}
            title={full ? "Exit fullscreen (Esc)" : "Fullscreen"}
          >
            {full ? "×" : "⤢"}
          </button>
        </div>
      </div>
      {hint && hintOpen && (
        <div className="panel-hint">{hint}</div>
      )}
      <div className="panel-body">{body}</div>
    </div>
  );

  if (!full) return inner;
  if (typeof document === "undefined") return inner;
  return createPortal(
    <div className="panel-fullscreen-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) setFull(false);
    }}>
      {inner}
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useArena } from "../lib/store";
import { Panel } from "./PanelHeader";

export function Conversations() {
  const messages = useArena((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);

  return (
    <Panel
      title="Persona conversations · live"
      suffix={`${messages.length}`}
      hint="Each line is a message from one simulated persona to another, drafted by Gemini. As they talk, their stance on A/B/C/D drifts — the verdict is the eventual majority."
      className="conversation-panel"
    >
      <div ref={ref} style={{ height: "100%", overflow: "auto" }}>
        {messages.length === 0 ? (
          <p className="empty">Persona dialogue will stream here as the simulation runs.</p>
        ) : (
          messages.map((m) => (
            <div className="conversation-item" key={`${m.roundId}-${m.seq}`}>
              <div className="meta">
                <span className="from">{m.from}</span>
                <span className="arrow">→</span>
                <span className="to">{m.to}</span>
                <span style={{ marginLeft: "auto", color: "var(--fg-dim)" }}>
                  tick {m.tick}
                </span>
              </div>
              <div>{m.content}</div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

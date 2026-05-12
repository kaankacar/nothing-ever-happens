"use client";

import { useMemo } from "react";
import { useArena } from "../lib/store";

const CLUSTER_LABEL: Record<string, string> = {
  A: "leaning A",
  B: "leaning B",
  C: "leaning C",
  D: "leaning D",
  neutral: "undecided",
};

/**
 * Overlay panel that appears when a persona node is clicked. Shows:
 *  - persona identity + leaning + influence
 *  - every message they sent or received this round
 */
export function NodeInspector() {
  const selected = useArena((s) => s.selectedNode);
  const graph = useArena((s) => s.graph);
  const messages = useArena((s) => s.messages);
  const setSelectedNode = useArena((s) => s.setSelectedNode);

  const node = useMemo(() => {
    if (!selected || !graph) return null;
    return graph.nodes.find((n) => n.id === selected) ?? null;
  }, [selected, graph]);

  const conversations = useMemo(() => {
    if (!selected) return [] as { dir: "sent" | "recv"; other: string; tick: number; content: string }[];
    return messages
      .filter((m) => m.from === selected || m.to === selected)
      .map((m) => ({
        dir: (m.from === selected ? "sent" : "recv") as "sent" | "recv",
        other: m.from === selected ? m.to : m.from,
        tick: m.tick,
        content: m.content,
      }));
  }, [selected, messages]);

  if (!selected || !node) return null;

  return (
    <div className="node-inspector" role="dialog">
      <div className="ni-head">
        <div>
          <div className="ni-id">{node.id}</div>
          <div className="ni-label">{node.label}</div>
        </div>
        <button className="panel-btn" onClick={() => setSelectedNode(null)} aria-label="Close">×</button>
      </div>
      <div className="ni-stats">
        <span>
          <span className={`key ${node.cluster}`}>{node.cluster === "neutral" ? "—" : node.cluster}</span>
          {CLUSTER_LABEL[node.cluster] ?? "—"}
        </span>
        <span>influence {(node.influence * 100).toFixed(0)}%</span>
      </div>
      <div className="ni-list">
        {conversations.length === 0 ? (
          <p className="empty">No messages yet this round.</p>
        ) : (
          conversations.map((c, i) => (
            <div className={`ni-msg ni-${c.dir}`} key={i}>
              <div className="ni-msg-head">
                <span className="ni-dir">{c.dir === "sent" ? "→" : "←"}</span>
                <span className="ni-other">{c.other}</span>
                <span className="ni-tick">tick {c.tick}</span>
              </div>
              <div>{c.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useArena } from "../lib/store";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const CLUSTER_COLORS: Record<string, string> = {
  A: "#65d5ff",
  B: "#ffb86b",
  C: "#c084fc",
  D: "#6bf2a4",
  neutral: "#7c8696",
};

export function Graph() {
  const graph = useArena((s) => s.graph);
  const setSelectedNode = useArena((s) => s.setSelectedNode);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    return {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        cluster: n.cluster,
        val: 1 + n.influence * 3,
      })),
      links: graph.edges.map((e) => ({
        source: e.from,
        target: e.to,
        value: e.weight,
      })),
    };
  }, [graph]);

  return (
    <div className="graph-container" ref={wrapRef}>
      {data.nodes.length === 0 ? (
        <p className="empty">MiroFish graph will appear here once the simulation starts.</p>
      ) : (
        <ForceGraph2D
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="#0a0e14"
          nodeRelSize={3}
          linkColor={() => "rgba(124,134,150,0.35)"}
          linkWidth={(l: any) => Math.min(2, 0.4 + 0.15 * (l.value ?? 1))}
          onNodeClick={(node: any) => setSelectedNode(String(node.id))}
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, scale: number) => {
            const r = Math.max(2.5, (node.val ?? 1) * 1.8);
            ctx.beginPath();
            ctx.fillStyle = CLUSTER_COLORS[node.cluster] ?? "#7c8696";
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fill();
            if (scale > 2.5) {
              ctx.fillStyle = "rgba(212,218,227,0.7)";
              ctx.font = `${10 / scale}px -apple-system, sans-serif`;
              ctx.fillText(node.label, node.x + r + 1, node.y + 3);
            }
          }}
          cooldownTime={Infinity}
          d3VelocityDecay={0.25}
        />
      )}
    </div>
  );
}

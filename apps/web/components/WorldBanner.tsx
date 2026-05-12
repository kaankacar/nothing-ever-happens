"use client";

import { useEffect } from "react";
import { useArena, ORACLE } from "../lib/store";

/**
 * Always-visible banner above the main grid. Shows a one-line summary of
 * the running narrative — total settled rounds, the latest verdict, and a
 * "read more" affordance. Clicking opens the full World modal.
 */
export function WorldBanner() {
  const world = useArena((s) => s.world);
  const setWorld = useArena((s) => s.setWorld);
  const setWorldOpen = useArena((s) => s.setWorldOpen);

  useEffect(() => {
    let cancelled = false;
    const fetchWorld = () => {
      fetch(`${ORACLE}/world`)
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) setWorld(j);
        })
        .catch(() => undefined);
    };
    fetchWorld();
    const t = setInterval(fetchWorld, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [setWorld]);

  if (!world || world.settledCount === 0) {
    return (
      <div className="world-banner" role="button" tabIndex={0} onClick={() => setWorldOpen(true)}>
        <span className="world-banner-badge">The world so far</span>
        <span className="world-banner-summary">
          No rounds settled yet — the kale industry hasn't faced its first crisis. Click for full history once rounds resolve.
        </span>
      </div>
    );
  }

  const last = world.events[world.events.length - 1];
  const oneLine = world.narrative
    ? world.narrative.split(/[.!?]\s/)[0] + "."
    : `${world.settledCount} rounds settled.`;

  return (
    <div className="world-banner" role="button" tabIndex={0} onClick={() => setWorldOpen(true)}>
      <span className="world-banner-badge">The world so far</span>
      <span className="world-banner-summary">{oneLine}</span>
      <span className="world-banner-meta">
        {world.settledCount} rounds
        {last && (
          <>
            {" · last: "}
            <span className={`key ${last.verdict}`}>{last.verdict}</span>
          </>
        )}
        {" · click to read"}
      </span>
    </div>
  );
}

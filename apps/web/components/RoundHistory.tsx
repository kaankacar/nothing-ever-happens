"use client";

import { useEffect } from "react";
import { useArena, ORACLE } from "../lib/store";

export function RoundHistory() {
  const history = useArena((s) => s.history);
  const addHistory = useArena((s) => s.addHistory);
  const setDetailRound = useArena((s) => s.setDetailRound);

  useEffect(() => {
    fetch(`${ORACLE}/rounds/recent`)
      .then((r) => r.json())
      .then((j) => (j.rounds ?? []).forEach(addHistory))
      .catch(() => undefined);
  }, [addHistory]);

  if (history.length === 0) return null;

  return (
    <div className="history-strip">
      {history.slice(0, 10).map((h) => (
        <button
          className="history-pip"
          key={h.roundId}
          title={`${h.blurb} — click for details`}
          onClick={() => setDetailRound(h)}
          type="button"
        >
          <div className="history-head">
            <span className="history-id">#{h.roundId}</span>
            <span className={`history-verdict key ${h.verdict}`}>{h.verdict}</span>
          </div>
          <div className="history-stats">
            <span>{h.correct}/{h.revealed} right</span>
            <span>·</span>
            <span>{h.txCount} tx</span>
          </div>
        </button>
      ))}
    </div>
  );
}

"use client";

import { useArena } from "../lib/store";
import { Panel } from "./PanelHeader";
import { AllRounds } from "./AllRounds";

const CHOICES = ["A", "B", "C", "D"] as const;

export function Question() {
  const question = useArena((s) => s.question);
  const resolution = useArena((s) => s.resolution);

  return (
    <Panel
      title={question ? `Round #${question.roundId}` : "Round"}
      suffix={question ? question.tags.join(" · ") : undefined}
      hint="The scenario currently being predicted. Fullscreen this panel to browse every round so far — the current live round plus the most recent settled rounds."
      className="question-panel"
      renderFullscreen={() => <AllRounds />}
    >
      {!question ? (
        <p className="empty">Waiting for the next round to open …</p>
      ) : (
        <>
          <p className="scenario">{question.scenario}</p>
          <div className="options">
            {CHOICES.map((k) => (
              <div className="option" key={k}>
                <span className={`key ${k}`}>{k}</span>
                {question.options[k]}
              </div>
            ))}
          </div>
          {resolution && (
            <>
              <div className="distribution">
                {CHOICES.map((k) => (
                  <div className={`dist-bar dist-${k}`} key={k}>
                    <span style={{ width: `${(resolution.distribution[k] * 100).toFixed(1)}%` }} />
                  </div>
                ))}
              </div>
              <div className="verdict-banner">
                MiroFish verdict: <strong>{resolution.verdict}</strong> —{" "}
                {(resolution.distribution[resolution.verdict] * 100).toFixed(1)}% confidence
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

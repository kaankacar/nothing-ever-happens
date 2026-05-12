import type { RoundSummary } from "@mirofish/shared";

/** Ring buffer of recently resolved rounds. In-process only; resets on restart. */
const CAP = 10;
const buffer: RoundSummary[] = [];

export function recordRound(summary: RoundSummary): void {
  buffer.unshift(summary);
  if (buffer.length > CAP) buffer.length = CAP;
}

export function recentRounds(): RoundSummary[] {
  return [...buffer];
}

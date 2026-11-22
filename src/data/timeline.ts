/**
 * Match-clock reminders. Times are in seconds on the in-game clock.
 * Objective timings shift between patches — edit here if a patch moves them.
 */
export interface TimelineEvent {
  atSec: number;
  /** Stable id for de-duplication. */
  id: string;
  say: string;
  label: string;
}

const m = (min: number, sec = 0) => min * 60 + sec;

export const TIMELINE: TimelineEvent[] = [
  { id: "turtle-warn", atSec: m(1, 30), label: "Turtle soon", say: "Turtle spawns in thirty seconds. Clear your wave and rotate." },
  { id: "turtle", atSec: m(2), label: "Turtle spawns", say: "Turtle is up." },
  { id: "level4", atSec: m(3, 30), label: "Ultimates online", say: "Most heroes have their ultimate now. Watch for ganks." },
  { id: "mid-check", atSec: m(5), label: "Item check", say: "Five minutes. Open the scoreboard so I can check their items." },
  { id: "lord-warn", atSec: m(7, 30), label: "Lord soon", say: "Lord spawns in thirty seconds. Group with your team." },
  { id: "lord", atSec: m(8), label: "Lord spawns", say: "Lord is up." },
  { id: "late-check", atSec: m(10), label: "Item check", say: "Ten minutes. Open the scoreboard and I'll re-check who is fed." },
  { id: "late", atSec: m(15), label: "Late game", say: "Late game. One death can lose it — stay with your team and consider a defensive sixth item." },
];

/** Events whose time falls in (prevSec, nowSec]. */
export function eventsBetween(prevSec: number, nowSec: number): TimelineEvent[] {
  // A big jump means the clock was re-synced, not that time passed: don't replay a backlog.
  if (nowSec - prevSec > 20) return [];
  return TIMELINE.filter((e) => e.atSec > prevSec && e.atSec <= nowSec);
}

export function upcoming(nowSec: number, count = 2): TimelineEvent[] {
  return TIMELINE.filter((e) => e.atSec > nowSec).slice(0, count);
}

export const formatClock = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

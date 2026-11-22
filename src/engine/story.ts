import { heroById, heroName } from "../data/heroes";
import type { Session, Snapshot } from "../state/session";

export interface StoryPlayer {
  heroId: number;
  side: "me" | "ally" | "enemy";
  gold?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  /** Gold gained since the earlier snapshot we compare against. */
  gain?: number;
}

export interface MatchStory {
  /** Combined gold of each team at the latest scoreboard, when enough rows were readable. */
  teamGold?: { mine: number; theirs: number; lead: number };
  /** How the lead has moved since the comparison point (positive = better for the player's team). */
  leadChange?: number;
  /** Minutes between the comparison point and now. */
  overMinutes?: number;
  /** Everyone, richest first. */
  players: StoryPlayer[];
  /** Plain sentences for the screen, most important first. */
  lines: string[];
  /** One line worth saying out loud, with a key that changes only when the situation does. */
  headline?: { key: string; say: string };
  /** How many scoreboards this match's memory holds. */
  readings: number;
}

const k = (n: number) => (Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}k` : String(Math.abs(Math.round(n))));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The snapshot to compare against: the most recent one at least `minGapSec` older than the latest. */
function earlier(history: Snapshot[], minGapSec: number): Snapshot | undefined {
  const latest = history.at(-1);
  if (!latest) return undefined;
  for (let i = history.length - 2; i >= 0; i--) {
    if (latest.at - history[i]!.at >= minGapSec) return history[i];
  }
  return undefined;
}

/**
 * What the match's memory says: who is ahead, who is growing, who is struggling,
 * and where the player stands. Built only from numbers printed on the scoreboard
 * (gold and kills / deaths / assists), compared across readings.
 */
export function matchStory(s: Session): MatchStory | undefined {
  const latest = s.history.at(-1);
  if (!latest || !s.myHeroId) return undefined;
  const before = earlier(s.history, 90);
  const me = s.myHeroId;
  const sideOf = (id: number): StoryPlayer["side"] | undefined => (id === me ? "me" : s.allies.includes(id) ? "ally" : s.enemies.includes(id) ? "enemy" : undefined);

  const players: StoryPlayer[] = [];
  for (const [idText, now] of Object.entries(latest.players)) {
    const heroId = Number(idText);
    const side = sideOf(heroId);
    if (!side || !heroById(heroId)) continue;
    const was = before?.players[heroId];
    players.push({ heroId, side, ...now, gain: now.gold !== undefined && was?.gold !== undefined ? now.gold - was.gold : undefined });
  }
  players.sort((a, b) => (b.gold ?? -1) - (a.gold ?? -1));

  const mine = players.filter((p) => p.side !== "enemy");
  const theirs = players.filter((p) => p.side === "enemy");
  const golds = (ps: StoryPlayer[]) => ps.map((p) => p.gold).filter((g): g is number => g !== undefined);
  const lines: string[] = [];
  const story: MatchStory = { players, lines, readings: s.history.length };

  // Team gold: only trust it when most of both teams were readable.
  let state: "ahead" | "behind" | "even" | undefined;
  if (golds(mine).length >= 4 && golds(theirs).length >= 4) {
    const a = sum(golds(mine));
    const b = sum(golds(theirs));
    const lead = a - b;
    story.teamGold = { mine: a, theirs: b, lead };
    const close = Math.abs(lead) < Math.max(500, (a + b) * 0.04);
    state = close ? "even" : lead > 0 ? "ahead" : "behind";
    let moving = "";
    if (before) {
      const wasMine = sum(mine.map((p) => before.players[p.heroId]?.gold ?? NaN));
      const wasTheirs = sum(theirs.map((p) => before.players[p.heroId]?.gold ?? NaN));
      if (Number.isFinite(wasMine) && Number.isFinite(wasTheirs)) {
        story.leadChange = lead - (wasMine - wasTheirs);
        story.overMinutes = Math.max(1, Math.round((latest.at - before.at) / 60));
        const span = `in the last ${story.overMinutes} minute${story.overMinutes === 1 ? "" : "s"}`;
        if (story.leadChange >= 400) moving = ` You gained ${k(story.leadChange)} on them ${span}.`;
        else if (story.leadChange <= -400) moving = ` They gained ${k(story.leadChange)} on you ${span}.`;
      }
    }
    lines.push(
      (state === "even" ? "The teams are about even on gold." : `Your team is ${state} by ${k(lead)} gold.`) + moving,
    );
  }

  // Where the player stands on their own team.
  const self = players.find((p) => p.side === "me");
  let selfState = "";
  if (self) {
    const rank = mine.filter((p) => (p.gold ?? 0) > (self.gold ?? 0)).length + 1;
    if ((self.deaths ?? 0) >= 3 && (self.deaths ?? 0) > (self.kills ?? 0)) {
      selfState = "dying";
      lines.push(`You have died ${self.deaths} times. Stay behind your tank and near your turrets until your next item.`);
    } else if (self.gold !== undefined && mine.length >= 4 && rank === 1) {
      selfState = "carry";
      lines.push("You have the most gold on your team. You are the carry now — staying alive matters more than one more kill.");
    } else if (self.gold !== undefined && mine.length >= 4 && rank >= 4) {
      selfState = "poor";
      lines.push("You are low on gold for your team. Clear minion waves and jungle camps before you join fights.");
    }
  }

  // Teammates: who to stand next to, who not to follow.
  const allies = mine.filter((p) => p.side === "ally");
  const strong = allies.find((p) => p.gold !== undefined && (p.kills ?? 0) >= (p.deaths ?? 0) && (p.kills ?? 0) + (p.assists ?? 0) >= 2);
  if (strong) lines.push(`${heroName(strong.heroId)} is your strongest teammate (${strong.kills}/${strong.deaths}/${strong.assists}). Fight near them.`);
  const weak = allies.find((p) => (p.deaths ?? 0) >= 3 && (p.deaths ?? 0) >= (p.kills ?? 0) + 2);
  if (weak && weak !== strong) lines.push(`${heroName(weak.heroId)} is struggling (${weak.kills}/${weak.deaths}/${weak.assists}). Don't follow them into a fight alone.`);

  // Enemies: the richest one, and anyone growing unusually fast.
  const top = theirs[0];
  if (top?.gold !== undefined && theirs.length >= 3) {
    const rest = golds(theirs.slice(1));
    const avg = rest.length ? sum(rest) / rest.length : 0;
    if (top.gold - avg >= 600) lines.push(`${heroName(top.heroId)} is their richest hero (${top.kills ?? "?"}/${top.deaths ?? "?"}/${top.assists ?? "?"}) — the one to watch.`);
  }
  const gains = theirs.filter((p) => p.gain !== undefined);
  if (gains.length >= 3) {
    const fastest = [...gains].sort((a, b) => b.gain! - a.gain!)[0]!;
    const others = gains.filter((p) => p !== fastest);
    const avgGain = sum(others.map((p) => p.gain!)) / others.length;
    if (fastest.gain! >= 600 && fastest.gain! >= avgGain * 1.4 && fastest !== top) {
      lines.push(`${heroName(fastest.heroId)} is growing fastest on their team (+${k(fastest.gain!)} gold recently).`);
    }
  }

  if (!before && s.history.length === 1) lines.push("This is the first scoreboard I have seen. Open it again in a couple of minutes and I can tell you who is pulling ahead.");

  // Speak only when the picture changes: team state or the player's own state.
  const spoken = [lines.find((l) => /^Your team is|^The teams are/.test(l)), lines.find((l) => /^You (have|are)/.test(l))].filter(Boolean) as string[];
  if (spoken.length && (state || selfState)) story.headline = { key: `story:${state ?? "-"}:${selfState || "-"}`, say: spoken.join(" ") };
  return story;
}

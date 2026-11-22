/**
 * "Help me position": the player asks by voice, the phone sends a screenshot of
 * the fight around them, then one with the map opened, and a model says where to
 * stand or go. It is told to describe only what it can actually see.
 */
import { heroById, heroName } from "../data/heroes";
import { gameSeconds, type Session } from "../state/session";
import type { PositionAdvice } from "../types";

export const POSITION_SYSTEM = `You are a positioning coach for a NEW player of Mobile Legends: Bang Bang. You are given one or two screenshots taken seconds apart: the battlefield around the player's hero, and the same moment with the map opened large (if only one picture arrives, use its small map in the corner). You are also told who is in the match. Say where the player should stand or go right now.

Reading the pictures
- The player's hero is the one the camera is centred on. Teammates have health bars in the player's team colour; enemies have red health bars.
- On the map, each visible hero is a round portrait. Work out which side is the player's from their own position and their team's portraits. Turrets, the river and the three lanes are fixed landmarks; the turtle and the lord sit in the river.
- An enemy who is not on the map is missing, and could be anywhere nearby.
- Describe only what you can actually see. If the map is not open or is unreadable, say so and base the advice on the battlefield picture alone. Never invent positions.

What good positioning means for a new player
- Stay where teammates can reach you. Alone, far past your own turrets, with enemies missing, is the most common way to die.
- A fragile damage dealer (marksman, mage) stands behind the tank or fighter, at the edge of their own range, and backs off when a diving enemy disappears from the map.
- A tank or fighter stands between the enemy and their damage dealers.
- When ahead and grouped: take the nearest turret, the turtle (early) or the lord (later). When behind or outnumbered: clear minion waves near your own turrets and wait for the team.

Answer fields
- map_open: true if a large opened map is visible in one of the pictures.
- where: one sentence on where the player is (lane or jungle, how far forward, who is next to them).
- enemies_seen: one sentence on which enemies are visible and where, and how many are missing.
- risk: low, medium or high for the player's current spot.
- say: the advice to read aloud, at most 30 words: where to go or stand and why.
- moves: up to three short steps in order.`;

export const POSITION_SCHEMA = {
  type: "object",
  properties: {
    map_open: { type: "boolean" },
    where: { type: "string" },
    enemies_seen: { type: "string" },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    say: { type: "string" },
    moves: { type: "array", items: { type: "string" } },
  },
  required: ["map_open", "where", "enemies_seen", "risk", "say", "moves"],
  additionalProperties: false,
} as const;

/** What each attached picture is, in order. */
export type PositionPicture = { kind: "battlefield" } | { kind: "map"; agoSec?: number };

/** Who is in the match, so the model can put names to the portraits, and what the pictures are. */
export function positionBrief(s: Session, now: number, pictures: PositionPicture[]): string {
  const lines: string[] = [];
  const hero = s.myHeroId ? heroById(s.myHeroId) : undefined;
  const sec = gameSeconds(s, now);
  if (hero) lines.push(`The player is ${hero.name} (${hero.roles.join("/")})${s.lane ? `, ${s.lane} lane` : ""}.`);
  if (sec !== undefined) lines.push(`Match clock: about ${Math.floor(sec / 60)} minutes in.`);
  if (s.allies.length) lines.push(`Teammates: ${s.allies.filter((id) => id !== s.myHeroId).map(heroName).join(", ")}.`);
  if (s.enemies.length) {
    const line = s.enemies.map((id) => {
      const p = s.enemyLive[id];
      return `${heroName(id)}${p?.kills !== undefined ? ` (${p.kills}/${p.deaths ?? "?"}/${p.assists ?? "?"})` : ""}`;
    });
    lines.push(`Enemies: ${line.join(", ")}.`);
  }
  const scenes = (s.scenes ?? []).slice(-4);
  if (scenes.length) lines.push("Where the player has been over the last minute, oldest first (read from earlier frames; hints, not facts):", ...scenes.map((x) => `- ${x.text}`));
  pictures.forEach((p, i) => {
    if (p.kind === "battlefield") lines.push(`Picture ${i + 1}: the battlefield around the player, now.`);
    else lines.push(`Picture ${i + 1}: the map opened large${p.agoSec && p.agoSec > 5 ? `, taken about ${Math.round(p.agoSec)} seconds ago — positions on it may have changed` : ""}.`);
  });
  if (!pictures.some((p) => p.kind === "map")) lines.push("No opened map this time: use the small map in the corner of the battlefield picture.");
  lines.push("Where should the player stand or go right now?");
  return lines.join("\n");
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function normalizePosition(raw: unknown, model: string, now: number): PositionAdvice | undefined {
  const r = (raw ?? {}) as Record<string, unknown>;
  const say = text(r.say, 260);
  if (!say) return undefined;
  const where = text(r.where, 200);
  const seen = text(r.enemies_seen, 200);
  const risk = r.risk === "high" || r.risk === "medium" ? r.risk : "low";
  const mapNote = r.map_open === false ? " (The map was not open, so this is from the battlefield view only.)" : "";
  return {
    at: now,
    summary: [where, seen].filter(Boolean).join(" ") + mapNote,
    risk,
    danger: risk === "low" ? undefined : `${risk === "high" ? "High" : "Some"} risk where you are standing.`,
    moves: (Array.isArray(r.moves) ? r.moves : []).map((x) => text(x, 140)).filter(Boolean).slice(0, 3),
    say,
    model,
  };
}

/** Canned answer for the demo reader. */
export const demoPosition = (): Record<string, unknown> => ({
  map_open: true,
  where: "You are in the middle lane, just past the river.",
  enemies_seen: "Two enemies are visible in the top lane; three are missing.",
  risk: "medium",
  say: "Three enemies are missing. Step back to your turret and wait for your tank before pushing.",
  moves: ["Walk back to your turret.", "Clear the minion wave from there.", "Push again when you can see three enemies on the map."],
});

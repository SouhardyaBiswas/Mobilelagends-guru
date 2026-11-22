/**
 * The AI coach: a strong model that decides what to buy and do next.
 *
 * The screenshot reader only transcribes the screen. This step gets the whole
 * match as text — both teams with their numbers, what the player owns and has
 * spent, the rule engine's own plan, the storyboard so far — and answers with a
 * build order, the calls for the next two minutes and one storyboard line.
 * Everything it names is checked against the catalog before it is used.
 */
import { suitableItems, templateFor } from "../data/builds";
import { findHero, heroById, heroName } from "../data/heroes";
import { findItem, itemById, ITEMS, SHOP_TAB } from "../data/items";
import { planBuild } from "../engine/build";
import { matchStory } from "../engine/story";
import { guessLaneOpponent, skillsOf } from "../engine/tips";
import { buildInputs, gameSeconds, stageOf, STAGE_LABEL, type Session } from "../state/session";
import type { AiAdvice, AiBuild, Hero, PlayerState, StoryBeat } from "../types";

export const COACH_SYSTEM = `You are the in-match coach for a NEW player of Mobile Legends: Bang Bang. Another step has already read the player's screenshots; you receive the match state as text. Decide what the player should buy and do next. Your answer is shown on a dashboard they glance at mid-fight and is read aloud, so every line is short, concrete and in plain words. Name heroes and items. Do not give advice that would be true in any match.

How to decide
- Judge who is dangerous from kills, deaths and gold in THIS match, not from a hero's reputation. An enemy well ahead on gold or kills is fed: build and play around that one.
- Purchase order matters more than the final build. Put first what helps most in the next few minutes: the player's main damage item, or a defensive answer when they keep dying to one fed enemy.
- Counters. Anti-heal (Sea Halberd, Glowing Wand or Dominance Ice) only when enemy healing or shields are a real part of their team. Physical defense against a fed physical hero, magic defense against a fed magic hero. Penetration when they stack armor or magic resistance. A carry (marksman, mage, assassin) takes at most two defensive items.
- Build only from the items listed under ITEMS THAT SUIT the player. The rest of the catalog is for other roles: a marksman never takes a tank's or a support's item, and roam or jungle boots blessings are only for those lanes. Do not name off-role items anywhere in your answer.
- One pair of boots. Never repeat an item. Never drop an item the player already owns: owned items stay at the front of the build in the same order, followed by the item they are part-way through buying.
- When two items are about equally good, prefer the one from the player's in-game list: that is one tap for them to buy.
- Item lists seen on other heroes come from tiny icons and are often wrong. Do not rely on them.
- If the state is too thin to decide (no scoreboard read yet), say what you need in the headline and keep the current plan.

Use only item names from the ITEM CATALOG below, spelled exactly. Use only hero names that appear in the match state.

Answer fields
- situation: whether the player's team is ahead, even or behind.
- headline: the single most important thing right now, at most 12 words.
- do_now: one to three short instructions for the next two minutes (where to be, who to stay with, what to take: turtle, lord, a turret, farm).
- avoid: one thing not to do right now, or "".
- focus_hero and focus_why: the enemy to kill first in a fight, or to stay away from, and why in under 15 words. "" when nobody stands out.
- build: the full six-item build in purchase order. Each entry has a reason under 14 words, written to the player ("Freya is 9/3 and dives you; this lets you survive her jump").
- story_beat: one line under 18 words recording what just changed in the match, with names and numbers, for the storyboard. story_tone: good, bad or neutral for the player.

ITEM CATALOG (name | price | shop tab | what it does)
${ITEMS.map((i) => `${i.name} | ${i.cost} | ${SHOP_TAB[i.category]} | ${i.blurb}`).join("\n")}`;

export const COACH_SCHEMA = {
  type: "object",
  properties: {
    situation: { type: "string", enum: ["ahead", "even", "behind"] },
    headline: { type: "string" },
    do_now: { type: "array", items: { type: "string" } },
    avoid: { type: "string" },
    focus_hero: { type: "string" },
    focus_why: { type: "string" },
    build: {
      type: "array",
      items: {
        type: "object",
        properties: { item: { type: "string" }, why: { type: "string" } },
        required: ["item", "why"],
        additionalProperties: false,
      },
    },
    story_beat: { type: "string" },
    story_tone: { type: "string", enum: ["good", "bad", "neutral"] },
  },
  required: ["situation", "headline", "do_now", "avoid", "focus_hero", "focus_why", "build", "story_beat", "story_tone"],
  additionalProperties: false,
} as const;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** What a hero brings to a fight, in a few plain words. */
function kit(hero: Hero): string {
  const t = hero.traits;
  const tags = [
    t.burst >= 0.5 && "burst damage",
    t.sustain >= 0.5 && "heals or lifesteal",
    t.shields >= 0.5 && "shields",
    t.cc >= 0.5 && "crowd control",
    t.mobility >= 0.5 && "dashes in",
    t.tanky >= 0.5 && "tanky",
    t.basicAttacker >= 0.5 && "basic attacks",
    t.crit && "crit",
    t.trueDamage && "true damage",
    t.maxHpDamage && "shreds tanks",
    t.conceal && "goes invisible",
    t.poke && "long-range poke",
  ].filter(Boolean);
  return `${hero.roles.join("/")}, ${hero.damage} damage${tags.length ? `; ${tags.join(", ")}` : ""}`;
}

const numbers = (p: PlayerState | undefined) =>
  p && (p.kills !== undefined || p.gold !== undefined) ? `${p.kills ?? "?"}/${p.deaths ?? "?"}/${p.assists ?? "?"}${p.gold !== undefined ? `, ${p.gold} gold` : ""}` : "no numbers yet";

/** The match as text for the coach. Returns undefined when there is not enough to coach on. */
export function coachBrief(s: Session, now: number): string | undefined {
  const hero = s.myHeroId ? heroById(s.myHeroId) : undefined;
  if (!hero || s.enemies.length < 3) return undefined;
  const sec = gameSeconds(s, now);
  const plan = planBuild({ hero, gold: s.gold, gameTimeSec: sec, ...buildInputs(s) });
  const me = s.allyLive[hero.id];
  const lines: string[] = [];

  lines.push(`Stage: ${STAGE_LABEL[stageOf(s)]}.${sec !== undefined ? ` Match clock ${clock(sec)}.` : ""}`);
  lines.push(
    `PLAYER: ${hero.name} — ${kit(hero)}.${s.lane ? ` Lane: ${s.lane}.` : ""} ${numbers(me)}.` +
      `${s.gold !== undefined ? ` Gold in pocket: ${s.gold}.` : ""}${s.spent !== undefined ? ` Spent so far: about ${s.spent}.` : ""}`,
  );
  const owned = plan.slots.filter((x) => x.owned).map((x) => x.item.name);
  const started = plan.slots.find((x) => !x.owned && x.paid);
  lines.push(`OWNS (from the inventory when it could be read, otherwise estimated from gold spent): ${owned.join(", ") || "nothing yet"}.` + (started ? ` Part-way through ${started.item.name} (${started.paid} of ${started.price} paid).` : ""));
  if (s.plannedBuild?.length) lines.push(`IN-GAME LIST (one tap to buy): ${s.plannedBuild.map((id) => itemById(id)?.name ?? id).join(", ")}.`);
  lines.push(`ITEMS THAT SUIT ${hero.name} (${templateFor(hero, s.lane).label}${s.lane ? `, ${s.lane} lane` : ""}): ${[...allowedItems(s, hero)].map((id) => itemById(id)?.name ?? id).join(", ")}.`);
  lines.push(`CURRENT PLAN: ${plan.slots.map((x, i) => `${i + 1}. ${x.item.name}${x.owned ? " (owned)" : ""}`).join("  ")}. Next step by the rules: ${plan.next.say}`);

  lines.push("TEAMMATES");
  for (const id of s.allies) {
    const h = heroById(id);
    if (h && id !== hero.id) lines.push(`- ${h.name} — ${kit(h)}. ${numbers(s.allyLive[id])}.`);
  }
  const laneId = s.laneOpponentId ?? guessLaneOpponent(s.lane, s.enemies);
  const fed = new Set(plan.threat.sources.filter((x) => x.fed).map((x) => x.heroId));
  lines.push("ENEMIES");
  for (const id of s.enemies) {
    const h = heroById(id);
    if (!h) continue;
    const skills = skillsOf(id).filter((k) => k.slot !== "Passive").slice(0, 3).map((k) => `${k.name}: ${k.text.slice(0, 110)}`);
    lines.push(`- ${h.name} — ${kit(h)}. ${numbers(s.enemyLive[id])}.${fed.has(id) ? " FED." : ""}${id === laneId ? " In the player's lane." : ""}${skills.length ? `\n  ${skills.join("\n  ")}` : ""}`);
  }
  lines.push(`ENEMY DAMAGE: about ${Math.round(plan.threat.physShare * 100)}% physical, ${Math.round(plan.threat.magicShare * 100)}% magic, weighted by who is ahead.`);

  const story = matchStory(s);
  if (story?.teamGold) lines.push(`TEAM GOLD: the player's team ${story.teamGold.mine}, enemy ${story.teamGold.theirs}.${story.leadChange !== undefined ? ` The lead moved by ${Math.round(story.leadChange)} over the last ${story.overMinutes} minute(s).` : ""}`);
  const beats = (s.story ?? []).slice(-6);
  if (beats.length) lines.push("STORY SO FAR", ...beats.map((b) => `- ${clock(b.at)} ${b.text}`));
  if (!s.history.length) lines.push("No scoreboard has been read yet this match: there are no kills or gold to go by.");
  lines.push("Decide the build order and the calls for the next two minutes.");
  return lines.join("\n");
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Items the coach may put in this player's build: what suits the hero, plus whatever they already own or their own in-game list holds. */
export function allowedItems(s: Session, hero: Hero): Set<string> {
  const out = suitableItems(hero, s.lane);
  for (const id of [...s.owned, ...(s.seenItems ?? []), ...(s.plannedBuild ?? [])]) if (!id.startsWith("comp:")) out.add(id);
  return out;
}

/** Catalog items a line of text names, by name or alias. */
function itemsNamedIn(line: string): string[] {
  const lower = line.toLowerCase();
  return ITEMS.filter((i) => [i.name, ...(i.aliases ?? [])].some((n) => lower.includes(n.toLowerCase()))).map((i) => i.id);
}

/**
 * Check the coach's answer against what the app knows before any of it is shown:
 * unknown items and heroes are dropped, items that do not suit the player's hero
 * are dropped, and what the player already owns stays at the front of the build
 * whatever the model said.
 */
export function normalizeCoach(raw: unknown, s: Session, model: string, now: number): { advice: AiAdvice; beat?: StoryBeat; build?: AiBuild } | undefined {
  const r = (raw ?? {}) as Record<string, unknown>;
  const hero = s.myHeroId ? heroById(s.myHeroId) : undefined;
  const allowed = hero ? allowedItems(s, hero) : undefined;
  // A line telling the player to buy an item that does not suit their hero is worse than no line.
  const onRole = (line: string) => !allowed || itemsNamedIn(line).every((id) => allowed.has(id));
  let headline = text(r.headline, 140);
  if (!headline) return undefined;
  const sec = gameSeconds(s, now);
  const situation = r.situation === "ahead" || r.situation === "behind" ? r.situation : "even";
  const doNow = (Array.isArray(r.do_now) ? r.do_now : []).map((x) => text(x, 160)).filter((line) => line && onRole(line)).slice(0, 3);
  const avoid = text(r.avoid, 160);
  if (!onRole(headline)) headline = doNow[0] ?? "";
  if (!headline) return undefined;
  const advice: AiAdvice = { at: now, clock: sec, model, situation, headline, doNow, avoid: (onRole(avoid) && avoid) || undefined };

  const focus = findHero(text(r.focus_hero, 40));
  if (focus && s.enemies.includes(focus.id)) advice.focus = { heroId: focus.id, why: text(r.focus_why, 160) };

  // The build: catalog items only, no repeats, one pair of boots.
  const ids: string[] = [];
  const why: Record<string, string> = {};
  for (const entry of Array.isArray(r.build) ? (r.build as Array<{ item?: unknown; why?: unknown }>) : []) {
    const found = findItem(text(entry?.item, 60));
    const item = found && !found.id.startsWith("comp:") ? itemById(found.id) : undefined;
    if (!item || ids.includes(item.id)) continue;
    if (allowed && !allowed.has(item.id)) continue;
    if (item.category === "boots" && ids.some((id) => itemById(id)?.category === "boots")) continue;
    ids.push(item.id);
    why[item.id] = text(entry?.why, 160);
  }
  let build: AiBuild | undefined;
  if (hero && ids.length >= 3) {
    // What the player holds comes first, in the order they hold it; then the item they are part-way through.
    const plan = planBuild({ hero, gold: s.gold, gameTimeSec: sec, ...buildInputs(s), aiBuild: undefined });
    const holding = plan.slots.filter((x) => x.owned || x.paid);
    const held = holding.map((x) => x.item);
    // An item the player already has was not "chosen by the coach": it keeps its own reason unless the coach gave one.
    for (const x of holding) if (!why[x.item.id]) why[x.item.id] = x.owned ? "Already yours." : x.reason;
    const hasBoots = held.some((i) => i.category === "boots");
    const rest = ids.filter((id) => !held.some((i) => i.id === id) && !(hasBoots && itemById(id)?.category === "boots"));
    build = { ids: [...held.map((i) => i.id), ...rest].slice(0, 6), why };
    const next = build.ids.find((id) => !plan.slots.some((x) => x.owned && x.item.id === id));
    if (next) advice.item = { id: next, why: why[next] || "" };
  }

  const line = text(r.story_beat, 180);
  const beat: StoryBeat | undefined = line && sec !== undefined ? { at: s.history.at(-1)?.at ?? sec, text: line, tone: r.story_tone === "good" || r.story_tone === "bad" ? r.story_tone : "neutral" } : undefined;
  return { advice, beat, build };
}

/** A canned coach answer for the demo reader, so the whole flow can be tried with no key. */
export function demoCoach(s: Session): Record<string, unknown> {
  const hero = s.myHeroId ? heroById(s.myHeroId) : undefined;
  const plan = hero ? planBuild({ hero, gold: s.gold, ...buildInputs(s), aiBuild: undefined }) : undefined;
  const top = plan?.threat.sources[0];
  const fed = top?.fed ? heroName(top.heroId) : "";
  return {
    situation: "even",
    headline: fed ? `${fed} is fed. Stay with your team.` : "Farm your lane and take safe fights.",
    do_now: fed ? [`Stay behind your tank when ${fed} is near.`, "Clear the minion wave, then group."] : ["Clear minion waves for gold.", "Join your team for the turtle."],
    avoid: fed ? `Do not face ${fed} alone.` : "",
    focus_hero: top ? heroName(top.heroId) : "",
    focus_why: fed ? "Furthest ahead on their team." : "Their main damage dealer.",
    build: (plan?.slots ?? []).map((x) => ({ item: x.item.name, why: x.reason })),
    story_beat: fed ? `${fed} is pulling ahead.` : "A quiet start.",
    story_tone: fed ? "bad" : "neutral",
  };
}

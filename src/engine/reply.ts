import { heroById } from "../data/heroes";
import { componentId, itemIcon } from "../data/items";
import { buildInputs, type Session } from "../state/session";
import type { Observation } from "../types";
import { planBuild } from "./build";
import { buyAdvice, fedAdvice } from "./coach";
import { rankCounters } from "./draft";
import { matchStory } from "./story";
import { briefOn, gamePlan, guessLaneOpponent } from "./tips";

/** What the iPad shortcut gets back: a banner (title + body + picture) and a line to speak. */
export interface CoachReply {
  title: string;
  body: string;
  say: string;
  /** Absolute URL of a picture for the banner (item or hero), when there is one. */
  icon?: string;
  screen: Observation["screen"];
}

/**
 * Turn the session after a screenshot read into one short answer.
 * `called` remembers which fed enemies were already announced this match.
 */
export function coachReply(session: Session, obs: Observation, called: Set<number>, origin: string): CoachReply {
  const { screen } = obs;
  const hero = session.myHeroId ? heroById(session.myHeroId) : undefined;
  const picture = (path: string | undefined) => (path ? `${origin}/${path}` : undefined);

  const preMatch = screen === "draft" || screen === "loading";
  // Draft: the player hasn't locked a hero yet — suggest picks against what is visible.
  if (!hero && preMatch && session.enemies.length) {
    const laneOpponent = guessLaneOpponent(session.lane, session.enemies);
    const picks = rankCounters({ enemies: session.enemies, allies: session.allies, banned: session.banned, lane: session.lane, laneOpponent, limit: 3 });
    const names = picks.map((p) => p.hero.name);
    const top = picks[0];
    return {
      title: `Pick: ${names.join(", ")}`,
      body: top ? `${top.hero.name}: ${top.reasons[0] ?? ""}` : "",
      say: `Best picks here: ${names.join(", ")}.`,
      icon: top?.hero.icon || undefined,
      screen,
    };
  }
  if (!hero) {
    if (screen === "draft") {
      const say = "No enemy picks yet. Take the hero you play best; I'll suggest counters once the enemy picks show.";
      return { title: "Hero selection", body: say, say, screen };
    }
    const say = "I can't see which hero is yours yet. Open the scoreboard and tap again.";
    return { title: "Can't see your hero yet", body: say, say, screen };
  }
  if (!session.enemies.length) {
    if (preMatch) {
      const say = `You're on ${hero.name}. I'll give you the lane plan as soon as the enemy picks show.`;
      return { title: `You: ${hero.name}`, body: say, say, icon: hero.icon || undefined, screen };
    }
    const say = "Open the scoreboard once so I can see the enemy team, then tap again.";
    return { title: "Open the scoreboard", body: say, say, screen };
  }

  const plan = planBuild({ hero, gold: session.gold, ...buildInputs(session) });
  const n = plan.next;
  const spoken: string[] = [];
  for (const alert of fedAdvice(plan.threat, called)) {
    called.add(Number(alert.key.split(":")[1]));
    spoken.push(alert.say);
  }
  // Pre-match screens: lead with how to play the lane instead of a purchase.
  if (screen === "loading" || screen === "draft") {
    const laneId = session.laneOpponentId ?? guessLaneOpponent(session.lane, session.enemies);
    const lane = laneId ? heroById(laneId) : undefined;
    if (lane) {
      const brief = briefOn(lane, hero);
      const tip = brief.how[0] ?? brief.summary;
      return { title: `Your lane: ${lane.name}`, body: `${brief.summary} ${tip}`, say: `You face ${lane.name} in lane. ${tip} Battle spell: ${plan.spell.name}.`, icon: lane.icon || undefined, screen };
    }
  }
  spoken.push(buyAdvice(plan).say);
  const target = n.action === "buy-component" || (n.action === "save" && n.component) ? n.component : n.item;
  const iconId = target && target === n.component ? componentId(target.name) : n.item?.id;
  const gold = session.gold !== undefined ? ` You have ${session.gold} gold.` : "";
  return {
    title: n.say,
    body: [n.detail, n.where, gold.trim()].filter(Boolean).join(" "),
    say: spoken.join(" "),
    icon: picture(iconId ? itemIcon(iconId) : undefined),
    screen,
  };
}

/** Questions a voice command can ask without sending a screenshot. */
export const ASK_TOPICS = ["buy", "status", "lane", "plan", "picks", "threat"] as const;
export type AskTopic = (typeof ASK_TOPICS)[number];

/**
 * Answer a spoken question from what the room already knows. No screenshot and
 * no AI call: it reads the match state built up from earlier screenshots, so it
 * is instant and free.
 */
export function answerQuestion(session: Session, topic: AskTopic): { title: string; say: string } {
  const hero = session.myHeroId ? heroById(session.myHeroId) : undefined;
  const needBoard = "I haven't seen your scoreboard yet. Open it and send a screenshot first.";

  if (topic === "picks") {
    if (!session.enemies.length) return { title: "Hero pick", say: "I can't see any enemy picks yet. Take the hero you play best." };
    const laneOpponent = guessLaneOpponent(session.lane, session.enemies);
    const picks = rankCounters({ enemies: session.enemies, allies: session.allies, banned: session.banned, lane: session.lane, laneOpponent, limit: 3 });
    const top = picks[0];
    return { title: "Hero pick", say: `Best picks here: ${picks.map((p) => p.hero.name).join(", ")}.${top ? ` ${top.hero.name}: ${top.reasons[0] ?? ""}` : ""}` };
  }
  if (!hero) return { title: "No match yet", say: needBoard };
  if (!session.enemies.length) return { title: "No enemies yet", say: needBoard };

  const plan = planBuild({ hero, gold: session.gold, ...buildInputs(session) });
  const laneId = session.laneOpponentId ?? guessLaneOpponent(session.lane, session.enemies);

  switch (topic) {
    case "buy":
      return { title: "Next item", say: buyAdvice(plan).say };
    case "status": {
      const story = matchStory(session);
      return { title: "Match so far", say: story?.lines.slice(0, 3).join(" ") || "I need a scoreboard screenshot to tell you how the match is going." };
    }
    case "lane": {
      const lane = laneId ? heroById(laneId) : undefined;
      if (!lane) return { title: "Your lane", say: "I don't know who is in your lane yet. Tap them on the phone under Who is in your lane." };
      const brief = briefOn(lane, hero);
      return { title: `Your lane: ${lane.name}`, say: `You face ${lane.name}. ${brief.summary} ${brief.how.slice(0, 2).join(" ")}` };
    }
    case "plan":
      return { title: "Game plan", say: gamePlan(hero, session.enemies, plan.threat, laneId).slice(0, 3).join(" ") };
    case "threat": {
      const top = plan.threat.sources[0];
      const enemy = top ? heroById(top.heroId) : undefined;
      if (!enemy) return { title: "Biggest threat", say: needBoard };
      const brief = briefOn(enemy, hero);
      return { title: `Watch ${enemy.name}`, say: `${enemy.name} is their biggest threat${top!.fed ? " and is fed" : ""}. ${brief.how[0] ?? brief.summary}` };
    }
  }
}

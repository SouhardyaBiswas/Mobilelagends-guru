import { heroById } from "../data/heroes";
import { componentId, itemIcon } from "../data/items";
import { enemyStates, type Session } from "../state/session";
import type { Observation } from "../types";
import { planBuild } from "./build";
import { buyAdvice, fedAdvice } from "./coach";
import { rankCounters } from "./draft";
import { briefOn, guessLaneOpponent } from "./tips";

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

  // Draft: the player hasn't locked a hero yet — suggest picks against what is visible.
  if (!hero && (screen === "draft" || screen === "loading") && session.enemies.length) {
    const laneOpponent = guessLaneOpponent(session.lane, session.enemies);
    const picks = rankCounters({ enemies: session.enemies, allies: session.allies, lane: session.lane, laneOpponent, limit: 3 });
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
    const say = screen === "draft" ? "Pick the hero you play best. I'll suggest counters once the enemy picks show." : "I can't see which hero is yours yet. Open the scoreboard and tap again.";
    return { title: "Can't see your hero yet", body: say, say, screen };
  }
  if (!session.enemies.length) {
    const say = "Open the scoreboard once so I can see the enemy team, then tap again.";
    return { title: "Open the scoreboard", body: say, say, screen };
  }

  const plan = planBuild({
    hero,
    lane: session.lane,
    enemies: enemyStates(session),
    owned: session.owned,
    gold: session.gold,
    plannedBuild: session.plannedBuild,
    shopListed: session.shopListed,
    priceFactor: session.priceFactor,
  });
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

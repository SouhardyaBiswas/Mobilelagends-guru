import { heroById } from "../data/heroes";
import type { Advice, BuildPlan, CounterPick, Hero, ThreatProfile } from "../types";

/** First sentence only — spoken lines must be short enough to hear mid-fight. */
const firstSentence = (text: string): string => {
  const cut = text.search(/[.!?](\s|$)/);
  return cut > 0 ? text.slice(0, cut + 1) : text;
};

/** The one thing to do with your gold right now. */
export function buyAdvice(plan: BuildPlan): Advice {
  const n = plan.next;
  const key = ["buy", n.action, n.item?.id ?? "-", n.component?.name ?? "-", n.sell?.id ?? "-"].join(":");
  // "Save N gold" changes every time gold does; the key ignores the amount so it is said once.
  const withReason = n.action === "buy" || n.action === "sell-swap" || n.action === "buy-component";
  const reason = withReason && n.detail ? ` ${firstSentence(n.detail)}` : "";
  return { key, say: `${n.say}${n.action === "buy-component" ? "" : reason}`, detail: n.detail, kind: "buy", priority: n.action === "save" ? 0 : 1 };
}

/** Spoken once when the match starts. */
export function setupAdvice(hero: Hero, plan: BuildPlan): Advice {
  const parts = [`Playing ${hero.name}.`, `Battle spell: ${plan.spell.name}.`, `Emblem: ${plan.emblem.name}.`];
  return { key: `setup:${hero.id}:${plan.spell.name}`, say: parts.filter(Boolean).join(" "), detail: plan.spell.reason, kind: "setup", priority: 1 };
}

/** Call-outs for enemies who have pulled ahead since we last looked. */
export function fedAdvice(threat: ThreatProfile, alreadyCalled: ReadonlySet<number>): Advice[] {
  return threat.sources
    .filter((s) => s.fed && !alreadyCalled.has(s.heroId))
    .map((s) => {
      const hero = heroById(s.heroId)!;
      const dmg = hero.damage === "mixed" ? "mixed" : hero.damage;
      const style = hero.traits.burst >= 0.7 ? "burst" : hero.traits.basicAttacker >= 0.55 ? "basic-attack" : "";
      return {
        key: `fed:${s.heroId}`,
        say: `${hero.name} is fed. ${dmg[0]!.toUpperCase()}${dmg.slice(1)} ${style} damage — I'm adjusting your build.`.replace(/\s+/g, " "),
        detail: `${hero.name} now carries about ${Math.round(s.weight * 100)}% of the enemy team's kill pressure.`,
        kind: "threat" as const,
        priority: 2 as const,
      };
    });
}

export function counterAdvice(picks: CounterPick[]): Advice | undefined {
  const top = picks.slice(0, 3).map((p) => p.hero.name);
  if (!top.length) return undefined;
  const names = top.length > 1 ? `${top.slice(0, -1).join(", ")} or ${top.at(-1)}` : top[0];
  return { key: `counter:${top.join(",")}`, say: `Best picks here: ${names}.`, kind: "info", priority: 1 };
}

/** Remembers what was said so the coach never nags. */
export class SpokenLog {
  private said = new Map<string, number>();
  /** True if this advice should be spoken now (and records it). */
  shouldSay(advice: Advice, now: number, repeatAfterMs = Infinity): boolean {
    const last = this.said.get(advice.key);
    if (last !== undefined && now - last < repeatAfterMs) return false;
    this.said.set(advice.key, now);
    return true;
  }
  clear(): void {
    this.said.clear();
  }
}

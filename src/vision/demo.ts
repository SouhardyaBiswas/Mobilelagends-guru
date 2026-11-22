import { heroById, HEROES } from "../data/heroes";
import type { VisionCall, VisionReply } from "./types";

/**
 * Canned "vision" for trying the whole flow with no API key and no game running.
 * Each call advances a scripted match: loading screen → early scoreboard →
 * a later scoreboard where one enemy has snowballed.
 */
const DEFAULT_ALLIES = ["Layla", "Tigreal", "Eudora", "Hayabusa", "Yu Zhong"];
const DEFAULT_ENEMIES = ["Estes", "Uranus", "Gusion", "Karrie", "Esmeralda"];

const id = (name: string) => HEROES.find((h) => h.name === name)?.id;
const names = (ids: number[], fallback: string[]) =>
  ids.length >= 3 ? ids.map((i) => heroById(i)?.name ?? "") : fallback;

export function demoVision(): VisionCall {
  let step = 0;
  return async (_image, ctx): Promise<VisionReply> => {
    await new Promise((r) => setTimeout(r, 500));
    const allyNames = names(ctx.allies.length ? [...new Set([ctx.myHeroId ?? ctx.allies[0]!, ...ctx.allies])] : [], DEFAULT_ALLIES);
    const enemyNames = names(ctx.enemies, DEFAULT_ENEMIES);
    const me = ctx.myHeroId ? heroById(ctx.myHeroId)?.name : allyNames[0];
    // On the server several copies answer for one room, so the place in the script comes from the room, not from this copy.
    const forced = { loading: 0, early: 1, late: 2 }[ctx.force ?? ""];
    const s = forced ?? (ctx.step ?? step++) % 3;

    const row = (hero: string, k: number, d: number, a: number, gold: number, items: string[] = []) => ({
      hero,
      isMe: hero === me,
      kills: k,
      deaths: d,
      assists: a,
      gold,
      level: -1,
      items,
    });

    // A test can ask for a particular kind of screen instead of the next one in the script.
    if (ctx.force === "gameplay" || ctx.force === "map") {
      return {
        raw: {
          screen: ctx.force, gameTime: "04:00", myGold: 900, allies: [], enemies: [], tip: "",
          scene: ctx.force === "map" ? "You are in the middle lane near the river; two enemies show in the top lane." : "You are in the middle lane next to Tigreal; no enemy in view.",
        },
        model: "demo",
      };
    }
    if (ctx.force === "other" || ctx.force === "post_game") {
      return { raw: { screen: ctx.force, gameTime: "", myGold: -1, allies: [], enemies: [], tip: "" }, model: "demo" };
    }
    if (s === 0) {
      return {
        raw: {
          screen: "loading",
          gameTime: "",
          myGold: -1,
          allies: allyNames.map((h) => row(h, -1, -1, -1, -1)),
          enemies: enemyNames.map((h) => row(h, -1, -1, -1, -1)),
          tip: "",
        },
        model: "demo",
      };
    }
    const late = s === 2;
    // The third enemy snowballs in the late snapshot.
    const fed = enemyNames[2] ?? enemyNames[0]!;
    return {
      raw: {
        screen: "scoreboard",
        gameTime: late ? "09:40" : "03:10",
        myGold: late ? 1450 : 620,
        allies: allyNames.map((h, i) => row(h, late ? 2 : 0, late ? 3 : 1, late ? 4 : 1, (late ? 4200 : 1500) - i * 90)),
        enemies: enemyNames.map((h) =>
          h === fed
            ? row(h, late ? 8 : 2, 0, late ? 3 : 0, late ? 6900 : 1900)
            : row(h, late ? 2 : 0, late ? 2 : 0, late ? 5 : 1, late ? 4100 : 1450),
        ),
        tip: late ? `${fed} is far ahead — group up and do not face them alone.` : "",
      },
      model: "demo",
    };
  };
}

export const demoRoster = () => ({
  allies: DEFAULT_ALLIES.map(id).filter((n): n is number => !!n),
  enemies: DEFAULT_ENEMIES.map(id).filter((n): n is number => !!n),
});

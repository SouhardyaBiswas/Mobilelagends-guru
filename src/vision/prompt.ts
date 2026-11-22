import { HEROES_BY_NAME, heroName } from "../data/heroes";
import { COMPONENTS, ITEMS } from "../data/items";

/** What the app already knows about the match — narrows the model's choices. */
export interface VisionContext {
  /** What the player says is happening right now, if they told us. */
  stage?: "draft" | "loading" | "live" | "done";
  myHeroId?: number;
  allies: number[];
  enemies: number[];
  /** How many screenshots this match has already seen. Only the scripted demo reader uses it, to know where in its script it is. */
  step?: number;
  /** Demo reader only: answer as this kind of screen instead of following the script. */
  force?: string;
}

/**
 * Stable system prompt (cache-friendly: nothing per-request in here).
 * The hero and item lists constrain names to what the app can act on.
 */
export const SYSTEM_PROMPT = `You read screenshots (or camera photos of a screen) from the mobile game Mobile Legends: Bang Bang and report what is on screen as JSON. A voice coach uses your answer to tell a new player what to pick and buy. For numbers and item icons, accuracy matters more than completeness: leave those empty rather than guess. Heroes on the draft screen are the exception — see "Draft heroes" below.

Classify the screen:
- "draft": hero selection, in any of its phases — the ban phase ("Ban", "Ally Team Ban", "Enemy Team Ban"), the pick phase ("Ally Team Pick" / "Enemy Team Pick"), usually with a countdown, a hero grid and a "Lock In" or "Confirm" button, and the moments after the player has locked in while they choose a skin, battle spell or emblem. The player's team is the left column, the enemy team the right column; each slot shows the player's name and, once a hero is picked, that hero's portrait. A slot still showing a silhouette, "Player 1"… or "Selecting" has no pick yet. The grid of selectable heroes in the middle is NOT picks — ignore it.
- "loading": the pre-match loading screen showing all ten heroes as large cards with hero names and player names.
- "scoreboard": the in-match panel with "Equipment" and "Attributes" tabs and a "VS" bar. The left half (blue) is the player's team, the right half (red) is the enemy team, five rows each. Every row prints the player name and, directly under it, the HERO NAME in smaller text — read the hero from that text. Each row also shows kills, deaths, assists, a gold figure, and up to six round item slots. Kills, deaths and assists are small numbers (rarely above 30); the gold figure has three to five digits. The enemy half is a mirror image of the player's half, so its columns run in the opposite order: on both halves decide what a number is by its size and its column, never by counting positions from the left. A row's gold must never end up in kills.
- "shop": the in-match equipment shop (tabs such as Recommended, Attack, Magic, Defense, Movement; a "Purchase" button).
- "gameplay": the live battlefield with no panel open.
- "map": the live battlefield with the map opened large (it covers a good part of the screen, far bigger than the small map in the corner).
- "post_game": the results screen after the match.
- "other": anything else, including the "Battle Setup" pop-up.

Who is the player: on the scoreboard the player's own row is the highlighted one (brighter blue background, usually the top-left row). Set isMe true for that row only. Put the player's team in "allies" and the other team in "enemies".

Draft heroes: on the draft screen the team slots usually show only portraits, with no hero name printed. Identify every picked hero from its portrait — you know what each hero in the HERO LIST looks like (face, hair, headgear, armour, colours, weapon). Report the hero you believe each portrait shows, using its exact name from the HERO LIST. A draft read is provisional: the loading screen prints every name and corrects it a minute later, so on the draft screen your best match is far more useful than an empty slot. Use "" only for a slot with no pick yet, or a portrait you truly cannot place. Numbers on the draft screen are -1 and item lists are empty.
- The player's own hero: the player's own slot in the left column is the highlighted one (a brighter or glowing frame, or the name in a different colour). When the screen shows one hero large in the middle or background with its name printed — the hero the player is choosing or has locked — that is the player's hero; when its name is printed, use that name. Put it in "allies" with isMe true.
- "banned": heroes shown as banned — small greyed-out or crossed-out portraits, usually in a row along the top or beside each team. Only on the draft screen; [] everywhere else.

Gold: during a match the player's current spendable gold is the figure in the top-right corner of the screen (for example "$1143"); the shop repeats it at the top-left. Report that as myGold. The gold figure inside each scoreboard row is that player's total earned gold — report it as the row's gold, never as myGold.

Match clock: the mm:ss timer at the top centre of the screen during a match (not the draft countdown).

Items: answer with names from the item list below.
- Scoreboard rows show item icons only: name each icon you can identify with confidence, in slot order, and skip the rest. A wrong item is worse than a missing one. Empty slots are empty.
- In the shop, "recommended" is the list of items printed with their names and prices in the main panel, in reading order (left to right, top to bottom), stopping at the "Spare Equipment" heading; "spare" is the items printed under that heading. Copy each name and its price exactly.
- In the shop, "myItems" is the row of six inventory slots along the bottom of the shop panel: the items the player currently owns. Black slots are empty. These icons are large: name every one. A slot holding a small piece of an item (not the finished item) is named as that piece if it is in the list, and skipped otherwise — never report the finished item for a piece.
- On the scoreboard, "myItems" is the item row of the player's own highlighted row.

Numbers: copy kills, deaths, assists, gold and level exactly as shown; use -1 when a number is not visible.

scene: on "gameplay" and "map" screens only, one plain sentence saying where the player's hero is (which lane, the river, the jungle or their base; pushed forward or near their own turret), which teammates are beside them, and which enemy heroes are in view or shown on the map. The player's hero is the one the camera is centred on. Say only what you can see; write "" if you cannot tell. Use "" on every other screen.

tip: one short, concrete coaching sentence based only on what is visible (who is ahead, an obvious item gap). Use "" if there is nothing useful to say. Do not recommend specific items in the tip; the app does that.

HERO LIST:
${HEROES_BY_NAME.map((h) => h.name).join(", ")}

ITEM LIST:
${[...ITEMS.map((i) => i.name), ...[...COMPONENTS.values()].map((c) => c.name)].join(", ")}`;

export function userPrompt(ctx: VisionContext): string {
  const lines: string[] = [];
  const stage = { draft: "hero selection (the draft)", loading: "the loading screen just before the match", live: "a match in progress", done: "" }[ctx.stage ?? "done"];
  if (stage) lines.push(`The player says the game is currently in ${stage}. Use that if the screen is ambiguous; trust the screen if it clearly shows something else.`);
  if (ctx.stage === "draft") lines.push("If this is the draft, name every picked hero from its portrait, and the player's own hero.");
  if (ctx.myHeroId) lines.push(`The player is playing ${heroName(ctx.myHeroId)}.`);
  if (ctx.allies.length) lines.push(`Known allies: ${ctx.allies.map(heroName).join(", ")}.`);
  if (ctx.enemies.length) lines.push(`Known enemies: ${ctx.enemies.map(heroName).join(", ")}.`);
  if (lines.length) lines.push("Use this roster to resolve anything unclear; where the screen prints different names, trust the screen.");
  lines.push("Report what this screen shows.");
  return lines.join("\n");
}

import { useCallback, useEffect, useMemo, useRef } from "react";
import { speaker } from "../audio/speech";
import { eventsBetween } from "../data/timeline";
import { buyAdvice, counterAdvice, fedAdvice, setupAdvice, SpokenLog } from "../engine/coach";
import { rankCounters } from "../engine/draft";
import { matchStory } from "../engine/story";
import { gamePlan } from "../engine/tips";
import { useStore } from "../state/store";
import type { Advice, BuildPlan, Hero, ThreatProfile } from "../types";

/** How long before the same line may be spoken again if it becomes relevant again. */
const REPEAT_MS = 45_000;

/**
 * Turns state changes into spoken advice. Everything here is edge-triggered:
 * a line is said when the recommendation changes, never on a timer, so the
 * coach stays quiet while nothing new is worth saying.
 */
export function useCoach(plan: (BuildPlan & { threat: ThreatProfile }) | undefined, hero: Hero | undefined, gameSec: number | undefined, laneOpponentId?: number) {
  const { state, dispatch } = useStore();
  const { session, settings } = state;
  const spoken = useRef(new SpokenLog());
  const fedCalled = useRef(new Set<number>());
  const prevSec = useRef<number | undefined>(undefined);
  const preSaid = useRef<string | undefined>(undefined);
  const live = session.phase === "live";

  useEffect(() => {
    speaker.settings = settings.speech;
    if (!settings.speech.enabled) speaker.stop();
  }, [settings.speech]);

  const say = useCallback(
    (advice: Advice, repeatAfter = REPEAT_MS) => {
      if (!spoken.current.shouldSay(advice, Date.now(), repeatAfter)) return;
      speaker.say(advice.say, advice.priority);
      dispatch({ type: "log", entry: { at: Date.now(), kind: "say", text: advice.say } });
    },
    [dispatch],
  );

  // New match: forget what was said last game.
  useEffect(() => {
    spoken.current.clear();
    fedCalled.current.clear();
    prevSec.current = undefined;
  }, [session.matchId]);

  // Match start: spell and emblem, once.
  const setupKey = live && hero && plan ? `${session.matchId}:${hero.id}` : undefined;
  useEffect(() => {
    if (!setupKey || !hero || !plan) return;
    say(setupAdvice(hero, plan), Infinity);
    // Then the two things most worth knowing before minions spawn: the lane, and who to kill.
    const lines = gamePlan(hero, session.enemies, plan.threat, laneOpponentId).slice(0, 2);
    // Skip the plan if it was already spoken before the match started (follow mode).
    if (session.enemies.length && lines.length && preSaid.current !== setupKey) say({ key: `plan:${setupKey}`, say: lines.join(" "), kind: "info", priority: 1 }, Infinity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupKey]);

  // Hero selection on a following device: call out the best picks as the enemy locks in.
  const following = settings.sync.follow;
  const draftKey = !live && following && !hero && session.enemies.length ? session.enemies.join(",") : undefined;
  useEffect(() => {
    if (!draftKey) return;
    const picks = rankCounters({ enemies: session.enemies, allies: session.allies, banned: session.banned, lane: session.lane, laneOpponent: laneOpponentId, limit: 3 });
    const advice = counterAdvice(picks);
    if (advice) say({ ...advice, key: `draft:${session.matchId}:${draftKey}` }, Infinity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Hero locked, match not started: how to play the lane, before the minions spawn.
  const preKey = !live && following && hero && plan && session.enemies.length >= 3 ? `${session.matchId}:${hero.id}:${session.enemies.join(",")}` : undefined;
  useEffect(() => {
    if (!preKey || !hero || !plan) return;
    const lines = gamePlan(hero, session.enemies, plan.threat, laneOpponentId).slice(0, 2);
    preSaid.current = `${session.matchId}:${hero.id}`;
    say({ key: `pre:${preKey}`, say: `Playing ${hero.name}. Battle spell: ${plan.spell.name}. ${lines.join(" ")}`, kind: "info", priority: 1 }, Infinity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preKey]);

  // Someone on their team pulled ahead.
  const threat = plan?.threat;
  useEffect(() => {
    if (!live || !threat) return;
    for (const advice of fedAdvice(threat, fedCalled.current)) {
      fedCalled.current.add(Number(advice.key.split(":")[1]));
      say(advice, Infinity);
    }
  }, [live, threat, say]);

  // The single next thing to do with your gold.
  const buy = live && plan ? buyAdvice(plan) : undefined;
  useEffect(() => {
    if (buy) say(buy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buy?.key]);

  // What the match's memory shows: say it when the picture changes (ahead / behind, carry / dying).
  const story = useMemo(() => (live ? matchStory(session) : undefined), [live, session]);
  const storyKey = story?.headline ? `${session.matchId}:${story.headline.key}` : undefined;
  useEffect(() => {
    if (story?.headline && storyKey) say({ key: storyKey, say: story.headline.say, kind: "info", priority: 1 }, Infinity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyKey]);

  // One-line observation from the screenshot reader.
  useEffect(() => {
    if (live && session.tip) say({ key: `tip:${session.tip}`, say: session.tip, kind: "tip", priority: 0 }, Infinity);
  }, [live, session.tip, say]);

  // Objective reminders off the match clock.
  useEffect(() => {
    if (!live || gameSec === undefined) return;
    const prev = prevSec.current;
    prevSec.current = gameSec;
    if (prev === undefined) return;
    for (const e of eventsBetween(prev, gameSec)) {
      say({ key: `timer:${e.id}`, say: e.say, kind: "timer", priority: 1 }, Infinity);
    }
  }, [live, gameSec, say]);

  /** Re-speak the current recommendation on demand. */
  return useCallback(() => {
    if (!buy) return;
    speaker.unlock();
    speaker.say(buy.say, 2);
  }, [buy]);
}

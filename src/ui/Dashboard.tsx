import { useEffect, useState, type ReactNode } from "react";
import { speaker } from "../audio/speech";
import { heroById } from "../data/heroes";
import { formatClock, upcoming } from "../data/timeline";
import { STAGE_LABEL, stageOf, useStore, type Stage } from "../state/store";
import { LANE_LABEL, type AiAdvice, type BuildPlan, type Hero, type PositionAdvice, type StoryBeat, type ThreatProfile } from "../types";
import { BuildList, SpellEmblem } from "./BuildList";
import { CounterList, LaneChips, MyHeroButton, useCounterPicks } from "./DraftTab";
import { Guide } from "./Guide";
import { HeroIcon, TeamRow, TeamStrip } from "./HeroBits";
import { NowCard, ReadsPanel, StoryPanel, ThreatPanel } from "./LiveTab";
import { SettingsTab } from "./SettingsTab";
import { SCREEN_LABEL, type RoomStatus } from "./useRoomSync";


type Plan = BuildPlan & { threat: ThreatProfile };

/** The dashboard replaces the tabs from this viewport width up (an iPad in landscape; not a phone, not an iPad in portrait). */
export const DASHBOARD_MIN_WIDTH = 900;
/** AI advice older than this is dimmed: the match has moved on. */
const AI_STALE_MS = 3 * 60_000;
/** A positioning answer is only about the fight it was asked for. */
const POSITION_FRESH_MS = 2 * 60_000;
const STAGES: readonly Stage[] = ["draft", "loading", "live", "done"];

/** True while the viewport is at least `minWidth` wide; follows rotation and resizing. */
export function useWideScreen(minWidth = DASHBOARD_MIN_WIDTH): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return wide;
}

export const agoText = (now: number, at?: number) => {
  if (!at) return "just now";
  const sec = Math.max(0, Math.round((now - at) / 1000));
  return sec < 5 ? "just now" : sec < 90 ? `${sec}s ago` : `${Math.round(sec / 60)} min ago`;
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface DashboardProps {
  plan?: Plan;
  hero?: Hero;
  gameSec?: number;
  laneOpponentId?: number;
  /** Undefined when follow mode is on but the room code was cleared. */
  room?: RoomStatus;
  /** The app's one-second heartbeat, so every "… ago" on screen ticks together. */
  now: number;
  onRepeat: () => void;
  settingsOpen: boolean;
  onSettings: (open: boolean) => void;
}

/**
 * Follow mode on a wide screen: everything about the match in one window that
 * never scrolls as a page, read at a glance from beside the device that plays.
 */
export function Dashboard({ plan, hero, gameSec, laneOpponentId, room, now, onRepeat, settingsOpen, onSettings }: DashboardProps) {
  const { state, dispatch } = useStore();
  const { session, settings } = state;
  const { ai, story, position } = session;
  const stage = stageOf(session);
  // Speech needs one tap per page load on iOS, even when the setting already says "on".
  const [voiceReady, setVoiceReady] = useState(false);
  const voiceOn = settings.speech.enabled;

  const turnOnVoice = () => {
    speaker.settings = { ...settings.speech, enabled: true };
    speaker.unlock();
    speaker.say("Voice is on.", 2);
    if (!voiceOn) dispatch({ type: "settings", patch: { speech: { ...settings.speech, enabled: true } } });
    setVoiceReady(true);
  };
  const voice = { ready: voiceOn && voiceReady, turnOn: turnOnVoice };

  const read = readStatus(room, now);
  const alert = !room
    ? "This device has no room code. Open Settings and enter the code your phone's shortcut sends to."
    : (room.error ?? (room.readError ? `The last screenshot could not be read: ${room.readError}` : undefined));

  const known = !!hero || session.enemies.length > 0 || session.allies.length > 0;
  const common = { hero, plan, laneOpponentId, room };
  let board: ReactNode;
  if (stage === "done") board = <DoneBoard />;
  else if (!known && !room?.lastReadAt) board = <WaitingBoard stage={session.stage} room={room} voice={voice} />;
  else if (stage === "draft") board = <DraftBoard {...common} />;
  else if (!hero || !plan) board = <WaitingBoard stage={stage} room={room} voice={voice} needHero />;
  else if (stage === "loading") board = <LoadingBoard {...common} hero={hero} plan={plan} />;
  else board = <LiveBoard {...common} hero={hero} plan={plan} gameSec={gameSec} now={now} ai={ai} story={story} position={position} onRepeat={onRepeat} />;

  return (
    <div className="dash">
      <header className="dash-bar">
        <div className="dash-room" title="The room this screen follows">
          <img src="./icon.svg" alt="" width={26} height={26} />
          <span className="dash-room-label">Room</span>
          <strong>{settings.sync.room || "—"}</strong>
        </div>
        <div className="stages" role="group" aria-label="Match stage">
          {STAGES.map((st) => (
            <button
              key={st}
              className={`chip ${stage === st ? "on" : ""}`}
              aria-pressed={stage === st}
              onClick={() => {
                speaker.unlock();
                setVoiceReady(true);
                dispatch({ type: "setStage", stage: st, now: Date.now() });
              }}
            >
              {STAGE_LABEL[st]}
            </button>
          ))}
        </div>
        <div className="dash-clock" title="Match clock">
          <strong className={gameSec === undefined ? "muted" : undefined}>{gameSec !== undefined ? formatClock(gameSec) : "--:--"}</strong>
        </div>
        <div className={`dash-read ${read.tone}`} title="The most recent screenshot from your phone">
          <strong>{read.what}</strong>
          <small>{read.when}</small>
        </div>
        <div className="dash-actions">
          <button
            className={`btn voice ${voice.ready ? "ghost on" : voiceOn ? "primary" : "ghost"}`}
            aria-pressed={voice.ready}
            title={voice.ready ? "Voice on — tap to mute" : "This device speaks only after one tap"}
            onClick={() => {
              if (voice.ready) dispatch({ type: "settings", patch: { speech: { ...settings.speech, enabled: false } } });
              else turnOnVoice();
            }}
          >
            {voice.ready ? "🔊 Voice on" : voiceOn ? "🔊 Turn on voice" : "🔇 Muted"}
          </button>
          <button className="btn ghost" aria-pressed={settingsOpen} aria-label={settingsOpen ? "Back to the dashboard" : "Settings"} onClick={() => onSettings(!settingsOpen)}>
            {settingsOpen ? "◂ Back" : "⚙"}
            {!settingsOpen && <span className="dash-wide"> Settings</span>}
          </button>
        </div>
      </header>
      {alert && (
        <p className="dash-alert" role="alert">
          {alert}
        </p>
      )}
      <main className="dash-body">
        {settingsOpen ? (
          <div className="dash-settings">
            <SettingsTab />
          </div>
        ) : (
          board
        )}
      </main>
    </div>
  );
}

/** What the last screenshot was and how long ago, in two short lines for the top bar. */
function readStatus(room: RoomStatus | undefined, now: number): { what: string; when: string; tone: "" | "ok" | "bad" } {
  if (!room) return { what: "No room", when: "open Settings", tone: "bad" };
  if (room.error) return { what: "Offline", when: "no answer from the server", tone: "bad" };
  if (room.readError) return { what: "Screenshot not read", when: room.lastReadAt ? `last good one ${agoText(now, room.lastReadAt)}` : "nothing read yet", tone: "bad" };
  if (room.lastReadAt) {
    const screen = room.lastRead ? (SCREEN_LABEL[room.lastRead.screen] ?? room.lastRead.screen) : "a screenshot";
    return { what: capital(screen), when: `last screenshot · ${agoText(now, room.lastReadAt)}`, tone: "ok" };
  }
  return { what: room.version ? "Connected" : "Waiting", when: "no screenshot yet", tone: "" };
}

/* ── Layout pieces ───────────────────────────────────────────────────────── */

function Column({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="dash-col" aria-label={title}>
      <header className="dash-colhead">
        <h2>{title}</h2>
        {aside && <small>{aside}</small>}
      </header>
      {children}
    </section>
  );
}

/**
 * One slot in a column. Its panel scrolls inside itself when it gets less room than it wants.
 * "fit" takes what its content needs (and gives way first), "grow" takes the room that is left,
 * "log" stays a few lines tall however long its list is, and "build" is the build list's slot:
 * the stylesheet lays the list out to suit the slot's height.
 */
function Cell({ size = "fit", children }: { size?: "fit" | "grow" | "log" | "build"; children: ReactNode }) {
  return <div className={`dash-cell ${size}`}>{children}</div>;
}

interface BoardProps {
  hero?: Hero;
  plan?: Plan;
  laneOpponentId?: number;
  room?: RoomStatus;
}
type ReadyBoardProps = BoardProps & { hero: Hero; plan: Plan };

function Reads({ room }: { room?: RoomStatus }) {
  return (
    <Cell size="log">
      <ReadsPanel reads={room?.reads} limit={6} sender="your phone" />
    </Cell>
  );
}

/** Screens that never show who is playing whom. Anything else that left us empty-handed is a read from before the match was cleared. */
const NO_HEROES_ON = ["other", "gameplay", "shop"];

/** A screenshot arrived but could not be coached from: say so where the missing content would be. */
function ReadNote({ room }: { room?: RoomStatus }) {
  const last = room?.lastRead;
  if (!last || !NO_HEROES_ON.includes(last.screen)) return null;
  return (
    <p className="error">
      The last screenshot arrived, but it showed <strong>{SCREEN_LABEL[last.screen] ?? last.screen}</strong>, which I can't coach from. {last.body}
    </p>
  );
}

/* ── Stage: nothing known yet ────────────────────────────────────────────── */

function WaitingBoard({ stage, room, voice, needHero = false }: { stage?: Stage; room?: RoomStatus; voice: { ready: boolean; turnOn: () => void }; needHero?: boolean }) {
  const code = useStore().state.settings.sync.room;
  const title = needHero
    ? `${STAGE_LABEL[stage ?? "live"]} — waiting to see your hero`
    : stage === "draft"
      ? "Hero selection — waiting for your phone"
      : "Waiting for your phone";
  return (
    <div className="dash-center">
      <section className="dash-calm" aria-live="polite">
        <span className="eyebrow">Room {code}</span>
        <h1>{title}</h1>
        <p className="dash-lead">
          {needHero
            ? "No screenshot so far has shown which hero you are playing."
            : "Nothing to do on this screen. It fills in by itself as soon as the first screenshot is read."}
        </p>
        <ReadNote room={room} />
        <span className="eyebrow">On your phone</span>
        {needHero ? (
          <>
            <ol className="plan">
              <li>
                Open the scoreboard — your own row is highlighted there — and say <strong>"coach now"</strong>.
              </li>
              <li>Your hero, build, the enemy team and the plan then appear here and are spoken aloud.</li>
            </ol>
            <span className="eyebrow">Or tell me yourself</span>
            <MyHeroButton size={48} />
          </>
        ) : (
          <ol className="plan">
            <li>
              When hero selection begins, say <strong>"draft mode"</strong>. Counter picks appear here as the enemy locks in.
            </li>
            <li>
              On the loading screen, say <strong>"entering the match"</strong>.
            </li>
            <li>
              When the match starts, say <strong>"coach on"</strong>. Open the scoreboard and the shop now and then, so the coach sees everyone's gold and your items.
            </li>
          </ol>
        )}
        {!voice.ready && (
          <div className="row wrap">
            <button className="btn primary" onClick={voice.turnOn}>
              🔊 Turn on voice for this device
            </button>
            <small>It only speaks after one tap, and only while this page stays open on screen.</small>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Stage: hero selection ───────────────────────────────────────────────── */

function DraftBoard({ hero, plan, laneOpponentId, room }: BoardProps) {
  const { state, dispatch } = useStore();
  const s = state.session;
  const picks = useCounterPicks(laneOpponentId);
  const taken = [...s.enemies, ...s.allies, ...s.banned, ...(s.myHeroId ? [s.myHeroId] : [])];
  return (
    <div className="dash-grid">
      <Column title="Best picks" aside={s.enemies.length ? `${s.enemies.length} of 5 enemies known` : "no enemy picks yet"}>
        <MyHeroButton size={56} />
        <Cell size="grow">
          <section className="panel">
            <CounterList picks={picks} />
          </section>
        </Cell>
      </Column>
      <Column title="The draft">
        <Cell size="grow">
          <section className="panel">
            <TeamRow label="Enemy team" tone="enemy" max={5} ids={s.enemies} exclude={taken} onChange={(ids) => dispatch({ type: "setTeam", side: "enemies", ids })} />
            <TeamRow label="Your teammates" tone="ally" max={4} ids={s.allies} exclude={taken} onChange={(ids) => dispatch({ type: "setTeam", side: "allies", ids })} />
            <LaneChips />
            <TeamRow label="Banned" tone="ban" max={10} ids={s.banned} exclude={taken} onChange={(ids) => dispatch({ type: "setTeam", side: "banned", ids })} />
            {!s.enemies.length && <p className="hint">Enemy picks appear here as your phone's screenshots show them. Until then the list shows the strongest heroes this patch — comfort beats counters, so take the one you play best.</p>}
            {!s.enemies.length && <ReadNote room={room} />}
          </section>
        </Cell>
      </Column>
      <Column title="How to play">
        {hero && plan ? (
          <Cell size="grow">
            <section className="panel">
              <Guide me={hero} enemies={s.enemies} threat={plan.threat} laneOpponentId={laneOpponentId} onPickLane={(id) => dispatch({ type: "setLaneOpponent", id })} />
            </section>
          </Cell>
        ) : (
          <p className="dash-quiet">Once your hero is locked in, the plan against this enemy team shows here.</p>
        )}
        <Reads room={room} />
      </Column>
    </div>
  );
}

/* ── Stage: match starting ───────────────────────────────────────────────── */

function LoadingBoard({ hero, plan, laneOpponentId, room }: ReadyBoardProps) {
  const { state, dispatch } = useStore();
  const s = state.session;
  const guide = { me: hero, enemies: s.enemies, threat: plan.threat, laneOpponentId, onPickLane: (id: number) => dispatch({ type: "setLaneOpponent", id }) };
  return (
    <div className="dash-grid">
      <Column title="Get ready">
        <section className="panel dash-setup">
          <div className="dash-me">
            <HeroIcon hero={hero} size={64} />
            <span>
              <span className="eyebrow">You are playing</span>
              <h1>{hero.name}</h1>
              <small>{[s.lane && LANE_LABEL[s.lane], hero.roles.join(" / ")].filter(Boolean).join(" · ")}</small>
            </span>
          </div>
          <SpellEmblem plan={plan} />
          {plan.bootsNote && <p className="hint">{plan.bootsNote}</p>}
        </section>
        <Cell>
          <section className="panel">
            <h2>Your lane plan</h2>
            <Guide {...guide} parts={["plan"]} />
          </section>
        </Cell>
        <Cell size="build">
          <section className="panel">
            <h2>Build, in order</h2>
            <BuildList plan={plan} compact />
          </section>
        </Cell>
      </Column>
      <Column title="The match">
        <section className="panel dash-teams">
          <TeamStrip label="Your team" tone="ally" ids={[hero.id, ...s.allies]} size={30} />
          <TeamStrip label="Enemy team" tone="enemy" ids={s.enemies} size={30} />
        </section>
        <Cell size="grow">
          <ThreatPanel plan={plan} compact />
        </Cell>
      </Column>
      <Column title="How to play">
        <Cell size="grow">
          <section className="panel">
            <Guide {...guide} parts={["lane", "picker", "others"]} />
          </section>
        </Cell>
        <Reads room={room} />
      </Column>
    </div>
  );
}

/* ── Stage: in match ─────────────────────────────────────────────────────── */

interface LiveBoardProps extends ReadyBoardProps {
  gameSec?: number;
  now: number;
  ai?: AiAdvice;
  story?: StoryBeat[];
  position?: PositionAdvice;
  onRepeat: () => void;
}

function LiveBoard({ hero, plan, laneOpponentId, room, gameSec, now, ai, story, position: asked, onRepeat }: LiveBoardProps) {
  const { state, dispatch } = useStore();
  const s = state.session;
  const next = gameSec !== undefined ? upcoming(gameSec, 1)[0] : undefined;
  const aside = [s.gold !== undefined ? `${s.gold} gold` : "", next ? `${next.label} ${formatClock(next.atSec)}` : ""].filter(Boolean).join(" · ");
  const bought = plan.slots.filter((slot) => slot.owned).length;
  const beats = story?.length ? story : undefined;
  const position = asked && now - asked.at < POSITION_FRESH_MS ? asked : undefined;
  return (
    <div className="dash-grid">
      <Column title="Do this now" aside={aside}>
        <NowCard plan={plan} onRepeat={onRepeat} iconSize={96} />
        {ai ? (
          <Cell>
            <AiCard ai={ai} now={now} />
          </Cell>
        ) : s.tip ? (
          <Cell>
            <section className="panel ai-card" aria-label="Coach's read">
              <span className="eyebrow">Coach's read</span>
              <p className="ai-headline">{s.tip}</p>
            </section>
          </Cell>
        ) : null}
        <Cell size="build">
          <section className="panel">
            <div className="panel-head">
              <h2>{hero.name} — build</h2>
              <small>
                {bought} of {plan.slots.length} bought
              </small>
            </div>
            <BuildList plan={plan} compact onToggle={(id) => dispatch({ type: "toggleOwned", id })} />
          </section>
        </Cell>
      </Column>
      <Column title="The match">
        <Cell size="grow">
          <StoryPanel lead={beats && <Storyboard beats={beats} />} />
        </Cell>
        <Cell>
          <ThreatPanel plan={plan} compact />
        </Cell>
      </Column>
      <Column title="How to play">
        {position ? (
          <Cell>
            <PositionCard position={position} now={now} />
          </Cell>
        ) : (
          <p className="dash-quiet">Say "help me position" on your phone</p>
        )}
        <Cell size="grow">
          <section className="panel">
            <Guide me={hero} enemies={s.enemies} threat={plan.threat} laneOpponentId={laneOpponentId} onPickLane={(id) => dispatch({ type: "setLaneOpponent", id })} parts={["lane", "plan", "picker", "others"]} />
          </section>
        </Cell>
        <Reads room={room} />
      </Column>
    </div>
  );
}

/** What the AI coach concluded from the latest read: the headline, what to do, what to avoid, who to watch. */
function AiCard({ ai, now }: { ai: AiAdvice; now: number }) {
  const stale = now - ai.at > AI_STALE_MS;
  const focus = ai.focus ? heroById(ai.focus.heroId) : undefined;
  return (
    <section className={`panel ai-card ai-coach ${stale ? "stale" : ""}`} aria-label="AI coach">
      <div className="panel-head">
        <span className="eyebrow">AI coach</span>
        <span className="ai-meta">
          <span className={`tag sit-${ai.situation}`}>{ai.situation}</span>
          <small>{agoText(now, ai.at)}</small>
        </span>
      </div>
      <p className="ai-headline">{ai.headline}</p>
      {ai.doNow.length > 0 && (
        <ul className="how">
          {ai.doNow.slice(0, 3).map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
      {ai.avoid && <p className="ai-avoid">Avoid: {ai.avoid}</p>}
      {ai.focus && focus && (
        <div className="ai-focus">
          <HeroIcon hero={focus} size={40} />
          <span>
            <strong>{focus.name}</strong> — {ai.focus.why}
          </span>
        </div>
      )}
    </section>
  );
}

/** The match as a timeline, newest first. */
function Storyboard({ beats }: { beats: StoryBeat[] }) {
  const newestFirst = [...beats].sort((a, b) => b.at - a.at);
  return (
    <ol className="beats" aria-label="Storyboard">
      {newestFirst.map((beat, i) => (
        <li key={`${beat.at}-${i}`} className={`beat-${beat.tone ?? "neutral"}`}>
          <time>{formatClock(Math.max(0, beat.at))}</time>
          <span>{beat.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** The answer to "help me position", while it is still about the fight it was asked for. */
function PositionCard({ position, now }: { position: PositionAdvice; now: number }) {
  return (
    <section className="panel pos-card" aria-label="Positioning">
      <div className="panel-head">
        <h2>Where to stand</h2>
        <small>{agoText(now, position.at)}</small>
      </div>
      <p>{position.summary}</p>
      {position.danger && <p className="pos-danger">{position.danger}</p>}
      {position.moves.length > 0 && (
        <ol className="plan">
          {position.moves.map((move, i) => (
            <li key={`${i}-${move}`}>{move}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ── Stage: match over ───────────────────────────────────────────────────── */

function DoneBoard() {
  const s = useStore().state.session;
  // The same condition StoryPanel needs to have something to say.
  const hasStory = s.history.length > 0 && !!s.myHeroId;
  return (
    <div className={`dash-center ${hasStory ? "with-side" : ""}`}>
      <section className="dash-calm">
        <span className="eyebrow">Match over</span>
        <h1>Coaching is paused</h1>
        <p className="dash-lead">Screenshots are not being read, so nothing is spent between matches.</p>
        <p className="dash-say">
          <small>When the next hero selection starts, say</small>
          <strong>"draft mode"</strong>
        </p>
        <p className="hint">Or tap Hero selection at the top of this screen. Either one clears this match and starts a fresh one.</p>
      </section>
      {hasStory && (
        <div className="dash-side">
          <Cell size="grow">
            <StoryPanel />
          </Cell>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { HEROES_BY_NAME, heroById, normalizeName } from "../data/heroes";
import type { Hero, Role } from "../types";

const ROLES: Role[] = ["Tank", "Fighter", "Assassin", "Mage", "Marksman", "Support"];

export function HeroIcon({ hero, size = 44 }: { hero: Hero; size?: number }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">(hero.icon ? "loading" : "broken");
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  // Initials show until the portrait arrives (and stay if it never does), so a slot is never blank.
  return (
    <span className={`hero-icon fallback role-${hero.roles[0]?.toLowerCase()}`} style={style} aria-hidden>
      {state !== "ok" && hero.name.slice(0, 2)}
      {state !== "broken" && (
        <img
          src={hero.icon}
          alt=""
          referrerPolicy="no-referrer"
          style={{ opacity: state === "ok" ? 1 : 0 }}
          onLoad={() => setState("ok")}
          onError={() => setState("broken")}
        />
      )}
    </span>
  );
}

interface PickerProps {
  title: string;
  exclude: number[];
  onPick: (id: number) => void;
  onClose: () => void;
}

export function HeroPicker({ title, exclude, onPick, onClose }: PickerProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | undefined>();
  const list = useMemo(() => {
    const q = normalizeName(query);
    return HEROES_BY_NAME.filter(
      (h) => !exclude.includes(h.id) && (!role || h.roles.includes(role)) && (!q || normalizeName(h.name).includes(q)),
    );
  }, [query, role, exclude]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <input
          className="input"
          autoFocus
          placeholder="Search hero…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && list[0]) onPick(list[0].id);
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="chips">
          <button className={`chip ${!role ? "on" : ""}`} onClick={() => setRole(undefined)}>
            All
          </button>
          {ROLES.map((r) => (
            <button key={r} className={`chip ${role === r ? "on" : ""}`} onClick={() => setRole(role === r ? undefined : r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="hero-grid">
          {list.map((h) => (
            <button key={h.id} className="hero-cell" onClick={() => onPick(h.id)}>
              <HeroIcon hero={h} size={48} />
              <span>{h.name}</span>
            </button>
          ))}
          {!list.length && <p className="muted">No hero matches.</p>}
        </div>
      </div>
    </div>
  );
}

interface TeamRowProps {
  label: string;
  ids: number[];
  max: number;
  tone: "ally" | "enemy" | "ban";
  exclude: number[];
  onChange: (ids: number[]) => void;
}

/** A row of hero slots: tap an empty slot to add, tap a hero to remove. */
export function TeamRow({ label, ids, max, tone, exclude, onChange }: TeamRowProps) {
  const [picking, setPicking] = useState(false);
  return (
    <div className={`team-row tone-${tone}`}>
      <div className="team-label">
        {label} <span className="muted">{ids.length}/{max}</span>
      </div>
      <div className="slots">
        {ids.map((id) => {
          const hero = heroById(id);
          if (!hero) return null;
          return (
            <button key={id} className="slot filled" title={`Remove ${hero.name}`} onClick={() => onChange(ids.filter((x) => x !== id))}>
              <HeroIcon hero={hero} />
              <span>{hero.name}</span>
            </button>
          );
        })}
        {ids.length < max && (
          <button className="slot empty" onClick={() => setPicking(true)} aria-label={`Add to ${label}`}>
            <span className="plus">+</span>
            <span>Add</span>
          </button>
        )}
      </div>
      {picking && (
        <HeroPicker
          title={`Add to ${label.toLowerCase()}`}
          exclude={exclude}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            const next = [...ids, id];
            onChange(next);
            if (next.length >= max) setPicking(false);
          }}
        />
      )}
    </div>
  );
}

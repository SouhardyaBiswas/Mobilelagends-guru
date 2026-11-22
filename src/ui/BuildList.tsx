import type { BuildPlan } from "../types";

interface Props {
  plan: BuildPlan;
  /** When given, slots become toggles for "I own this". */
  onToggle?: (itemId: string) => void;
}

export function BuildList({ plan, onToggle }: Props) {
  const nextId = plan.next.item?.id;
  return (
    <ol className="build">
      {plan.slots.map((slot, i) => {
        const isNext = !slot.owned && slot.item.id === nextId;
        const cls = `build-slot ${slot.owned ? "owned" : ""} ${isNext ? "next" : ""} kind-${slot.kind}`;
        const body = (
          <>
            <span className="build-n">{slot.owned ? "✓" : i + 1}</span>
            <span className="build-main">
              <span className="build-name">
                {slot.item.name}
                <span className="build-cost">{slot.item.cost}g</span>
                {slot.kind === "situational" && <span className="tag situational">counter</span>}
                {isNext && <span className="tag nexttag">next</span>}
              </span>
              {slot.reason && <span className="build-why">{slot.reason}</span>}
            </span>
          </>
        );
        return (
          <li key={slot.item.id}>
            {onToggle ? (
              <button className={cls} onClick={() => onToggle(slot.item.id)} title={slot.owned ? "Tap if you don't have this" : "Tap when you own this"}>
                {body}
              </button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function SpellEmblem({ plan }: { plan: BuildPlan }) {
  return (
    <div className="setup-grid">
      <div className="setup-card">
        <span className="eyebrow">Battle spell</span>
        <strong>{plan.spell.name}</strong>
        <p>{plan.spell.reason}</p>
      </div>
      <div className="setup-card">
        <span className="eyebrow">Emblem</span>
        <strong>{plan.emblem.name}</strong>
        <p>
          {plan.emblem.talents.join(" · ")}
          <br />
          {plan.emblem.reason}
        </p>
      </div>
    </div>
  );
}

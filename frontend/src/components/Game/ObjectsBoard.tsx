/**
 * World Story — OP-OBJECTS: la sala di governo (presentazione)
 * ===========================================================
 * Due livelli, una grammatica sola:
 *
 *  A) le schede di **settore** (forze armate, industria, marina, risorse) con
 *     i numeri che contano e i problemi aperti;
 *  B) il **singolo oggetto** (armata, impianto, cantiere, nave, miniera) con
 *     `STATO · CAPACITÀ · PERSONALE · INPUT · OUTPUT · COSTI · AUTONOMIA`,
 *     i problemi e le azioni con il PRIMA → DOPO già calcolato dal motore.
 *
 * Regole della vista: pochi numeri, etichette brevi, spiegazioni lunghe solo
 * sotto «Perché?». Il componente non calcola nulla: formatta il read model
 * `operationalObjects` (che a sua volta legge solo il payload di `/arsenal`).
 */
import React from 'react';
import type {
  ArsenalResponse, FormationImpactPayload, OperatingObjectPayload, OperatingPicturePayload,
  UnitActionImpactPayload, UnitActionRequest, UnitOrderImpactPayload, UnitOrderPayload,
  UnitOrderRequest,
} from '../../services/api';
import {
  KIND_LABEL, actionsOf, armyTargets, chainsView, childrenOf, factRows, formationActionView,
  primaryProblem, regionTargets, sectorCards, sectionsOf, statusTone, unitActionView, unitOrderView,
  type SectorCard,
} from './operationalObjects';

const tone = (value: string) => `tone-${value}`;

/** Le azioni che il pannello del reparto esegue davvero (regole del motore). */
const UNIT_ACTIONS = ['reinforce_unit', 'reequip_unit', 'reconstitute_unit', 'transfer_unit', 'reassign_unit'];

/**
 * MILITARY-UNITS PR2 — le quattro mosse del **fronte**. Sono lo stesso motore
 * degli NPC: cambia solo chi sceglie (qui il giocatore, nei tick la policy).
 */
const UNIT_ORDERS = ['order_attack', 'order_defend', 'order_reserve', 'order_withdraw'];
const isOrderAction = (id: string) => UNIT_ORDERS.includes(id);
/** `order_attack` → `attack` (l'id dell'API è l'ordine del motore). */
const orderOf = (id: string) => id.replace('order_', '') as UnitOrderPayload;

interface ObjectsBoardProps {
  arsenal: ArsenalResponse;
  /** Anteprima PRIMA → DOPO della creazione di reparti (nessuna scrittura). */
  onPreviewFormation?: (options: { formations?: number; armyId?: string | null; name?: string }) => Promise<FormationImpactPayload>;
  /** Esegue davvero la creazione: il motore paga, scala il deposito e aggiunge l'armata. */
  onRaiseFormation?: (options: { formations?: number; armyId?: string | null; name?: string }) => Promise<unknown>;
  /**
   * MILITARY-UNITS — azione su un reparto: `dryRun` è l'anteprima, altrimenti il
   * motore applica (riserva addestrata, deposito, costo di movimento).
   */
  onUnitAction?: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  /**
   * MILITARY-UNITS PR2 — mossa di un reparto sul fronte: `dryRun` è l'anteprima
   * PRIMA → DOPO (pressione, perdite attese, consumi), altrimenti l'ordine vero.
   */
  onUnitOrder?: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
  busy?: boolean;
}

/** Scheda di settore: aggregato + i problemi aperti che chiedono attenzione. */
function SectorTile({ card, onOpen }: { card: SectorCard; onOpen: () => void }) {
  return (
    <article className={`obj-sector ${card.status === 'absent' ? '' : tone(statusTone(card.status))}`} aria-label={card.label}>
      <header className="obj-sector-head">
        <span className="obj-sector-name">{card.label}</span>
        <span className="obj-sector-count">{card.objectIds.length || '—'}</span>
      </header>
      <p className="obj-sector-headline">{card.headline}</p>
      <dl className="obj-facts">
        {card.facts.filter(fact => fact.value !== '—').map(fact => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {card.problems.length > 0 && (
        <ul className="obj-problems">
          {card.problems.map(problem => (
            <li key={problem.label} className={tone(problem.severity === 'critical' ? 'negative' : 'warning')}>
              {problem.label}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="obj-open" onClick={onOpen}>
        Apri {card.objectIds.length > 0 ? `${card.objectIds.length} oggetti` : 'il dettaglio'}
      </button>
    </article>
  );
}

/** Blocco PRIMA → DOPO dell'azione: i numeri sono quelli del motore. */
function ActionImpact({ view, busy, onConfirm, onCancel }: {
  view: ReturnType<typeof formationActionView>;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!view) return null;
  return (
    <div className="obj-action" role="group" aria-label={view.title}>
      <div className="obj-action-head">
        <b>{view.title}</b>
        <span>{view.costLine}</span>
      </div>
      {view.equipmentLine && <p className="obj-action-line">{view.equipmentLine}</p>}
      {view.blocked && <p className={`obj-blocked ${tone('negative')}`}>{view.blockedReason ?? 'Azione non disponibile.'}</p>}
      <table className="obj-delta">
        <thead>
          <tr><th>Effetto</th><th>Prima</th><th>Dopo</th></tr>
        </thead>
        <tbody>
          {view.rows.map(row => (
            <tr key={row.label} className={tone(row.tone)}>
              <td>{row.label}</td>
              <td>{row.before}</td>
              <td>{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="obj-why">
        <summary>Perché?</summary>
        <p>{view.why}</p>
      </details>
      <div className="obj-action-buttons">
        <button type="button" className="obj-confirm" disabled={view.blocked || busy} onClick={onConfirm}>
          {busy ? 'In corso…' : 'Conferma'}
        </button>
        <button type="button" className="obj-cancel" disabled={busy} onClick={onCancel}>Annulla</button>
      </div>
    </div>
  );
}

/**
 * MILITARY-UNITS — pannello del **reparto**: le quattro azioni reali, con la
 * destinazione da scegliere quando serve (regione o armata) e la tabella
 * PRIMA → DOPO calcolata dal motore (`dryRun`), come per la creazione di reparti.
 * Nessun numero viene calcolato qui.
 */
function UnitActionPanel({ object, picture, busy, onUnitAction, onUnitOrder }: {
  object: OperatingObjectPayload;
  picture: OperatingPicturePayload;
  busy?: boolean;
  onUnitAction?: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  onUnitOrder?: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
}) {
  const actions = actionsOf(object).filter(action => UNIT_ACTIONS.includes(action.id));
  const orders = actionsOf(object).filter(action => isOrderAction(action.id));
  const [selected, setSelected] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<string>('');
  const [impact, setImpact] = React.useState<UnitActionImpactPayload | UnitOrderImpactPayload | null>(null);
  const [pending, setPending] = React.useState(false);
  if (actions.length === 0) return null;

  const actionId = (id: string) => id.replace('_unit', '') as UnitActionRequest['action'];
  const needsTarget = selected === 'transfer_unit' || selected === 'reassign_unit';
  const options = selected === 'transfer_unit'
    ? regionTargets(picture, object)
    : selected === 'reassign_unit' ? armyTargets(picture, object) : [];

  const run = async (dryRun: boolean) => {
    if (!selected) return;
    setPending(true);
    try {
      const result = isOrderAction(selected)
        ? (onUnitOrder
          ? await onUnitOrder({ unitId: object.id, order: orderOf(selected), dryRun })
          : null)
        : (onUnitAction
          ? await onUnitAction({
            action: actionId(selected),
            unitId: object.id,
            dryRun,
            ...(selected === 'transfer_unit' ? { regionId: target } : {}),
            ...(selected === 'reassign_unit' ? { armyId: target } : {}),
          })
          : null);
      if (!result) return;
      if (dryRun) setImpact(result);
      else {
        setImpact(null);
        setSelected(null);
        setTarget('');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="obj-unit-actions" role="group" aria-label={`Azioni su ${object.label}`}>
      <div className="obj-object-actions">
        {actions.map(action => (
          <button
            key={action.id}
            type="button"
            className={`obj-action-button ${selected === action.id ? 'active' : ''}`}
            disabled={!action.enabled || busy}
            title={action.blockedReason ?? undefined}
            onClick={() => { setSelected(action.id); setImpact(null); setTarget(''); }}
          >
            {action.label}
          </button>
        ))}
      </div>
      {orders.length > 0 && (
        <div className="obj-unit-orders" role="group" aria-label={`Mosse del fronte per ${object.label}`}>
          <span className="obj-unit-orders-title">Mosse sul fronte</span>
          <div className="obj-object-actions">
            {orders.map(action => (
              <button
                key={action.id}
                type="button"
                className={`obj-action-button ${selected === action.id ? 'active' : ''}`}
                disabled={!action.enabled || busy}
                title={action.blockedReason ?? undefined}
                onClick={() => { setSelected(action.id); setImpact(null); setTarget(''); }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {actions.concat(orders).some(action => !action.enabled && action.blockedReason) && (
        <span className="obj-blocked-hint">{actions.concat(orders).find(action => !action.enabled)?.blockedReason}</span>
      )}
      {selected && needsTarget && (
        <div className="obj-unit-target">
          <label>
            {selected === 'transfer_unit' ? 'Regione di destinazione' : 'Armata di destinazione'}
            <select value={target} onChange={event => { setTarget(event.target.value); setImpact(null); }}>
              <option value="">— scegli —</option>
              {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>
      )}
      {selected && (
        <div className="obj-action-buttons">
          <button
            type="button"
            className="obj-confirm"
            disabled={pending || busy || (needsTarget && !target)}
            onClick={() => { void run(true); }}
          >
            {pending ? 'In corso…' : 'Anteprima'}
          </button>
          <button type="button" className="obj-cancel" onClick={() => { setSelected(null); setImpact(null); setTarget(''); }}>
            Chiudi
          </button>
        </div>
      )}
      {impact && (
        <ActionImpact
          view={'rows' in impact && 'order' in impact ? unitOrderView(impact) : unitActionView(impact)}
          busy={pending || busy}
          onConfirm={() => { void run(false); }}
          onCancel={() => setImpact(null)}
        />
      )}
    </div>
  );
}

/** Il singolo oggetto: grammatica universale, problemi, azioni. */
function ObjectCard({ object, depth = 0, busy, action, picture, onPreview, onRaise, onCancel, onPreviewChild, onUnitAction, onUnitOrder }: {
  object: OperatingObjectPayload;
  depth?: number;
  busy?: boolean;
  action?: { armyId: string | null; preview: FormationImpactPayload | null } | null;
  picture: OperatingPicturePayload;
  onPreview?: (armyId: string | null) => void;
  onRaise?: () => void;
  onCancel?: () => void;
  onPreviewChild?: (armyId: string | null) => void;
  onUnitAction?: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  onUnitOrder?: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
}) {
  const [open, setOpen] = React.useState(depth > 0);
  const problem = primaryProblem(object);
  const sections = open ? sectionsOf(object) : [];
  const rows = open ? [] : factRows(object).slice(0, 4);
  // Le azioni del reparto le esegue il suo pannello: qui restano le altre.
  const actions = actionsOf(object)
    .filter(item => !(object.kind === 'unit' && (UNIT_ACTIONS.includes(item.id) || isOrderAction(item.id))));
  const isActionTarget = action && action.armyId === (object.kind === 'army' ? object.id : null);

  return (
    <article className={`obj-object depth-${depth} ${tone(statusTone(object.status))}`} aria-label={object.label}>
      <header className="obj-object-head">
        <button type="button" className="obj-object-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="obj-object-name">{object.label}</span>
          <span className="obj-object-kind">{KIND_LABEL[object.kind] ?? object.kind}</span>
        </button>
        <span className={`op-status ${tone(statusTone(object.status))}`}>{object.statusLabel}</span>
      </header>
      {object.subtitle && <p className="obj-object-sub">{object.subtitle}</p>}
      <dl className="obj-facts">
        {(open ? [] : rows).map(row => (
          <div key={row.label} className={tone(row.tone)}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {problem && !open && (
        <p className={`obj-problem ${tone(problem.severity === 'critical' ? 'negative' : 'warning')}`}>{problem.label}</p>
      )}
      {open && sections.map(section => (
        <section key={section.section} className="obj-section">
          <h5>{section.label}</h5>
          <dl className="obj-facts">
            {section.rows.map(row => (
              <div key={`${section.section}-${row.label}`} className={tone(row.tone)}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
                {row.note && <small className="obj-note">{row.note}</small>}
              </div>
            ))}
          </dl>
        </section>
      ))}
      {open && object.problems.length > 0 && (
        <ul className="obj-problems">
          {object.problems.map(item => (
            <li key={item.label} className={tone(item.severity === 'critical' ? 'negative' : 'warning')}>
              <b>{item.label}</b>
              {item.detail && <em>{item.detail}</em>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <>
          <div className="obj-object-actions">
            {actions.map(item => (
              <button
                key={item.id}
                type="button"
                className="obj-action-button"
                disabled={!item.enabled || busy}
                title={item.blockedReason ?? undefined}
                onClick={() => {
                  if (item.id === 'raise_formation') {
                    const armyId = object.kind === 'army' ? object.id : null;
                    (onPreviewChild ?? onPreview)?.(armyId);
                  }
                }}
              >
                {item.label}
              </button>
            ))}
            {actions.some(item => !item.enabled && item.blockedReason) && (
              <span className="obj-blocked-hint">
                {actions.find(item => !item.enabled)?.blockedReason}
              </span>
            )}
          </div>
          {object.kind === 'unit' && (
            <UnitActionPanel
              object={object}
              picture={picture}
              busy={busy}
              onUnitAction={onUnitAction}
              onUnitOrder={onUnitOrder}
            />
          )}
          {object.why && (
            <details className="obj-why">
              <summary>Perché?</summary>
              <p>{object.why}</p>
            </details>
          )}
        </>
      )}
      {isActionTarget && action?.preview && onRaise && onCancel && (
        <ActionImpact view={formationActionView(action.preview)} busy={busy} onConfirm={onRaise} onCancel={onCancel} />
      )}
    </article>
  );
}

/** Catene produttive: dove si rompe la filiera, in una riga per catena. */
function ChainList({ arsenal }: { arsenal: ArsenalResponse }) {
  const chains = chainsView(arsenal.objects);
  if (chains.length === 0) return null;
  return (
    <div className="obj-chains">
      {chains.map(chain => (
        <div key={chain.id} className={`obj-chain ${chain.broken ? tone('negative') : ''}`}>
          <b>{chain.label}</b>
          <ol>
            {chain.steps.map(step => (
              <li key={step.label} className={tone(step.tone)}>
                <span>{step.label}</span>
                <em>{step.value}</em>
              </li>
            ))}
          </ol>
          <p>{chain.summary}</p>
        </div>
      ))}
    </div>
  );
}

export function ObjectsBoard({ arsenal, onPreviewFormation, onRaiseFormation, onUnitAction, onUnitOrder, busy }: ObjectsBoardProps) {
  const [sector, setSector] = React.useState<string | null>(null);
  const [action, setAction] = React.useState<{ armyId: string | null; preview: FormationImpactPayload | null } | null>(null);
  const picture = arsenal.objects;
  const cards = sectorCards(picture, {
    capacityTotal: arsenal.industrialCapacity.total,
    capacityUsed: arsenal.industrialCapacity.used,
    capacityFree: arsenal.industrialCapacity.free,
    blocked: arsenal.industrialCapacity.blocked,
    saturated: arsenal.industrialCapacity.saturated,
    factories: arsenal.capacity.factories,
    ports: arsenal.capacity.ports,
    universities: arsenal.capacity.universities,
  });
  const card = cards.find(item => item.id === sector) ?? null;

  const preview = async (armyId: string | null) => {
    if (!onPreviewFormation) return;
    setAction({ armyId, preview: null });
    try {
      const impact = await onPreviewFormation({ formations: 1, armyId });
      setAction({ armyId, preview: impact });
    } catch {
      setAction(null);
    }
  };

  // Livello B: la gerarchia — schieramento → armate → reparti, flotte → navi.
  // I «capi» sono gli oggetti senza padre dentro il settore; i figli si seguono
  // nel quadro completo (un reparto vive sotto la sua armata).
  const members = card ? picture.objects.filter(object => card.objectIds.includes(object.id)) : [];
  const roots = members.filter(object => !object.parentId || !members.some(other => other.id === object.parentId));

  /** Un ramo della gerarchia: padre, poi figli (fino a tre livelli). */
  const renderBranch = (object: OperatingObjectPayload, depth: number): React.ReactNode => (
    <React.Fragment key={object.id}>
      <ObjectCard
        object={object}
        depth={depth}
        picture={picture}
        busy={busy}
        action={action}
        onPreview={preview}
        onPreviewChild={preview}
        onUnitAction={onUnitAction}
        onUnitOrder={onUnitOrder}
        onRaise={() => { void onRaiseFormation?.({ formations: 1, armyId: action?.armyId }); }}
        onCancel={() => setAction(null)}
      />
      {depth < 2 && childrenOf(picture, object.id).map(child => renderBranch(child, depth + 1))}
    </React.Fragment>
  );

  return (
    <div className="obj-board">
      <p className="obj-intro">
        {arsenal.epochLabel} · {picture.objects.length} oggetti · {arsenal.industrialCapacity.blocked
          ? 'produzione bloccata'
          : `industria al ${Math.round(arsenal.industrialCapacity.utilizationPct)}%`}
      </p>

      {!card && (
        <div className="obj-sectors">
          {cards.map(item => <SectorTile key={item.id} card={item} onOpen={() => setSector(item.id)} />)}
        </div>
      )}

      {card && (
        <div className="obj-detail">
          <button type="button" className="obj-back" onClick={() => { setSector(null); setAction(null); }}>
            ← Tutti i settori
          </button>
          <header className="obj-detail-head">
            <b>{card.label}</b>
            <span>{card.headline}</span>
          </header>
          <dl className="obj-facts wide">
            {card.facts.filter(fact => fact.value !== '—').map(fact => (
              <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
            ))}
          </dl>
          <div className="obj-list">
            {roots.map(object => renderBranch(object, 0))}
            {roots.length === 0 && <p className="obj-empty">Nessun oggetto in questo settore.</p>}
          </div>
        </div>
      )}

      <details className="obj-why block" open={false}>
        <summary>Catene e convenzioni</summary>
        <ChainList arsenal={arsenal} />
        <ul className="obj-conventions">
          {picture.conventions.map(rule => <li key={rule}>{rule}</li>)}
        </ul>
      </details>
    </div>
  );
}

export default ObjectsBoard;

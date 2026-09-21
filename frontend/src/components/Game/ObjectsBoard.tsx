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
  UnitActionImpactPayload, UnitActionRequest, UnitOrderImpactPayload, UnitOrderRequest,
} from '../../services/api';
import {
  KIND_LABEL, actionsOf, chainsView, childrenOf, factRows, formationActionView,
  primaryProblem, sectorCards, sectionsOf, statusTone, type SectorCard,
} from './operationalObjects';
import { ActionImpact, UnitActionPanel, UNIT_ACTIONS, isOrderAction } from './UnitActionPanel';

const tone = (value: string) => `tone-${value}`;

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
  /**
   * MAP P4.1 — identità dello snapshot canonico (`gameId:turno:data:revisione:ramo`),
   * la stessa che la mappa passa al context inspector: al cambio, la preview
   * PRIMA → DOPO di un reparto non è più confermabile.
   */
  snapshotKey?: string;
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

/** Il singolo oggetto: grammatica universale, problemi, azioni. */
function ObjectCard({ object, depth = 0, busy, action, picture, snapshotKey, onPreview, onRaise, onCancel, onPreviewChild, onUnitAction, onUnitOrder }: {
  object: OperatingObjectPayload;
  depth?: number;
  busy?: boolean;
  snapshotKey?: string;
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
    .filter(item => !(object.kind === 'unit' && ((UNIT_ACTIONS as readonly string[]).includes(item.id) || isOrderAction(item.id))));
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
              snapshotKey={snapshotKey}
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

export function ObjectsBoard({ arsenal, onPreviewFormation, onRaiseFormation, onUnitAction, onUnitOrder, snapshotKey, busy }: ObjectsBoardProps) {
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
        snapshotKey={snapshotKey}
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

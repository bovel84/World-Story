import React from 'react';
import type {
  OperatingActionPayload,
  OperatingObjectPayload,
  OperatingPicturePayload,
  UnitActionImpactPayload,
  UnitActionRequest,
  UnitOrderImpactPayload,
  UnitOrderPayload,
  UnitOrderRequest,
} from '../../services/api';
import {
  actionsOf,
  armyTargets,
  formationActionView,
  regionTargets,
  unitActionView,
  unitOrderView,
} from './operationalObjects';

const tone = (value: string) => `tone-${value}`;

/** Azioni/ordini pubblicati dal motore: nessuna disponibilità sintetizzata. */
export const UNIT_ACTIONS = ['reinforce_unit', 'reequip_unit', 'reconstitute_unit', 'transfer_unit', 'reassign_unit'] as const;
export const UNIT_ORDERS = ['order_attack', 'order_defend', 'order_reserve', 'order_withdraw'] as const;
export type UnitPanelActionId = typeof UNIT_ACTIONS[number] | typeof UNIT_ORDERS[number];

export const isOrderAction = (id: string): id is typeof UNIT_ORDERS[number] =>
  (UNIT_ORDERS as readonly string[]).includes(id);
const orderOf = (id: typeof UNIT_ORDERS[number]) => id.replace('order_', '') as UnitOrderPayload;
const actionOf = (id: typeof UNIT_ACTIONS[number]) => id.replace('_unit', '') as UnitActionRequest['action'];

export type UnitPanelCommand =
  | { kind: 'action'; request: UnitActionRequest }
  | { kind: 'order'; request: UnitOrderRequest };

/**
 * Costruzione pura del payload usata sia dalla sala di governo sia dalla mappa.
 * Preview e conferma differiscono soltanto per `dryRun`.
 */
export function unitPanelCommand(input: {
  actionId: UnitPanelActionId;
  unitId: string;
  target?: string;
  dryRun: boolean;
}): UnitPanelCommand {
  if (isOrderAction(input.actionId)) {
    return {
      kind: 'order',
      request: { unitId: input.unitId, order: orderOf(input.actionId), dryRun: input.dryRun },
    };
  }
  return {
    kind: 'action',
    request: {
      action: actionOf(input.actionId),
      unitId: input.unitId,
      dryRun: input.dryRun,
      ...(input.actionId === 'transfer_unit' ? { regionId: input.target } : {}),
      ...(input.actionId === 'reassign_unit' ? { armyId: input.target } : {}),
    },
  };
}

export function confirmedUnitPanelCommand(command: UnitPanelCommand): UnitPanelCommand {
  return command.kind === 'order'
    ? { kind: 'order', request: { ...command.request, dryRun: false } }
    : { kind: 'action', request: { ...command.request, dryRun: false } };
}

/** Blocco PRIMA → DOPO: i numeri e i testi arrivano dal payload del motore. */
export function ActionImpact({ view, busy, onConfirm, onCancel }: {
  view: ReturnType<typeof formationActionView>;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!view) return null;
  return (
    <div className="obj-action" role="group" aria-label={view.title}>
      <div className="obj-action-head"><b>{view.title}</b><span>{view.costLine}</span></div>
      {view.equipmentLine && <p className="obj-action-line">{view.equipmentLine}</p>}
      {view.blocked && <p className={`obj-blocked ${tone('negative')}`}>{view.blockedReason ?? 'Azione non disponibile.'}</p>}
      <table className="obj-delta">
        <caption className="visually-hidden">Confronto prima e dopo</caption>
        <thead><tr><th scope="col">Effetto</th><th scope="col">Prima</th><th scope="col">Dopo</th></tr></thead>
        <tbody>{view.rows.map(row => <tr key={row.label} className={tone(row.tone)}>
          <th scope="row">{row.label}</th><td>{row.before}</td><td>{row.after}</td>
        </tr>)}</tbody>
      </table>
      <details className="obj-why"><summary>Perché?</summary><p>{view.why}</p></details>
      <div className="obj-action-buttons">
        <button type="button" className="obj-confirm" disabled={view.blocked || busy} onClick={onConfirm}>
          {busy ? 'In corso…' : 'Conferma'}
        </button>
        <button type="button" className="obj-cancel" disabled={busy} onClick={onCancel}>Annulla</button>
      </div>
    </div>
  );
}

interface PreviewState {
  impact: UnitActionImpactPayload | UnitOrderImpactPayload;
  /** Comando esatto che ha prodotto il dry-run; la conferma non lo ricostruisce. */
  command: UnitPanelCommand;
}

export interface UnitActionPanelProps {
  object: OperatingObjectPayload;
  picture: OperatingPicturePayload;
  busy?: boolean;
  /** Turno/data/revisione/ramo: un cambio invalida qualsiasi dry-run aperto. */
  snapshotKey?: string;
  onUnitAction?: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  onUnitOrder?: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
}

/**
 * Pannello unico per sala di governo e context inspector della mappa.
 * Disponibilità = `object.actions`; preview/confirm = stessi endpoint esistenti.
 */
export function UnitActionPanel({
  object,
  picture,
  busy = false,
  snapshotKey = '',
  onUnitAction,
  onUnitOrder,
}: UnitActionPanelProps) {
  const actions = actionsOf(object).filter(action => (UNIT_ACTIONS as readonly string[]).includes(action.id));
  const orders = actionsOf(object).filter(action => isOrderAction(action.id));
  const [selected, setSelected] = React.useState<UnitPanelActionId | null>(null);
  const [target, setTarget] = React.useState('');
  const [preview, setPreview] = React.useState<PreviewState | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generation = React.useRef(0);
  // Lock sincrono: due click nello stesso frame non possono superare il
  // `disabled` del render e inviare due dry-run/mutazioni.
  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);

  const reset = React.useCallback(() => {
    generation.current += 1;
    setSelected(null);
    setTarget('');
    setPreview(null);
    if (!inFlight.current) setPending(false);
    setError(null);
  }, []);

  // Anche un nuovo Operating Picture con lo stesso ID invalida la preview:
  // availability, target e blockedReason potrebbero essere cambiati.
  React.useEffect(() => reset(), [object, picture, snapshotKey, reset]);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  if (actions.length === 0 && orders.length === 0) return null;

  const needsTarget = selected === 'transfer_unit' || selected === 'reassign_unit';
  const options = selected === 'transfer_unit'
    ? regionTargets(picture, object)
    : selected === 'reassign_unit' ? armyTargets(picture, object) : [];

  const invoke = async (command: UnitPanelCommand) => command.kind === 'order'
    ? onUnitOrder?.(command.request)
    : onUnitAction?.(command.request);

  const runPreview = async () => {
    if (!selected || inFlight.current) return;
    const command = unitPanelCommand({ actionId: selected, unitId: object.id, target, dryRun: true });
    const request = ++generation.current;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      const impact = await invoke(command);
      if (request !== generation.current || !impact) return;
      setPreview({ impact, command });
    } catch {
      if (request === generation.current) {
        setPreview(null);
        setError('Anteprima non disponibile. Lo stato non è stato modificato.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const confirm = async () => {
    if (!preview || inFlight.current) return;
    const command = confirmedUnitPanelCommand(preview.command);
    const request = ++generation.current;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const impact = await invoke(command);
      if (request !== generation.current || !impact) return;
      if (impact.applied) reset();
      else {
        setPreview(null);
        setError(('blockedReason' in impact && impact.blockedReason) || impact.note || 'Azione non applicata. Richiedi una nuova anteprima.');
      }
    } catch {
      if (request === generation.current) {
        setPreview(null);
        setError('Azione non applicata. Richiedi una nuova anteprima.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const choose = (action: OperatingActionPayload) => {
    if (pending || inFlight.current || !action.enabled) return;
    generation.current += 1;
    setSelected(action.id as UnitPanelActionId);
    setTarget('');
    setPreview(null);
    setError(null);
  };

  return (
    <div className="obj-unit-actions" role="group" aria-label={`Azioni su ${object.label}`} data-unit-action-panel={object.id}>
      <div className="obj-object-actions">
        {actions.map(action => <button key={action.id} type="button"
          className={`obj-action-button ${selected === action.id ? 'active' : ''}`}
          disabled={!action.enabled || busy || pending} title={action.blockedReason ?? undefined}
          onClick={() => choose(action)}>{action.label}</button>)}
      </div>
      {orders.length > 0 && <div className="obj-unit-orders" role="group" aria-label={`Mosse del fronte per ${object.label}`}>
        <span className="obj-unit-orders-title">Mosse sul fronte</span>
        <div className="obj-object-actions">{orders.map(action => <button key={action.id} type="button"
          className={`obj-action-button ${selected === action.id ? 'active' : ''}`}
          disabled={!action.enabled || busy || pending} title={action.blockedReason ?? undefined}
          onClick={() => choose(action)}>{action.label}</button>)}</div>
      </div>}
      {actions.concat(orders).some(action => !action.enabled && action.blockedReason) && <ul className="obj-blocked-hint">
        {actions.concat(orders).filter(action => !action.enabled && action.blockedReason).map(action =>
          <li key={action.id}><b>{action.label}:</b> {action.blockedReason}</li>)}
      </ul>}
      {selected && needsTarget && <div className="obj-unit-target"><label>
        {selected === 'transfer_unit' ? 'Regione di destinazione' : 'Armata di destinazione'}
        <select value={target} disabled={pending || busy} onChange={event => {
          if (inFlight.current) return;
          generation.current += 1;
          setTarget(event.target.value);
          setPreview(null);
          setError(null);
        }}>
          <option value="">— scegli —</option>
          {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label></div>}
      {selected && <div className="obj-action-buttons">
        <button type="button" className="obj-confirm" disabled={pending || busy || (needsTarget && !target)}
          onClick={() => { void runPreview(); }}>{pending ? 'In corso…' : 'Anteprima'}</button>
        <button type="button" className="obj-cancel" disabled={pending || busy} onClick={reset}>Chiudi</button>
      </div>}
      {error && <p className="obj-blocked tone-negative" role="alert">{error}</p>}
      {preview && <ActionImpact
        view={'order' in preview.impact ? unitOrderView(preview.impact) : unitActionView(preview.impact)}
        busy={pending || busy}
        onConfirm={() => { void confirm(); }}
        onCancel={() => { generation.current += 1; setPreview(null); setError(null); }}
      />}
    </div>
  );
}

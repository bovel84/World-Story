/**
 * World Story — Fase 2: `useNationSnapshot`
 * ========================================
 * Il «Dossier Nazione» è stato per anni una trentina di `useState` sparsi in
 * `App.tsx`, mescolati a effetti di caricamento e alle azioni economiche che
 * li aggiornano. Questo hook possiede quella porzione di stato — conti,
 * storico, magazzino, arsenale, governo, fisco, sfide di pace, crisi, voci del
 * consiglio e promemoria dei mandati — e le azioni che la mutano.
 *
 * Contratto (comportamento invariato rispetto ad `App.tsx`):
 *  - il caricamento avviene al cambio partita e al cambio turno;
 *  - le voci del consiglio appartengono al turno e vengono azzerate a ogni
 *    cambio: rigenerate su richiesta quando si apre la scheda Governo;
 *  - nessuna azione materiale si applica finché il motore non risponde: qui si
 *    aggiorna solo lo snapshot pubblicato dal server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  gameApi,
  type CrisisSnapshot,
  type Commitment,
  type PowerAgenda,
  type FiscalPolicyInfo,
  type GameEnding,
  type GovernmentSnapshot,
  type GovernmentVoicesResponse,
  type PeacetimePressure,
  type FormationImpactPayload,
  type UnitActionImpactPayload,
  type UnitActionRequest,
  type UnitOrderImpactPayload,
  type UnitOrderRequest,
  type MilitaryUnitPayload,
  type WarFrontPayload,
} from '../services/api';
import { normalizeResources } from '../components/Game/nationDossier';

export type NationalResources = Awaited<ReturnType<typeof normalizeResources>>;
export type NationalArms = Awaited<ReturnType<typeof gameApi.arsenal>>;
/** OP-OBJECTS — parametri della creazione di reparti (armata esistente o nuova). */
export interface FormationOptions { formations?: number; armyId?: string | null; name?: string }
export type NationalAccountMap = Record<string, any>;
export interface NationalHistoryEntry {
  date: string;
  turn?: number;
  account: Record<string, any>;
}

export interface MandateDecision {
  mandateId: string;
  kind: string;
  resourceId: string;
  minStock: string;
  availableStock: string;
  shortfall: string;
  asOfDate: string;
  status: string;
}

/** M07 passo 2 — obblighi di manutenzione degli impianti (proiezione read-only). */
export interface MaintenanceObligationView {
  facilityId: string;
  typeId: string;
  typeName: string;
  regionId: string;
  operational: boolean;
  resourceId: string;
  baseUnits: string;
  periodDays: number;
  available: string;
  sufficient: boolean;
  shortfall: string;
}

export type NotifyFn = (message: string, kind?: 'info' | 'success' | 'error') => void;

export interface UseNationSnapshotOptions {
  gameId: string | null;
  currentTurn: number | undefined;
  currentDate?: string;
  worldRevision?: number;
  headBranchId?: string | null;
  notify: NotifyFn;
}

export interface NationSnapshot {
  nationalAccounts: NationalAccountMap;
  setNationalAccounts: React.Dispatch<React.SetStateAction<NationalAccountMap>>;
  nationalHistory: NationalHistoryEntry[];
  setNationalHistory: React.Dispatch<React.SetStateAction<NationalHistoryEntry[]>>;
  nationalResources: NationalResources;
  setNationalResources: React.Dispatch<React.SetStateAction<NationalResources>>;
  nationalArms: NationalArms | null;
  setNationalArms: React.Dispatch<React.SetStateAction<NationalArms | null>>;
  nationalGovernment: GovernmentSnapshot | null;
  setNationalGovernment: React.Dispatch<React.SetStateAction<GovernmentSnapshot | null>>;
  nationalFiscalPolicy: FiscalPolicyInfo | null;
  setNationalFiscalPolicy: React.Dispatch<React.SetStateAction<FiscalPolicyInfo | null>>;
  fiscalPolicyBusy: boolean;
  nationalPressures: PeacetimePressure[];
  setNationalPressures: React.Dispatch<React.SetStateAction<PeacetimePressure[]>>;
  recentPressures: PeacetimePressure[];
  setRecentPressures: React.Dispatch<React.SetStateAction<PeacetimePressure[]>>;
  pressureBusy: boolean;
  nationalCrisis: CrisisSnapshot | null;
  /** GAMEPLAY-LONG: obiettivi persistenti delle potenze del teatro. */
  strategicAgenda: { powers: PowerAgenda[] } | null;
  /** Registro strutturato degli impegni (trattati, promesse, ultimatum). */
  commitments: { commitments: Commitment[]; attention: Commitment[] } | null;
  setNationalCrisis: React.Dispatch<React.SetStateAction<CrisisSnapshot | null>>;
  gameEnding: GameEnding | null;
  setGameEnding: React.Dispatch<React.SetStateAction<GameEnding | null>>;
  governmentVoices: GovernmentVoicesResponse | null;
  setGovernmentVoices: React.Dispatch<React.SetStateAction<GovernmentVoicesResponse | null>>;
  governmentVoicesLoading: boolean;
  governmentVoicesError: string | null;
  setGovernmentVoicesError: React.Dispatch<React.SetStateAction<string | null>>;
  mandateDecisions: MandateDecision[];
  setMandateDecisions: React.Dispatch<React.SetStateAction<MandateDecision[]>>;
  maintenanceObligations: MaintenanceObligationView[];
  /** MAP P2 — read model militare persistente globale (player + NPC). */
  militaryUnits: MilitaryUnitPayload[];
  militaryFronts: WarFrontPayload[];
  militaryStateLoading: boolean;
  militaryStateError: string | null;
  refreshMilitaryState: () => Promise<void>;
  /** Azzera l'intero snapshot (nessuna partita attiva). */
  resetNational: () => void;
  procureEquipment: (mode: 'build' | 'buy', equipmentId: string, quantity?: number) => Promise<void>;
  /** OP-OBJECTS — anteprima PRIMA → DOPO della creazione di reparti (sola lettura). */
  previewFormation: (options?: FormationOptions) => Promise<FormationImpactPayload>;
  /** OP-OBJECTS — crea davvero i reparti: il motore paga e aggiorna il mondo. */
  raiseFormation: (options?: FormationOptions) => Promise<void>;
  /**
   * MILITARY-UNITS — azione su un reparto: `dryRun` è l'anteprima PRIMA → DOPO,
   * altrimenti il motore applica e i dati pubblicati vengono ricaricati.
   */
  unitAction: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  /**
   * MILITARY-UNITS PR2 — mossa di un reparto sul fronte (Attacca · Difendi ·
   * Riserva · Ripiega): `dryRun` è l'anteprima, altrimenti il motore applica.
   */
  unitOrder: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
  tradeNaturalResource: (mode: 'sell' | 'buy', resourceId: string, quantity: number) => Promise<void>;
  borrowSovereignDebt: (amountMld: number, termYears: number) => Promise<void>;
  setFiscalPolicy: (taxRatePct: number) => Promise<void>;
  resolvePressure: (pressureId: string, optionId: string) => Promise<void>;
  loadGovernmentVoices: () => Promise<void>;
  acknowledgeMandateDecision: (mandateId: string, kind: string) => Promise<void>;
}

export function useNationSnapshot({
  gameId,
  currentTurn,
  currentDate,
  worldRevision,
  headBranchId,
  notify,
}: UseNationSnapshotOptions): NationSnapshot {
  const [nationalAccounts, setNationalAccounts] = useState<NationalAccountMap>({});
  const [nationalHistory, setNationalHistory] = useState<NationalHistoryEntry[]>([]);
  const [nationalResources, setNationalResources] = useState<NationalResources>(null);
  const [nationalArms, setNationalArms] = useState<NationalArms | null>(null);
  const [nationalGovernment, setNationalGovernment] = useState<GovernmentSnapshot | null>(null);
  const [nationalFiscalPolicy, setNationalFiscalPolicy] = useState<FiscalPolicyInfo | null>(null);
  const [fiscalPolicyBusy, setFiscalPolicyBusy] = useState(false);
  const [nationalPressures, setNationalPressures] = useState<PeacetimePressure[]>([]);
  const [recentPressures, setRecentPressures] = useState<PeacetimePressure[]>([]);
  const [pressureBusy, setPressureBusy] = useState(false);
  const [nationalCrisis, setNationalCrisis] = useState<CrisisSnapshot | null>(null);
  const [strategicAgenda, setStrategicAgenda] = useState<{ powers: PowerAgenda[] } | null>(null);
  const [commitments, setCommitments] = useState<{ commitments: Commitment[]; attention: Commitment[] } | null>(null);
  const [gameEnding, setGameEnding] = useState<GameEnding | null>(null);
  const [governmentVoices, setGovernmentVoices] = useState<GovernmentVoicesResponse | null>(null);
  const [governmentVoicesLoading, setGovernmentVoicesLoading] = useState(false);
  const [governmentVoicesError, setGovernmentVoicesError] = useState<string | null>(null);
  const [mandateDecisions, setMandateDecisions] = useState<MandateDecision[]>([]);
  const [maintenanceObligations, setMaintenanceObligations] = useState<MaintenanceObligationView[]>([]);
  const [militaryUnits, setMilitaryUnits] = useState<MilitaryUnitPayload[]>([]);
  const [militaryFronts, setMilitaryFronts] = useState<WarFrontPayload[]>([]);
  const [militaryStateLoading, setMilitaryStateLoading] = useState(false);
  const [militaryStateError, setMilitaryStateError] = useState<string | null>(null);
  const militaryRequest = useRef(0);

  const resetNational = useCallback(() => {
    setNationalAccounts({});
    setNationalHistory([]);
    setNationalResources(null);
    setNationalArms(null);
    setNationalGovernment(null);
    setNationalFiscalPolicy(null);
    setNationalPressures([]);
    setRecentPressures([]);
    setNationalCrisis(null);
    setGameEnding(null);
    setGovernmentVoices(null);
    setGovernmentVoicesError(null);
    setMandateDecisions([]);
    setMaintenanceObligations([]);
    setMilitaryUnits([]);
    setMilitaryFronts([]);
    setMilitaryStateLoading(false);
    setMilitaryStateError(null);
    militaryRequest.current += 1;
  }, []);

  /**
   * MAP P2 — units e fronts condividono un solo lifecycle. Sono una proiezione
   * delle API persistenti, mai uno stato militare parallelo della mappa.
   */
  const refreshMilitaryState = useCallback(async () => {
    if (!gameId) return;
    const request = ++militaryRequest.current;
    setMilitaryStateLoading(true);
    setMilitaryStateError(null);
    try {
      const [unitResponse, frontResponse] = await Promise.all([
        gameApi.militaryUnits(gameId),
        gameApi.militaryFronts(gameId),
      ]);
      if (request !== militaryRequest.current) return;
      setMilitaryUnits(unitResponse.units || []);
      setMilitaryFronts(frontResponse.fronts || []);
    } catch (error) {
      if (request !== militaryRequest.current) return;
      console.warn('[App] Situazione militare non disponibile:', error);
      // Fail closed: lo stato operativo attuale è una fotografia, non una cache.
      // Uno snapshot precedente non deve restare visibile come se fosse corrente
      // (advance, rewind, restore, branch change o load potrebbero averlo reso falso).
      setMilitaryUnits([]);
      setMilitaryFronts([]);
      setMilitaryStateError('Situazione militare non disponibile');
    } finally {
      if (request === militaryRequest.current) setMilitaryStateLoading(false);
    }
  }, [gameId]);

  // Non mostrare mai per un istante i reparti della partita precedente.
  useEffect(() => {
    setMilitaryUnits([]);
    setMilitaryFronts([]);
    setMilitaryStateError(null);
  }, [gameId]);

  // Turno, data, revisione e ramo coprono advance, checkpoint, rewind e load.
  useEffect(() => {
    if (!gameId) return;
    void refreshMilitaryState();
  }, [gameId, currentTurn, currentDate, worldRevision, headBranchId, refreshMilitaryState]);

  // Il bollettino usa dati aggregati dal motore, non formule del browser.
  useEffect(() => {
    if (!gameId) {
      resetNational();
      return;
    }
    // Cambia il turno: le voci del consiglio appartengono al turno e vanno rigenerate.
    setGovernmentVoices(null);
    setGovernmentVoicesError(null);
    let cancelled = false;
    // Il conto nazionale è disponibile anche nei giochi legacy; le decisioni
    // mandato appartengono invece solo al percorso strict e un 409 significa
    // semplicemente «nessuna decisione applicabile», non un errore del dossier.
    gameApi.nationalState(gameId)
      .then((national) => {
        if (!cancelled) {
          setNationalAccounts(national.accounts || {});
          setNationalHistory(national.history || []);
          setNationalResources(normalizeResources(national.resources));
          setNationalGovernment(national.government ?? null);
          setNationalFiscalPolicy(national.fiscalPolicy ?? null);
          setNationalCrisis(national.crisis ?? null);
          setStrategicAgenda(national.strategicAgenda ?? null);
          setCommitments(national.commitments ?? null);
          setGameEnding(national.crisis?.ending ?? null);
        }
      })
      .catch(error => console.warn('[App] Impossibile caricare il conto nazionale:', error));
    // Le sfide di pace nascono dal motore e vivono nel dossier: leggerle qui
    // evita che un turno senza sfide visibili sembri vuoto.
    gameApi.peacetimePressures(gameId)
      .then((data) => { if (!cancelled) { setNationalPressures(data.pressures || []); setRecentPressures(data.recent || []); } })
      .catch(error => console.warn('[App] Impossibile caricare le sfide del momento:', error));
    gameApi.arsenal(gameId)
      .then((arms) => { if (!cancelled) setNationalArms(arms); })
      .catch(error => console.warn('[App] Impossibile caricare l’arsenale:', error));
    gameApi.mandateDecisions(gameId)
      .then((decisions) => {
        if (!cancelled) {
          setMandateDecisions(decisions.decisions || []);
          setMaintenanceObligations(decisions.maintenance || []);
        }
      })
      .catch((error: any) => {
        if (!cancelled) { setMandateDecisions([]); setMaintenanceObligations([]); }
        if (error?.status !== 409) console.warn('[App] Impossibile caricare le decisioni mandato:', error);
      });
    return () => { cancelled = true; };
  }, [gameId, currentTurn, resetNational]);

  const acknowledgeMandateDecision = useCallback(async (mandateId: string, kind: string) => {
    if (!gameId) return;
    try {
      await gameApi.acknowledgeMandateDecision(gameId, mandateId, kind);
      setMandateDecisions((previous) => previous.filter((item) => !(item.mandateId === mandateId && item.kind === kind)));
      notify('Promemoria del mandato registrato.', 'success');
    } catch (error) {
      console.error('[App] Impossibile registrare la decisione mandato:', error);
      notify('Impossibile registrare il promemoria del mandato.', 'error');
    }
  }, [gameId, notify]);

  // Le anime del governo parlano con il motore LLM: una chiamata on-demand per
  // turno, quando il giocatore apre la scheda Governo. Se il modello non
  // risponde, la scheda resta utilizzabile con la richiesta deterministica.
  const governmentVoicesRequestedRef = useRef<string | null>(null);
  const loadGovernmentVoices = useCallback(async () => {
    if (!gameId) return;
    // Un tentativo per turno: un errore non deve innescare un ciclo di retry.
    const requestKey = `${gameId}:${currentTurn ?? 0}`;
    if (governmentVoicesRequestedRef.current === requestKey) return;
    governmentVoicesRequestedRef.current = requestKey;
    setGovernmentVoicesLoading(true);
    setGovernmentVoicesError(null);
    try {
      const voices = await gameApi.governmentVoices(gameId);
      setGovernmentVoices(voices);
    } catch (error) {
      console.warn('[App] Impossibile far parlare il consiglio:', error);
      setGovernmentVoicesError('Il consiglio non ha risposto: restano le richieste ufficiali.');
    } finally {
      setGovernmentVoicesLoading(false);
    }
  }, [gameId, currentTurn]);

  // Costruisci o importa equipaggiamento: aggiorna arsenale e scorte.
  const procureEquipment = useCallback(async (mode: 'build' | 'buy', equipmentId: string, quantity = 1) => {
    if (!gameId) return;
    try {
      const result = await gameApi.procure(gameId, mode, equipmentId, quantity);
      if (result.complete) {
        notify(`Importati ${result.quantity} × ${result.name}.`, 'success');
      } else {
        notify(`Ordine avviato: ${result.quantity} × ${result.name} — completamento ${result.order?.progress ?? 0}%.`, 'success');
      }
      if (result.financedMln > 0) {
        notify(`Spesa finanziata a debito: ${(result.financedMln / 1000).toFixed(3)} mld (debito ${result.debtMld.toFixed(2)} mld).`, 'info');
      }
      const [arms, national] = await Promise.all([
        gameApi.arsenal(gameId),
        gameApi.nationalState(gameId),
      ]);
      setNationalArms(arms);
      setNationalResources(normalizeResources(national.resources));
      setNationalAccounts(national.accounts || {});
      setNationalGovernment(national.government ?? null);
    } catch (error: any) {
      console.error('[App] Procurement fallito:', error);
      const message = String(error?.message || '');
      const reason = message.includes('credit_exhausted') ? 'Cassa e credito insufficienti: debito al limite.'
        : message.includes('build_unavailable') ? 'Capacità insufficienti per costruire questa arma.'
        : message.includes('equipment_quantity_invalid') ? 'Quantità richiesta troppo grande.'
        : 'Acquisto non riuscito.';
      notify(reason, 'error');
    }
  }, [gameId, notify]);

  /**
   * OP-OBJECTS — creazione di reparti. Il motore calcola l'anteprima PRIMA → DOPO
   * e, alla conferma, paga il materiale, scala il deposito e aggiunge l'armata al
   * mondo: qui si ricaricano soltanto i dati pubblicati, senza ricalcolare nulla.
   */
  const previewFormation = useCallback(async (options: FormationOptions = {}) => {
    if (!gameId) throw new Error('formation_blocked: nessuna partita attiva');
    return gameApi.formationPreview(gameId, options);
  }, [gameId]);

  const raiseFormation = useCallback(async (options: FormationOptions = {}) => {
    if (!gameId) return;
    try {
      const result = await gameApi.raiseFormation(gameId, options);
      notify(
        `${result.formations > 1 ? `${result.formations} reparti` : result.name} in linea${result.regionName ? ` a ${result.regionName}` : ''}: ${result.spentMln >= 1000 ? `${(result.spentMln / 1000).toFixed(3)} mld` : `${Math.round(result.spentMln)} mln`} di materiale.`,
        'success',
      );
      if (result.financedMln > 0) {
        notify(`Spesa finanziata a debito: ${(result.financedMln / 1000).toFixed(3)} mld.`, 'info');
      }
      const [arms, national] = await Promise.all([
        gameApi.arsenal(gameId),
        gameApi.nationalState(gameId),
        refreshMilitaryState(),
      ]);
      setNationalArms(arms);
      setNationalResources(normalizeResources(national.resources));
      setNationalAccounts(national.accounts || {});
      setNationalGovernment(national.government ?? null);
    } catch (error: any) {
      console.error('[App] Formazione reparto fallita:', error);
      const message = String(error?.message || '');
      const reason = message.includes('formation_blocked')
        ? message.replace(/^.*formation_blocked:\s*/, '') || 'Materiale insufficiente per formare il reparto.'
        : message.includes('credit_exhausted') ? 'Cassa e credito insufficienti: debito al limite.'
        : 'Reparto non formato.';
      notify(reason, 'error');
    }
  }, [gameId, notify, refreshMilitaryState]);

  /**
   * MILITARY-UNITS — azione su un reparto (Rinforza · Riequipaggia · Trasferisci
   * · Cambia armata). Il motore decide e applica; qui si ricaricano soltanto i
   * dati pubblicati e, quando l'azione è andata a segno, lo si dice al giocatore.
   */
  /**
   * MILITARY-UNITS PR2 — mossa del reparto sul fronte. Stesso motore degli NPC:
   * qui cambia solo chi sceglie l'ordine. L'anteprima non scrive nulla.
   */
  const unitOrder = useCallback(async (request: UnitOrderRequest) => {
    if (!gameId) throw new Error('unit_unknown: nessuna partita attiva');
    try {
      const result = await gameApi.unitOrder(gameId, request);
      if (request.dryRun) return result;
      notify(result.note, 'success');
      const [arms, national] = await Promise.all([
        gameApi.arsenal(gameId),
        gameApi.nationalState(gameId),
        refreshMilitaryState(),
      ]);
      setNationalArms(arms);
      setNationalResources(normalizeResources(national.resources));
      setNationalAccounts(national.accounts || {});
      setNationalGovernment(national.government ?? null);
      return { ...result, applied: true };
    } catch (error: any) {
      console.error('[App] Ordine del reparto fallito:', error);
      const message = String(error?.message || '');
      const reason = message.includes('front_unknown')
        ? 'Il reparto non e\' in un fronte: nessun ordine da dare.'
        : message.includes('order_unknown')
          ? 'Ordine non riconosciuto dal motore.'
          : message.includes('unit_unknown')
            ? message.replace(/^.*unit_unknown:\s*/, '') || 'Reparto inesistente.'
            : message.replace(/^.*(front_unknown|order_unknown|unit_unknown):\s*/, '') || 'Ordine non applicato.';
      notify(reason, 'error');
      throw error;
    }
  }, [gameId, notify, refreshMilitaryState]);

  const unitAction = useCallback(async (request: UnitActionRequest) => {
    if (!gameId) throw new Error('unit_unknown: nessuna partita attiva');
    try {
      const result = await gameApi.unitAction(gameId, request);
      if (request.dryRun) return result;
      notify(result.blockedReason || result.note, result.blocked ? 'info' : 'success');
      const [arms, national] = await Promise.all([
        gameApi.arsenal(gameId),
        gameApi.nationalState(gameId),
        refreshMilitaryState(),
      ]);
      setNationalArms(arms);
      setNationalResources(normalizeResources(national.resources));
      setNationalAccounts(national.accounts || {});
      setNationalGovernment(national.government ?? null);
      return { ...result, applied: true };
    } catch (error: any) {
      console.error('[App] Azione sul reparto fallita:', error);
      const message = String(error?.message || '');
      const reason = message.includes('unit_unknown')
        ? message.replace(/^.*unit_unknown:\s*/, '') || 'Reparto inesistente.'
        : message.includes('region_unknown') || message.includes('army_unknown')
          ? message.replace(/^.*(region_unknown|army_unknown):\s*/, '') || 'Destinazione non valida.'
          : message.includes('equipment_unknown') || message.includes('unit_invalid')
            ? message.replace(/^.*(equipment_unknown|unit_invalid):\s*/, '') || 'Azione non valida.'
            : 'Azione non eseguita.';
      notify(reason, 'error');
      throw error;
    }
  }, [gameId, notify, refreshMilitaryState]);

  // Vendi o compra una risorsa naturale sul mercato: denaro ↔ magazzino.
  const tradeNaturalResource = useCallback(async (mode: 'sell' | 'buy', resourceId: string, quantity: number) => {
    if (!gameId) return;
    try {
      const result = await gameApi.tradeResource(gameId, mode, resourceId, quantity);
      notify(
        `${mode === 'sell' ? 'Vendute' : 'Comprate'} ${result.quantity} unità di ${result.quote.label} per ${result.total} mld.`,
        'success',
      );
      const national = await gameApi.nationalState(gameId);
      setNationalResources(normalizeResources(national.resources));
      setNationalGovernment(national.government ?? null);
    } catch (error: any) {
      console.error('[App] Scambio risorsa fallito:', error);
      const message = String(error?.message || '');
      const reason = message.includes('insufficient_stockpile') ? 'Magazzino insufficiente per vendere.'
        : message.includes('insufficient_money') ? 'Cassa insufficiente per comprare.'
        : message.includes('resource_not_held') ? 'La nazione non possiede questa risorsa.'
        : message.includes('unknown_resource') ? 'Risorsa sconosciuta.'
        : 'Scambio non riuscito.';
      notify(reason, 'error');
    }
  }, [gameId, notify]);

  // La nazione fa debito: emette titoli per cassa, con interessi e scadenza.
  const borrowSovereignDebt = useCallback(async (amountMld: number, termYears: number) => {
    if (!gameId) return;
    try {
      const result = await gameApi.borrowDebt(gameId, amountMld, termYears);
      notify(
        `Emessi ${result.tranche.principal.toFixed(2)} mld al ${result.tranche.annualRatePct}% a ${termYears} anni: cassa in aumento, interessi ${result.annualInterest.toFixed(2)} mld/anno.`,
        'success',
      );
      const national = await gameApi.nationalState(gameId);
      setNationalResources(normalizeResources(national.resources));
      setNationalAccounts(national.accounts || {});
      setNationalGovernment(national.government ?? null);
    } catch (error: any) {
      console.error('[App] Emissione di debito fallita:', error);
      const message = String(error?.message || '');
      const reason = message.includes('credit_exhausted') ? 'Tetto di credito raggiunto: il mercato non presta oltre.'
        : message.includes('amount_invalid') ? 'Importo non valido: indica una cifra positiva.'
        : 'Emissione non riuscita.';
      notify(reason, 'error');
    }
  }, [gameId, notify]);

  // Politica fiscale: il giocatore sceglie l'aliquota; il motore ricalcola
  // entrate, saldo, stabilità, tensione e crescita. Una manovra brusca lascia
  // un costo politico transitorio (modificatore che poi decade).
  const setFiscalPolicy = useCallback(async (taxRatePct: number) => {
    if (!gameId) return;
    setFiscalPolicyBusy(true);
    try {
      const result = await gameApi.setFiscalPolicy(gameId, taxRatePct);
      setNationalFiscalPolicy(result.policy);
      notify(result.note, 'success');
      const national = await gameApi.nationalState(gameId);
      setNationalAccounts(national.accounts || {});
      setNationalGovernment(national.government ?? null);
      setNationalFiscalPolicy(national.fiscalPolicy ?? result.policy);
    } catch (error: any) {
      console.error('[App] Cambio della politica fiscale fallito:', error);
      notify('Modifica della pressione fiscale non riuscita.', 'error');
    } finally {
      setFiscalPolicyBusy(false);
    }
  }, [gameId, notify]);

  // Risposta a una sfida di pace: modificatori, cassa e relazioni applicati dal
  // motore; poi si rilegge lo stato per allineare dossier e conti.
  const resolvePressure = useCallback(async (pressureId: string, optionId: string) => {
    if (!gameId) return;
    setPressureBusy(true);
    try {
      const result = await gameApi.resolvePeacetimePressure(gameId, pressureId, optionId);
      notify(result.effect?.note || 'Sfida affrontata.', 'success');
      setNationalPressures((previous) => previous.filter((item) => item.id !== pressureId));
      setRecentPressures((previous) => [result.pressure, ...previous].slice(0, 6));
      const [national, pressures] = await Promise.all([
        gameApi.nationalState(gameId),
        gameApi.peacetimePressures(gameId),
      ]);
      setNationalAccounts(national.accounts || {});
      setNationalGovernment(national.government ?? null);
      setNationalResources(normalizeResources(national.resources));
      setNationalPressures(pressures.pressures || []);
      setRecentPressures(pressures.recent || []);
    } catch (error: any) {
      console.error('[App] Risposta alla sfida fallita:', error);
      notify(String(error?.message || 'Non è stato possibile rispondere alla sfida.'), 'error');
    } finally {
      setPressureBusy(false);
    }
  }, [gameId, notify]);

  return {
    nationalAccounts, setNationalAccounts,
    nationalHistory, setNationalHistory,
    nationalResources, setNationalResources,
    nationalArms, setNationalArms,
    nationalGovernment, setNationalGovernment,
    nationalFiscalPolicy, setNationalFiscalPolicy,
    fiscalPolicyBusy,
    nationalPressures, setNationalPressures,
    recentPressures, setRecentPressures,
    pressureBusy,
    nationalCrisis, setNationalCrisis,
    strategicAgenda,
    commitments,
    gameEnding, setGameEnding,
    governmentVoices, setGovernmentVoices,
    governmentVoicesLoading,
    governmentVoicesError, setGovernmentVoicesError,
    mandateDecisions, setMandateDecisions,
    maintenanceObligations,
    militaryUnits,
    militaryFronts,
    militaryStateLoading,
    militaryStateError,
    refreshMilitaryState,
    resetNational,
    procureEquipment,
    previewFormation,
    raiseFormation,
    unitAction,
    unitOrder,
    tradeNaturalResource,
    borrowSovereignDebt,
    setFiscalPolicy,
    resolvePressure,
    loadGovernmentVoices,
    acknowledgeMandateDecision,
  };
}

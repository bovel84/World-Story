/**
 * WS-GOV-COUNCIL-ANCHORS — ANCHOR LAYER deterministico.
 *
 * Perché esiste: le RealitySignal dicono ciò che **merita attenzione** (crisi,
 * stress, follow-up). Quando nessuna soglia scatta il Consulente vede comunque
 * un'opportunità, la racconta in prosa, ma non ha una `signalKey` valida a cui
 * agganciare la proposta: la scheda `council_issue` non nasce.
 *
 * Un **anchor** NON è una crisi, una Pressure o una quest. È solo un appiglio
 * canonico — un fatto che il motore ha realmente misurato — che permette al
 * Consulente di formulare una proposta verificabile anche senza criticità.
 * Gli anchor sono **fonti possibili**, non un'agenda: il modello non è obbligato
 * a proporre nulla e il server non genera alcuna scheda da sé.
 *
 * Il server risolve gli anchor esattamente come le signal: chiave sconosciuta →
 * reject, `factKeys`/`sourceRefs` sempre ricalcolati lato server.
 */
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import { buildRealitySignals, type RealitySignalDomain } from './RealitySignals';
import { MAX_COUNCIL_ISSUES } from './CouncilIssue';

export interface CouncilProposalAnchor {
  key: string;
  domain: RealitySignalDomain;
  factKeys: string[];
  sourceRefs: string[];
  reason: string;
}

/** Cap tecnico di sicurezza: NON è una quota da riempire. */
export const MAX_COUNCIL_ANCHORS = 24;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Tutti gli appigli canonici disponibili:
 *  1. ogni RealitySignal (un problema misurabile è anche una fonte valida);
 *  2. pochi anchor di OPPORTUNITÀ, solo quando i dati canonici esistono davvero.
 * Mai uno per ogni valore del Dossier: al massimo uno per categoria.
 */
export function buildCouncilProposalAnchors(snapshot: VerifiedWorldSnapshot): CouncilProposalAnchor[] {
  const anchors: CouncilProposalAnchor[] = [];
  const seen = new Set<string>();
  const has = (key: string) => Object.prototype.hasOwnProperty.call(snapshot.facts, key);
  const ref = (key: string): string | undefined => snapshot.facts[key]?.sourceRef;
  const present = (keys: readonly string[]) => keys.filter(has);
  const push = (anchor: CouncilProposalAnchor): void => {
    if (seen.has(anchor.key)) return;
    // Un anchor vive con almeno un fatto o un riferimento canonico, mai a vuoto.
    if (!anchor.factKeys.length && !anchor.sourceRefs.length) return;
    seen.add(anchor.key);
    anchors.push(anchor);
  };

  // 1. Riusa gli stessi segnali (già limitati al cap che il prompt mostra):
  // nessuna seconda realtà, nessun nuovo giudizio, nessun segnale in più.
  for (const signal of buildRealitySignals(snapshot).slice(0, MAX_COUNCIL_ISSUES)) {
    push({ key: signal.key, domain: signal.domain, factKeys: signal.factKeys, sourceRefs: signal.sourceRefs, reason: signal.reason });
  }

  // 2. OPPORTUNITÀ — solo se il motore pubblica il dato. Niente stime.

  // Capacità economica: cassa disponibile o saldo mensile non negativo.
  const treasury = finite(snapshot.facts.treasury?.rawValue);
  const balance = finite(snapshot.facts.monthlyBalance?.rawValue);
  if ((treasury !== null && treasury > 0) || (balance !== null && balance >= 0)) {
    const factKeys = present(['treasury', 'monthlyBalance', 'nominalGdpUsdBillions']);
    push({
      key: 'capacity-economy', domain: 'economy', factKeys,
      sourceRefs: factKeys.map(ref).filter((value): value is string => Boolean(value)),
      reason: treasury !== null && treasury > 0
        ? `cassa disponibile: ${snapshot.facts.treasury.value}`
        : `saldo mensile non negativo: ${snapshot.facts.monthlyBalance.value}`,
    });
  }

  // Margine di credito: debito/PIL contenuto o interessi leggeri sulle entrate.
  const debtRatio = finite(snapshot.facts.debtRatioPct?.rawValue);
  const debtService = finite(snapshot.facts.debtServicePct?.rawValue);
  if ((debtRatio !== null && debtRatio < 60) || (debtService !== null && debtService < 10)) {
    const factKeys = present(['debtRatioPct', 'debtServicePct', 'nominalGdpUsdBillions']);
    push({
      key: 'capacity-credit', domain: 'economy', factKeys,
      sourceRefs: factKeys.map(ref).filter((value): value is string => Boolean(value)),
      reason: debtRatio !== null
        ? `debito/PIL contenuto: ${snapshot.facts.debtRatioPct.value}`
        : `interessi leggeri sulle entrate: ${snapshot.facts.debtServicePct.value}`,
    });
  }

  // Infrastrutture realmente presenti sulla mappa.
  const infrastructureKeys = ['factories', 'ports', 'railways', 'roads', 'airfields'] as const;
  const infrastructureCounts = infrastructureKeys
    .map(key => [key, snapshot.infrastructure[key]?.length ?? 0] as const)
    .filter(([, count]) => count > 0);
  if (infrastructureCounts.length) {
    push({
      key: 'capacity-infrastructure', domain: 'infrastructure',
      factKeys: present(infrastructureKeys.filter(key => (snapshot.infrastructure[key]?.length ?? 0) > 0)),
      sourceRefs: infrastructureCounts.flatMap(([key]) => (snapshot.infrastructure[key] ?? []).map(asset => asset.sourceRef)),
      reason: infrastructureCounts.map(([key, count]) => `${count} ${key}`).join(', '),
    });
  }

  // Ricerca e università: capacità scientifica già disponibile.
  const research = finite(snapshot.facts['resources.research']?.rawValue);
  const universities = (snapshot.infrastructure.other ?? [])
    .filter(asset => asset.type === 'university' || asset.type === 'ft_university');
  if ((research !== null && research > 0) || universities.length) {
    push({
      key: 'capacity-research', domain: 'infrastructure',
      factKeys: present(['resources.research']),
      sourceRefs: [
        ...present(['resources.research']).map(ref),
        ...universities.map(asset => asset.sourceRef),
      ].filter((value): value is string => Boolean(value)),
      reason: research !== null && research > 0
        ? `capacità di ricerca disponibile: ${snapshot.facts['resources.research'].value}`
        : `${universities.length} ${universities.length === 1 ? 'università registrata' : 'università registrate'}`,
    });
  }

  // Capacità militare realmente posseduta (deposito o formazioni sulla mappa).
  const equipmentIds = Object.keys(snapshot.military.equipment ?? {});
  if (equipmentIds.length || snapshot.military.formations.length) {
    push({
      key: 'capacity-military', domain: 'military',
      factKeys: present(['forces', 'mobilized']),
      sourceRefs: [
        ...equipmentIds.map(id => `worldState.arsenal.units.${id}`),
        ...snapshot.military.formations.map(asset => asset.sourceRef),
      ],
      reason: equipmentIds.length
        ? `${equipmentIds.length} ${equipmentIds.length === 1 ? 'tipo di equipaggiamento' : 'tipi di equipaggiamento'} in inventario`
        : `${snapshot.military.formations.length} formazioni registrate`,
    });
  }

  // Relazioni diplomatiche disponibili (non ostili): interlocutori reali.
  const relations = snapshot.diplomacy.relations;
  if (relations) {
    const open = relations.filter(relation => relation.relationship !== 'hostile');
    if (open.length) {
      push({
        key: 'capacity-diplomacy', domain: 'diplomacy', factKeys: [],
        sourceRefs: open.map(relation => relation.sourceRef),
        reason: `${open.length} ${open.length === 1 ? 'relazione disponibile' : 'relazioni disponibili'}`,
      });
    }
  }

  // Programmi/progetti realmente in corso: un cantiere aperto è un appiglio.
  const projects = snapshot.economy.ongoingProjects ?? [];
  if (projects.length) {
    push({
      key: 'capacity-programs', domain: 'project', factKeys: [],
      sourceRefs: projects.map(project => `ongoingProcesses.${project.id}`),
      reason: `${projects.length} ${projects.length === 1 ? 'programma in corso' : 'programmi in corso'}`,
    });
  }

  return anchors.slice(0, MAX_COUNCIL_ANCHORS);
}

/** La sezione per il Consulente: appigli canonici, non un'agenda. */
export function renderCouncilProposalAnchors(snapshot: VerifiedWorldSnapshot): string {
  const anchors = buildCouncilProposalAnchors(snapshot).slice(0, MAX_COUNCIL_ANCHORS);
  return `[COUNCIL PROPOSAL ANCHORS — fatti canonici che possono sostenere una proposta, non un elenco da recitare]\n${JSON.stringify(anchors)}`;
}

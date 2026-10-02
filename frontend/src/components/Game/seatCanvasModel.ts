/**
 * World Story — WS-GOVOFFICE-07: la TELA della sedia (read model dei blocchi)
 * ==========================================================================
 * Lo spazio a destra della seduta smette di essere un'etichetta e diventa una
 * **tela riutilizzabile**: una lista di **blocchi tipizzati** che il componente
 * `SeatCanvas` rende. Il Tesoro è il primo inquilino; l'aggancio vale per ogni
 * sedia (Stato maggiore per i piani militari, ecc.).
 *
 * Regole, le stesse del pattern Operating Picture — non un'idea nuova:
 *  - i blocchi `metrics` e `chart` **derivano dal read model già in memoria**
 *    (`NationalOperatingPicture` e le stesse sorgenti del dossier). Nessun
 *    numero inventato, nessuna chiamata in più;
 *  - i blocchi `strategy` e `ideas` sono **contenuto curato** (autore): la tela
 *    li ospita, il read model non li genera;
 *  - il blocco `map` è la vista **zone → opere** del paese: le zone sono le
 *    regioni che il motore pubblica, l'obiettivo è l'opera che il ministro
 *    chiede di finanziare. Nessuna geometria inventata: si usa `svgPath` se c'è.
 *
 * Il modulo è puro e deterministico: stesso input ⇒ stessi blocchi.
 */
import type { CabinetAddressView } from '../../services/api';
import type { NationalOperatingPicture, OperatingDomain } from './nationalOperatingPicture';
import type { NationOperatingPictureSources } from './nationOperatingPictureInput';
import type { EconomyMetric } from './economyOperatingPicture';
import type { DomainStatusLevel, DriverTone } from './domainStatus';
import type { Tone } from './NationDock/types';
import { budgetChart, trendChart, type ChartDataInput, type ChartFigure } from './advisorCharts';
import { formatFigureValue, formatMoney, formatPercent } from '../../utils/format';
import { SEAT_DOMAINS } from './seatDomains';
import { seatBoardConfig } from './seatDecisionBoards';
import type { StrategicPlan } from './strategicPlan';

export type CanvasTone = 'positive' | 'warning' | 'critical' | 'neutral';

/** Normalizza i toni (il Dossier conosce `negative`, il quadro `critical`). */
export function canvasTone(tone: Tone | DriverTone | undefined): CanvasTone {
  if (tone === 'negative' || tone === 'critical') return 'critical';
  if (tone === 'warning' || tone === 'positive' || tone === 'neutral') return tone;
  return 'neutral';
}

/**
 * La classe CSS del tono. Il vocabolario del progetto usa `negative`, non
 * `critical`: qui si traduce una volta sola, così i componenti non ripetono la
 * mappa e `critical` non produce una classe senza stile.
 */
export function toneClass(tone: CanvasTone): string {
  return `tone-${tone === 'critical' ? 'negative' : tone}`;
}

/** Una cifra già formattata: il componente non calcola nulla. */
export interface CanvasMetric {
  id: string;
  label: string;
  display: string;
  hint?: string;
  tone: CanvasTone;
}

/** Una zona del paese su cui si può investire. */
export interface CanvasZone {
  id: string;
  name: string;
  /** Grandezza dichiarata che la zona pesa (dal motore). */
  detail: string;
  tone: CanvasTone;
  /** Geometria già pubblicata dal motore (`Region.svgPath`), se c'è. */
  svgPath?: string;
}

/** Un'idea del ministro: contenuto curato, nessun numero. */
export interface CanvasIdea {
  title: string;
  detail: string;
  tone?: CanvasTone;
}

export type SeatCanvasBlock =
  | { kind: 'metrics'; id: string; title: string; note?: string; metrics: CanvasMetric[] }
  | { kind: 'chart'; id: string; title: string; figure: ChartFigure }
  | { kind: 'strategy'; id: string; title: string; plan: StrategicPlan }
  | { kind: 'map'; id: string; title: string; note: string; zones: CanvasZone[]; target?: { label: string; detail: string } | null }
  | { kind: 'ideas'; id: string; title: string; ideas: CanvasIdea[] };

/** Contenuto curato per una sedia: la tela lo ospita, il motore non lo produce. */
export interface SeatCanvasAuthored {
  plan?: StrategicPlan | null;
  ideas?: CanvasIdea[];
  /** L'opera che la sedia chiede di finanziare (obiettivo della mappa). */
  target?: { label: string; detail: string } | null;
}

export interface SeatCanvasInput {
  seat: CabinetAddressView['seat'];
  /** Il quadro operativo nazionale: la sorgente dei blocchi `metrics`. */
  picture: NationalOperatingPicture;
  /** Le stesse sorgenti del dossier: nessuna chiamata in più. */
  sources: NationOperatingPictureSources;
  /** La sedia: le cifre che ha portato in seduta (`items[].figures`). */
  address?: CabinetAddressView | null;
  authored?: SeatCanvasAuthored;
}

/**
 * Le cifre che la sedia ha **portato in seduta** (dal suo `items`), con la loro
 * provenienza. Non si ricalcolano: sono le stesse che il ministro dice.
 */
export function seatFigureMetrics(address: CabinetAddressView | null | undefined): CanvasMetric[] {
  if (!address) return [];
  const seen = new Set<string>();
  const metrics: CanvasMetric[] = [];
  for (const item of address.items) {
    for (const figure of item.figures) {
      if (seen.has(figure.label)) continue;
      seen.add(figure.label);
      metrics.push({
        id: `figura-${figure.label}`,
        label: figure.label,
        display: figure.basis.kind === 'unknown' ? '—' : formatFigureValue(figure.value, figure.unit),
        hint: figure.basis.kind === 'measured'
          ? `misurato · ${figure.basis.source}`
          : figure.basis.kind === 'estimated'
            ? `stimato · ${figure.basis.method}`
            : `dato mancante · ${figure.basis.missing}`,
        tone: figure.basis.kind === 'unknown' ? 'warning' : 'neutral',
      });
    }
  }
  return metrics;
}

/**
 * Le cifre del quadro operativo, formattate. Riunisce due sorgenti che sono la
 * **stessa cosa**: i `facts` di un dominio (popolo, industria, governo…) e le
 * `metrics` dell'economia. Nessuna viene ricalcolata.
 */
export function metricDisplay(metric: EconomyMetric): string {
  if (metric.value === null) return '—';
  if (metric.format === 'pct') return formatPercent(metric.value, 1);
  if (metric.format === 'months') return `${formatMoney(metric.value, { decimals: 1 })} mesi`;
  if (metric.format === 'number') return formatMoney(metric.value, { decimals: 0 });
  return formatMoney(metric.value, { currency: 'mld', decimals: 2, sign: true });
}

/** Le cifre chiave di un dominio, già formattate dal quadro. */
export function domainMetrics(domain: OperatingDomain): CanvasMetric[] {
  return domain.facts.map((fact, index) => ({
    id: `${domain.id}-${index}`,
    label: fact.label,
    display: fact.value,
    tone: canvasTone(fact.tone),
  }));
}

/** Il tono del blocco metriche, dallo stato del dominio/quadro. */
export function statusTone(status: DomainStatusLevel): CanvasTone {
  if (status === 'critical' || status === 'fragile') return 'critical';
  if (status === 'pressure') return 'warning';
  if (status === 'healthy') return 'positive';
  return 'neutral';
}

/** Le zone del paese: le regioni del giocatore, per prodotto dichiarato. */
export function zoneBoard(sources: NationOperatingPictureSources, limit = 12): CanvasZone[] {
  const owner = String(sources.account?.polityId ?? '');
  const regions = (sources.regions ?? [])
    .filter(region => !owner || region.owner === owner)
    .filter(region => Number(region.gdp) > 0 || Number(region.population) > 0)
    .sort((a, b) => Number(b.gdp || 0) - Number(a.gdp || 0))
    .slice(0, limit);
  const maxGdp = Math.max(1, ...regions.map(region => Number(region.gdp || 0)));
  return regions.map(region => {
    const gdp = Number(region.gdp || 0);
    const population = Number(region.population || 0);
    const share = gdp / maxGdp;
    return {
      id: region.id,
      name: region.name || region.id,
      detail: `${formatMoney(gdp, { decimals: 0 })} · ${formatMoney(population, { decimals: 0 })} ab.`,
      tone: share >= 0.66 ? 'positive' : share >= 0.33 ? 'neutral' : 'warning',
      ...(region.svgPath ? { svgPath: region.svgPath } : {}),
    };
  });
}

/**
 * Deriva i blocchi della tela per una sedia.
 *
 * - `metrics`: le cifre del quadro operativo dei domini della sedia (mappa
 *   `SEAT_DOMAINS`, trascrizione di `SEAT_READS`); per il Tesoro anche le
 *   metriche dell'economia, che sono le più dense.
 * - `chart`: le figure del motore già disponibili (`advisorCharts`): il
 *   bilancio (dove va il denaro) e il trend storico. Una figura vuota non entra.
 * - `strategy` / `ideas` / `map.target`: contenuto **autore** passato dal
 *   chiamante.
 * - `map`: le zone del paese; se non c'è nessuna regione pubblicata, il blocco
 *   non entra (mai una mappa vuota spacciata per dato).
 */
export function deriveSeatCanvasBlocks(input: SeatCanvasInput): SeatCanvasBlock[] {
  const { seat, picture, sources, authored } = input;
  const blocks: SeatCanvasBlock[] = [];

  // WS-GOV-SEAT-BOARDS — La configurazione della sedia decide **quali evidenze**
  // la tavola può mostrare. Non è un dato nuovo: è il catalogo di `presentation.ts`
  // (`BLOCK_ID_BY_KEY`), e impedisce che una sedia mostri il blocco di un'altra
  // (p.es. il bilancio del Tesoro sulla tavola dei Lavori).
  const allowed = new Set(seatBoardConfig(seat).availableEvidence);

  const domainIds = SEAT_DOMAINS[seat] ?? [];
  const domains = domainIds
    .map(id => picture.domains.find(domain => domain.id === id))
    .filter((domain): domain is OperatingDomain => domain !== undefined);

  // Le cifre che la sedia ha portato: è ciò che il ministro dice in seduta.
  const brought = seatFigureMetrics(input.address);
  if (brought.length > 0 && allowed.has('cifre')) {
    blocks.push({
      kind: 'metrics',
      id: 'cifre-sedia',
      title: 'Le cifre che la sedia porta',
      note: 'I numeri presentati in seduta, ciascuno con la sua provenienza.',
      metrics: brought,
    });
  }

  const metrics: CanvasMetric[] = [];
  for (const domain of domains) metrics.push(...domainMetrics(domain));

  // Il Tesoro aggiunge le metriche dell'economia: PIL, saldo, cassa, debito,
  // servizio del debito. Sono le grandezze che la sedia maneggia davvero.
  if (seat === 'tesoro') {
    for (const metric of picture.economy.metrics) {
      metrics.push({
        id: `economia-${metric.id}`,
        label: metric.label,
        display: metricDisplay(metric),
        hint: metric.hint,
        tone: canvasTone(metric.tone),
      });
    }
  }

  if (metrics.length > 0 && allowed.has('cifre')) {
    blocks.push({
      kind: 'metrics',
      id: 'quadro',
      title: 'Quadro operativo',
      note: 'Le cifre del motore per la materia di questa sedia, con la loro provenienza.',
      metrics,
    });
  }

  const chartInput: ChartDataInput = {
    regions: sources.regions,
    account: sources.account,
    resources: sources.resources,
    budget: sources.government?.budget ?? null,
    history: sources.accountHistory ?? [],
  };

  // «Dove va la spesa» è materia del Tesoro: le altre sedie non mostrano
  // automaticamente la ripartizione del bilancio (difetto B28).
  if (allowed.has('spesa')) {
    const budget = budgetChart(chartInput);
    if (budget.bars.length > 0) {
      blocks.push({ kind: 'chart', id: 'bilancio', title: budget.title, figure: budget });
    }
  }
  if (allowed.has('trend')) {
    const trend = trendChart(chartInput);
    if (trend.series) {
      blocks.push({ kind: 'chart', id: 'trend', title: trend.title, figure: trend });
    }
  }

  if (authored?.plan && allowed.has('piano')) {
    blocks.push({ kind: 'strategy', id: 'piano', title: authored.plan.title, plan: authored.plan });
  }

  const zones = allowed.has('mappa') ? zoneBoard(sources) : [];
  if (zones.length > 0) {
    blocks.push({
      kind: 'map',
      id: 'zone',
      title: 'Zone su cui investire',
      note: 'Le regioni del paese, per prodotto dichiarato dal motore. L’obiettivo è l’opera in attesa.',
      zones,
      target: authored?.target ?? null,
    });
  }

  if (authored?.ideas && authored.ideas.length > 0 && allowed.has('idee')) {
    blocks.push({ kind: 'ideas', id: 'idee', title: 'Le idee del ministro', ideas: authored.ideas });
  }

  return blocks;
}

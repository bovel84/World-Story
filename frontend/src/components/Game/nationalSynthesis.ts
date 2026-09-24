/**
 * World Story — la sintesi della nazione (D03/D04 del piano di chiarezza)
 * ======================================================================
 * Il dossier si apre su una schermata che risponde a tre domande, nell'ordine:
 *
 *  1. **Sto bene o male?** — un giudizio, non quattro numeri.
 *  2. **Cosa mi chiede attenzione adesso?** — **una** lista, ordinata.
 *  3. **Cosa posso fare?** — per ogni voce, l'azione minima.
 *
 * Questo modulo è un **read model puro**: non calcola cifre, non chiama l'API,
 * non conosce React. Compone ciò che il motore pubblica già — il quadro
 * d'insieme (`nationalOperatingPicture`), lo stato di crisi, le sfide di pace
 * con la loro finestra, gli impegni e i processi in scadenza — in una sola
 * lista ordinata. È il requisito **I4** del piano («una sola lista di cose da
 * fare») e il presupposto di **I3** («la sintesi sta davanti al dettaglio»).
 *
 * L'ordinamento non è arbitrario e non è «per gravità» in astratto: prima ciò
 * che **chiude la partita** (la crisi), poi ciò che **scade** (le finestre
 * delle sfide, le scadenze degli impegni, i processi in arrivo), poi il resto.
 * Il tempo che resta è un fatto del motore (`window.daysLeft`), non una stima
 * del client.
 */
import type { Commitment, CrisisSnapshot, PeacetimePressure } from '../../services/api';
import type { NationalProcess } from './nationDossier';
import { pressureWindowText, pressureWindowTone, type PressureWindowView } from './pressureWindow';
import { crisisDaysText, crisisLevelTone } from './crisisPanel';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import type { DriverTone } from './domainStatus';
import type { NationAccount, Tone } from './NationDock/types';

/** Una voce della lista unica: cosa, da dove viene, quanto stringe, cosa fare. */
export interface SynthesisItem {
  /** Chiave stabile: tipo + id, per React e per i test. */
  key: string;
  /** Cosa richiede attenzione, in una riga. */
  title: string;
  /** Da dove viene: crisi, sfida, impegno, progetto, quadro d'insieme. */
  source: 'crisi' | 'sfida' | 'impegno' | 'progetto' | 'sintesi';
  /** Il dominio o l'ambito a cui appartiene, per il rimando. */
  domain: string;
  /** Quanto stringe, in una riga: giorni che restano, scadenza, stato. */
  urgency: string;
  /** L'azione minima. Se non c'è, il campo lo dice — non si inventa. */
  action: string;
  tone: DriverTone;
  /** Sezione del dossier dove la voce si approfondisce. */
  section: 'situazione' | 'governo' | 'progetti' | 'bilancio' | 'risorse' | 'armamenti' | 'conoscenze' | 'politiche';
  /** Priorità di ordinamento: più basso = prima. Vedi `ORDER`. */
  rank: number;
}

export interface NationalSynthesis {
  /** Il giudizio: una frase, non un numero. */
  verdict: string;
  /** Il tono complessivo, dal quadro d'insieme. */
  tone: DriverTone;
  /** La lista unica, già ordinata. Vuota se non c'è nulla da fare. */
  items: SynthesisItem[];
  /** Le cifre che il giudizio riassume, con il rapporto che le rende leggibili. */
  evidence: Array<{ label: string; value: string; tone: DriverTone }>;
}

/** Le fasce di priorità. Il numero è l'ordine, non una gravità astratta. */
const ORDER = {
  /** Chiude la partita: viene prima di tutto. */
  esito: 0,
  /** Scade a giorni: la finestra è del motore, non una stima. */
  scadenza: 1,
  /** Scade in settimane, o è un impegno preso. */
  impegno: 2,
  /** Richiede una decisione ma non ha fretta. */
  attenzione: 3,
} as const;

const asTone = (tone: Tone | undefined): DriverTone => (tone === 'negative' ? 'critical' : (tone ?? 'neutral'));

/**
 * Le voci di **esito**: la crisi. Se una dimensione è critica la partita può
 * finire, quindi nulla la precede. Il testo dei giorni viene dal motore.
 */
function crisisItems(crisis?: Partial<CrisisSnapshot> | null): SynthesisItem[] {
  const state = crisis?.state;
  if (!state?.risks?.length) return [];
  const collapseDays = Math.max(1, Math.floor(Number(state.collapseDays ?? crisis?.collapseDays ?? 1)));
  const items: SynthesisItem[] = [];
  for (const risk of state.risks) {
    if (risk.level === 'calm') continue;
    const days = Number(state.criticalDays?.[risk.dimension] ?? 0);
    items.push({
      key: `crisi:${risk.dimension}`,
      title: risk.title || `Crisi: ${risk.dimension}`,
      source: 'crisi',
      domain: 'Crisi della nazione',
      urgency: crisisDaysText(risk, days, collapseDays),
      action: risk.level === 'critical'
        ? 'Intervieni ora: abbassa il fattore che la alimenta (vedi i driver).'
        : 'Tieni sotto controllo: non peggiorare i driver elencati.',
      tone: asTone(crisisLevelTone(risk.level)),
      section: 'situazione',
      rank: risk.level === 'critical' ? ORDER.esito : ORDER.scadenza,
    });
  }
  return items;
}

/**
 * Le voci di **scadenza**: le sfide di pace con una finestra aperta. La finestra
 * è calcolata dal motore (`daysLeft`, `urgency`): qui si legge, non si stima.
 */
function pressureItems(pressures?: readonly PeacetimePressure[] | null): SynthesisItem[] {
  if (!pressures?.length) return [];
  const items: SynthesisItem[] = [];
  for (const pressure of pressures) {
    if (pressure.status !== 'active') continue;
    const window = (pressure as unknown as { window?: PressureWindowView }).window;
    const imminent = window?.urgency === 'imminente' || window?.expired === true;
    const first = pressure.options?.[0];
    items.push({
      key: `sfida:${pressure.id}`,
      title: pressure.title,
      source: 'sfida',
      domain: pressure.kind === 'external' ? 'Estero' : 'Interno',
      urgency: pressureWindowText(window) || `Aperta dal ${pressure.createdDate}`,
      // L'azione minima è la prima opzione che il motore propone: non una
      // suggerita dal client, ma quella che il gioco mette a disposizione.
      action: first
        ? `${first.label}${pressure.options.length > 1 ? ` (oppure: ${pressure.options.slice(1).map(option => option.label).join(', ')})` : ''}`
        : 'Apri la sfida: le opzioni le propone il motore.',
      tone: asTone(pressureWindowTone(window) || (pressure.severity >= 60 ? 'warning' : 'neutral')),
      section: 'situazione',
      rank: imminent ? ORDER.scadenza : ORDER.attenzione,
    });
  }
  return items;
}

/** Le voci di **impegno**: ciò che la nazione ha promesso, con la scadenza. */
function commitmentItems(
  commitments?: { attention?: Commitment[] } | null,
  today?: string | null,
): SynthesisItem[] {
  const attention = commitments?.attention ?? [];
  const items: SynthesisItem[] = [];
  for (const commitment of attention) {
    const overdue = Boolean(commitment.deadline && today && commitment.deadline < today);
    items.push({
      key: `impegno:${commitment.id}`,
      title: commitment.description || commitment.type,
      source: 'impegno',
      domain: commitment.counterparty ? `Verso ${commitment.counterparty}` : 'Impegno interno',
      urgency: commitment.deadline
        ? `${overdue ? 'Scaduto' : 'Scade'} il ${commitment.deadline}`
        : 'Senza scadenza registrata',
      action: 'Onora l\'impegno o dichiara che non lo farai: ignorarlo ha un costo.',
      tone: overdue ? 'critical' : 'warning',
      section: 'governo',
      rank: overdue ? ORDER.scadenza : ORDER.impegno,
    });
  }
  return items;
}

/**
 * Le voci di **progetto**: i processi in corso che stanno per concludersi. Non
 * tutti i processi meritano la sintesi — solo quelli con una data attesa, che è
 * il fatto che li rende «in scadenza».
 */
function projectItems(
  processes?: readonly NationalProcess[] | null,
  today?: string | null,
): SynthesisItem[] {
  if (!processes?.length) return [];
  const items: SynthesisItem[] = [];
  for (const process of processes) {
    if (!process.expected_date) continue;
    const late = Boolean(today && process.expected_date < today);
    const progress = Number.isFinite(Number(process.progress)) ? Math.round(Number(process.progress)) : null;
    items.push({
      key: `progetto:${process.id}`,
      title: process.title,
      source: 'progetto',
      domain: 'Progetti',
      urgency: late
        ? `Atteso per il ${process.expected_date}: oltre la data`
        : progress !== null
          ? `Atteso per il ${process.expected_date} · ${progress}% realizzato`
          : `Atteso per il ${process.expected_date}`,
      action: process.progress_note || 'Nessuna azione richiesta: il processo procede.',
      tone: late ? 'warning' : 'neutral',
      section: 'progetti',
      rank: late ? ORDER.scadenza : ORDER.impegno,
    });
  }
  return items;
}

/**
 * Le voci dal **quadro d'insieme**: i driver non positivi che il motore segnala
 * nei domini. Sono l'ultima fascia — il quadro li elenca già per gravità — e
 * servono a non perdere ciò che non è né crisi né scadenza.
 */
function pictureItems(picture?: NationalOperatingPicture | null): SynthesisItem[] {
  if (!picture?.attention?.length) return [];
  return picture.attention.map(item => ({
    key: `sintesi:${item.domain}:${item.label}`,
    title: item.label,
    source: 'sintesi' as const,
    domain: item.domain,
    urgency: item.detail || 'Segnalato dal quadro d\'insieme',
    action: 'Apri il dominio: il dettaglio dice su cosa intervenire.',
    tone: item.tone,
    section: 'situazione' as const,
    rank: ORDER.attenzione,
  }));
}

/**
 * La sintesi completa: giudizio, lista unica ordinata, prove del giudizio.
 *
 * L'ordinamento è stabile a parità di fascia — l'ordine di arrivo delle fonti
 * è deterministico — così due letture dello stesso stato danno lo stesso
 * risultato.
 */
export function nationalSynthesis(input: {
  picture?: NationalOperatingPicture | null;
  crisis?: Partial<CrisisSnapshot> | null;
  pressures?: readonly PeacetimePressure[] | null;
  commitments?: { attention?: Commitment[] } | null;
  processes?: readonly NationalProcess[] | null;
  account?: Partial<NationAccount> | null;
  today?: string | null;
}): NationalSynthesis {
  const items = [
    ...crisisItems(input.crisis),
    ...pressureItems(input.pressures),
    ...commitmentItems(input.commitments, input.today),
    ...projectItems(input.processes, input.today),
    ...pictureItems(input.picture),
  ].sort((a, b) => a.rank - b.rank);

  const picture = input.picture;
  // Il giudizio è quello del quadro d'insieme: la sintesi non lo ricalcola.
  const verdict = picture?.headline ?? 'Quadro d\'insieme non ancora pubblicato dal motore.';

  // Le prove: le cifre che il giudizio riassume, con il **rapporto** che le
  // rende interpretabili (invariante I2).
  const evidence: NationalSynthesis['evidence'] = [];
  const economy = picture?.domains?.find(domain => domain.id === 'economia');
  for (const fact of economy?.facts ?? []) evidence.push({ label: fact.label, value: fact.value, tone: fact.tone ?? 'neutral' });
  const government = picture?.domains?.find(domain => domain.id === 'governo');
  for (const fact of government?.facts ?? []) evidence.push({ label: fact.label, value: fact.value, tone: fact.tone ?? 'neutral' });

  // La scala dei domini ha cinque livelli (`healthy`…`critical`): il tono
  // complessivo è la loro traduzione, non una soglia inventata qui.
  const tone: DriverTone = picture?.status === 'critical'
    ? 'critical'
    : picture?.status === 'fragile' || picture?.status === 'pressure' ? 'warning' : 'positive';

  return { verdict, tone, items, evidence };
}

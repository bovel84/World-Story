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
import { formatNumber, formatPercent } from '../../utils/format';

/** Una voce della lista unica: cosa, da dove viene, quanto stringe, cosa fare. */
export interface SynthesisItem {
  /** Chiave stabile: tipo + id, per React e per i test. */
  key: string;
  /** Cosa richiede attenzione, in una riga. */
  title: string;
  /** Da dove viene: crisi, sfida, impegno, progetto, sintesi, occasione. */
  source: 'crisi' | 'sfida' | 'impegno' | 'progetto' | 'sintesi' | 'occasione';
  /**
   * M02 — `true` per le occasioni di sviluppo, `false` per ciò che stringe.
   * La distinzione serve alla vista: le occasioni si mostrano **dopo** le
   * urgenze e con un segno diverso, mai mescolate a una crisi.
   */
  opportunity?: boolean;
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
  /**
   * M02 — le occasioni di sviluppo. Ultime **per costruzione**: un'occasione non
   * deve mai scalzare ciò che stringe. Se il paese è in crisi, la crisi resta in
   * testa e l'occasione scende sotto.
   */
  occasione: 4,
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
 * M02 — le **occasioni**: ciò che il paese potrebbe fare, non ciò che lo minaccia.
 *
 * Il difetto: la sintesi elencava solo crisi, sfide, impegni e problemi. Un
 * giocatore che voleva investire nel proprio popolo — istruzione, sanità,
 * ricerca — leggeva una schermata di sole minacce, e nessuna porta d'ingresso
 * per la via civile. Non era un difetto di dati: il motore pubblica capacità
 * industriale libera, avanzo di cassa, ricerca accumulata e le leve che le
 * fazioni premono. Nessuno le metteva in fila.
 *
 * Le occasioni **non** nascondono le urgenze: hanno l'ultima fascia di priorità
 * (`ORDER.occasione`), quindi restano sotto crisi, scadenze e impegni. E sono
 * affermazioni **derivate da soglie dichiarate**, non inviti generici.
 */
function opportunityItems(picture?: NationalOperatingPicture | null): SynthesisItem[] {
  const items: SynthesisItem[] = [];
  const push = (item: Omit<SynthesisItem, 'source' | 'opportunity' | 'rank'>) => {
    items.push({ ...item, source: 'occasione', opportunity: true, rank: ORDER.occasione });
  };

  const people = picture?.people;
  const industry = picture?.industry;
  const economy = picture?.economy;

  // 1. Capacità industriale libera: si può costruire senza sacrificare altro.
  if (industry && industry.capacityFree > 0 && !industry.saturated) {
    push({
      key: 'occasione:capacita-libera',
      title: `${formatNumber(industry.capacityFree)} ${industry.capacityFree === 1 ? 'linea produttiva libera' : 'linee produttive libere'}`,
      domain: 'Industria e produzione',
      urgency: `Capacità usata ${formatPercent(industry.usedPct, 0)}: resta spazio senza togliere nulla alle lavorazioni in corso.`,
      action: 'Avvia un progetto: scuole, ospedali, impianti o ricerca. La capacità c\'è.',
      tone: 'positive',
      section: 'progetti',
    });
  }

  // 2. Avanzo di cassa: si può investire senza nuovo debito.
  if (economy && economy.balance !== null && economy.balance > 0) {
    push({
      key: 'occasione:avanzo',
      title: 'Bilancio in avanzo: si può investire senza nuovo debito',
      domain: 'Economia e cassa',
      urgency: `Il saldo mensile è attivo: ogni mese entra più di quanto esce.`,
      action: 'Alza la spesa civile o avvia un\'opera: l\'avanzo copre l\'investimento.',
      tone: 'positive',
      section: 'bilancio',
    });
  }

  // 3. Ricerca accumulata e non spesa: conoscenza che aspetta di essere usata.
  if (people && people.researchPoints !== null && people.researchPoints > 0) {
    push({
      key: 'occasione:ricerca',
      title: `${formatNumber(people.researchPoints)} punti ricerca da spendere`,
      domain: 'Popolo e benessere',
      urgency: 'La ricerca si accumula a ogni turno: se non la si spende, resta ferma.',
      action: 'Sblocca una tecnologia: la ricerca è già in cassa.',
      tone: 'positive',
      section: 'conoscenze',
    });
  }

  // 4. Atenei assenti: la via civile che manca. È un'occasione **mancata**, e
  //    il tono lo dice: senza atenei la ricerca cresce solo con la popolazione.
  if (people && people.universities === 0) {
    push({
      key: 'occasione:atenei',
      title: 'Nessun ateneo: la ricerca cresce solo con la popolazione',
      domain: 'Popolo e benessere',
      urgency: 'Gli atenei sono la fonte principale di punti ricerca.',
      action: 'Costruisci un ateneo: è la via civile alla conoscenza.',
      tone: 'warning',
      section: 'conoscenze',
    });
  }

  // 5. Spesa civile sottile: il popolo non è una priorità di bilancio, e si può
  //    cambiare. La soglia è dichiarata in `peopleOperatingPicture`.
  if (people && people.civilianShareOfSpendingPct !== null && people.civilianShareOfSpendingPct < 40) {
    push({
      key: 'occasione:spesa-civile',
      title: `Al civile va il ${formatPercent(people.civilianShareOfSpendingPct, 0)} della spesa`,
      domain: 'Popolo e benessere',
      urgency: `Spesa civile ${formatPercent((people.socialBurdenPct ?? 0) + (people.educationBurdenPct ?? 0), 1)} del PIL contro ${formatPercent(people.defenceBurdenPct ?? 0, 1)} alla difesa.`,
      action: 'Sposta spesa verso istruzione, sanità e sostegno: le fazioni civili lo chiedono.',
      tone: 'warning',
      section: 'politiche',
    });
  }

  return items;
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
    ...opportunityItems(input.picture),
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

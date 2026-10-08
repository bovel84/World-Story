/**
 * T05 — I ministri sanno di cosa si parla.
 *
 * Il difetto, misurato il 2026-10-08 sulla partita dell'autore (millennium,
 * Palestina 2000): portata una strada in Consiglio, il ministro degli Esteri
 * apriva con «Presidente, non ho nulla da portare al consiglio in questo
 * momento», mentre una questione era già sul tavolo.
 *
 * Tre strati, tre correzioni. Le prove difendono le invarianti:
 *  - **T-I3** una questione sul tavolo non produce mai il saluto vuoto;
 *  - **T-I6** gli identificatori (anni, risoluzioni, articoli) non sono cifre
 *    del motore, ma le cifre che *misurano* restano intoccabili;
 *  - **T-I5** fuori da una seduta, una sedia senza voci continua a dire di non
 *    avere nulla: è il comportamento giusto, e non deve cambiare.
 */
import { describe, expect, it } from 'vitest';
import { buildMinisterOpeningBrief, deterministicOpeningReply, renderMinisterOpening, validateMinisterOpening, type SituationBrief } from '../src/core/government/MinisterOpening';
import { briefingFor } from '../src/core/government/MinisterChat';
import { narrativeNumbersAreVerified } from '../src/core/government/OpeningNarrative';
import type { CabinetAddress } from '../src/core/government/Cabinet';
import type { GovernmentAgenda } from '../src/core/government/GovernmentAgenda';
import type { MinisterWorldContext } from '../src/prompts/national-context';

const world: MinisterWorldContext = {
  worldName: 'Millennium', country: 'Palestina', currentDate: '2000-01-01', scenarioPremise: '',
  simulationRules: '', nationalContext: '', recentHistory: '', activeCommitments: '', ongoingProcesses: '',
};

/** La questione del 16:40: sul tavolo, senza cifre verificate. */
const gerusalemme: SituationBrief = {
  factsVerified: true,
  title: 'Gerusalemme: mandato per lo statuto finale',
  briefing: 'Il negoziato su confini, rifugiati, insediamenti e Gerusalemme è aperto ma in stallo.',
  decisionQuestion: 'Che mandato diamo al negoziato sullo statuto finale per difendere la rivendicazione su Gerusalemme Est?',
};

const offline = async () => { throw new Error('offline'); };
const emptyAgenda = { voices: [], headline: '', canonicalMutation: false } as unknown as GovernmentAgenda;
const address = (seat: CabinetAddress['seat'], items: CabinetAddress['items']): CabinetAddress =>
  ({ seat, label: '', reads: '', opening: '', items });

describe('T05a — il fallback guarda la situazione (T-I3)', () => {
  it('una situazione SENZA fatti verificati non produce il saluto vuoto', () => {
    const brief = buildMinisterOpeningBrief('esteri', world, [], undefined, gerusalemme);
    const reply = deterministicOpeningReply(brief);
    expect(reply).not.toContain('non ho nulla da portare');
    expect(reply).toContain('Gerusalemme: mandato per lo statuto finale');
    expect(reply).toContain('Che mandato diamo al negoziato');
  });

  it('la stessa situazione, con fatti verificati, parte dal primo fatto', () => {
    const reply = deterministicOpeningReply(buildMinisterOpeningBrief('esteri', world, [], undefined,
      { ...gerusalemme, verifiedFacts: ['Tensione sociale 48/100'] }));
    expect(reply).toContain('partiamo dal dato disponibile');
    expect(reply).toContain('Tensione sociale 48/100');
  });

  it('senza situazione e senza voci resta il saluto vuoto: non si inventa una questione', () => {
    const reply = deterministicOpeningReply(buildMinisterOpeningBrief('guerra', world, []));
    expect(reply).toContain('non ho nulla da portare');
  });

  it('il ramo è raggiunto davvero dal renderer, non solo dalla funzione isolata', async () => {
    const brief = buildMinisterOpeningBrief('esteri', world, [], undefined, gerusalemme);
    const result = await renderMinisterOpening(brief, offline, undefined, 5);
    expect(result.source).toBe('deterministic');
    expect(result.reply).not.toContain('non ho nulla da portare');
  });
});

describe('T05b — il dossier non dichiara il vuoto dentro una seduta (T-I3)', () => {
  it('in seduta, una sedia senza voci NON riceve «Non hai nulla da portare»', () => {
    const context = briefingFor(address('esteri', []), emptyAgenda, undefined, true).context;
    expect(context).not.toContain('Non hai nulla da portare');
    // e riceve invece la ragione per parlare: la questione è sul tavolo.
    expect(context).toContain('la questione è già sul tavolo del Consiglio');
  });

  it('fuori da una seduta il comportamento resta quello di prima (T-I5)', () => {
    const context = briefingFor(address('esteri', []), emptyAgenda, undefined, false).context;
    expect(context).toContain('Non hai nulla da portare');
  });

  it('una sedia CON voci non riceve mai la dichiarazione di vuoto', () => {
    const items = [{ voiceId: 'a', need: 'Bisogno misurato', because: '', urgency: 'ordinaria', figures: [], paths: [] }] as CabinetAddress['items'];
    expect(briefingFor(address('esteri', items), emptyAgenda, undefined, true).context).not.toContain('Non hai nulla da portare');
    expect(briefingFor(address('esteri', items), emptyAgenda, undefined, false).context).not.toContain('Non hai nulla da portare');
  });

  it('il flag arriva dal chiamante vero: il prompt del Consiglio dichiara la seduta', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync(
      new URL('../src/core/government/MinisterDialogue.ts', import.meta.url), 'utf8'));
    expect(source).toContain('const inSession = Boolean(brief.council || brief.sourceIssue)');
    expect(source).toMatch(/briefingFor\(\{[^}]*\}[^)]*inSession\)\.context/);
  });
});

describe('T05c — la prosa con un anno non si respinge (T-I6)', () => {
  const brief = buildMinisterOpeningBrief('esteri', world, [], undefined, gerusalemme);

  it('una prosa naturale senza cifre è accettata', () => {
    const testo = 'Presidente, il negoziato sullo statuto finale è aperto ma in stallo: senza una direzione la piazza tornerà a parlare al posto nostro. Propongo di mandare la delegazione con un mandato rigido sulla città, evitando gesti simbolici che darebbero pretesti a chi vuole rompere il tavolo.';
    expect(validateMinisterOpening(testo, brief)).toBe(true);
  });

  it('«dopo il 1967» e «la risoluzione 242» NON fanno cadere la prosa', () => {
    expect(validateMinisterOpening('Presidente, dopo il 1967 la città è divisa e il negoziato è in stallo. Propongo un mandato rigido sulla città.', brief)).toBe(true);
    expect(validateMinisterOpening('Presidente, la risoluzione 242 resta il riferimento e il negoziato è in stallo. Propongo un mandato rigido sulla città.', brief)).toBe(true);
    expect(validateMinisterOpening('Presidente, l’articolo 80 del trattato va applicato: proponiamo un mandato rigido sulla città.', brief)).toBe(true);
  });

  it('ma una cifra che MISURA resta respinta quando non è verificata', () => {
    // Il controllo opposto: allargare la guardia agli identificatori non deve
    // aprire la porta ai numeri inventati.
    expect(validateMinisterOpening('Presidente, al confine abbiamo schierato 250 carri armati.', brief)).toBe(false);
    expect(narrativeNumbersAreVerified('il debito è al 130%', 'Debito su PIL: 110 %')).toBe(false);
    expect(narrativeNumbersAreVerified('le scorte coprono 12 giorni', 'Scorte: 30 giorni')).toBe(false);
  });

  it('una cifra verificata resta accettata', () => {
    expect(narrativeNumbersAreVerified('il debito è al 110%', 'Debito su PIL: 110 %')).toBe(true);
  });

  it('il confine: un ANNO passa, una cifra travestita da anno no', () => {
    // Questa prova è stata scritta due volte. La prima versione pretendeva che
    // «nel 1867» fosse respinto senza riscontro nel materiale verificato; la
    // prova è caduta, e ad avere ragione era il codice. Un anno nomina un'epoca,
    // non misura una grandezza: la guardia non è un fact checker della storia, e
    // fingerlo sarebbe stato peggio che ammetterlo.
    expect(narrativeNumbersAreVerified('nel 1867 accadde', '')).toBe(true);
    // Ma la stessa parola davanti a una cifra che misura non apre nulla:
    // «dopo il 250» non è una data, è un numero.
    expect(narrativeNumbersAreVerified('dopo il 250 l’assedio finì', '')).toBe(false);
    expect(narrativeNumbersAreVerified('nel 80 per cento dei casi', '')).toBe(false);
  });
});

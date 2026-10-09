/** A discussion proposal, never an engine mutation or a Pressure. */
import { z } from 'zod';
import { shortId } from '../../utils/short-id';
import { CABINET_SEATS, type CabinetSeat } from './Cabinet';
import { buildRealitySignals } from './RealitySignals';
import { buildCouncilProposalAnchors } from './CouncilProposalAnchors';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';
import type { SituationBrief } from './MinisterOpening';

export type CouncilIssueOrigin = 'advisor' | 'president' | 'minister' | 'event' | 'follow-up';
/**
 * P01 — Una **mossa concreta** su una proposta: il titolo immersivo e l'ordine
 * pronto. È la forma di Pax Historia. NON è un fatto e NON è un effetto: è la
 * prosa con cui il giocatore risponde alla questione (invariante P-I1). Per
 * questo non porta cifre né chiavi canoniche — quelle stanno sulla proposta.
 */
export interface CouncilOption {
  /** Titolo immersivo della strategia, 2-6 parole («Costringerli a svelarsi»). */
  title: string;
  /** L'ordine concreto, 20-45 parole, in prima persona plurale, pronto da eseguire. */
  content: string;
}

export interface CouncilIssue {
  id: string;
  title: string;
  question: string;
  /**
   * Legacy: 2-5 mosse concrete conservate per i dati precedenti.
   * Il normale flusso Advisor genera questioni senza soluzioni.
   */
  options?: CouncilOption[];
  /** Chiavi dei segnali canonici che hanno originato la scheda (ricalcolabili dal server). */
  signalKeys?: string[];
  /** Chiavi degli anchor canonici (opportunità) che hanno originato la scheda. */
  anchorKeys?: string[];
  /** Presentation link only; never a replacement for canonical proposal facts. */
  situationId?: string;
  verifiedFacts: Array<{ key: string; label: string; value: string; source: string; sourceRef: string }>;
  suggestedMinisters: CabinetSeat[];
  origin: CouncilIssueOrigin;
  sourceRefs: string[];
  createdDate: string;
}

const key = z.string().trim().min(1).max(240);
/** `factKeys` (legacy) o `signalKeys` (collegamento canonico a una RealitySignal).
 *  Labels, valori e sourceRefs del modello sono sempre scartati. */
export const councilIssueInputSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  question: z.string().trim().min(1).max(600),
  // P01 — le mosse concrete. Opzionali (P-I5): una scheda senza opzioni resta valida.
  // Limiti di lunghezza generosi: la prosa la controlla il prompt, non lo schema.
  options: z.array(z.object({
    title: z.string().trim().min(2).max(80),
    content: z.string().trim().min(10).max(400),
  })).min(2).max(5).optional(),
  situationId: z.string().trim().min(1).max(160).optional(),
  // Liste vuote ammesse: una issue con soli signalKeys torna dal client con
  // `verifiedFacts: []`. La presence di almeno una fonte è richiesta dal refine.
  factKeys: z.array(key).max(24).optional(),
  verifiedFacts: z.array(z.object({ key })).max(24).optional(),
  signalKeys: z.array(key).min(1).max(24).optional(),
  // `anchorKeys` (opportunità): stessa disciplina delle signalKeys, namespace
  // distinto per non confondere «ciò che merita attenzione» con «ciò che può
  // sostenere una proposta». Il server risolve sempre factKeys/sourceRefs.
  anchorKeys: z.array(key).min(1).max(24).optional(),
  suggestedMinisters: z.array(z.enum(CABINET_SEATS)).min(1).max(7),
  origin: z.enum(['advisor', 'president', 'minister', 'event', 'follow-up']).optional(),
}).refine(value => Boolean(value.factKeys?.length || value.verifiedFacts?.length || value.signalKeys?.length || value.anchorKeys?.length), { message: 'Verified fact keys or signal keys required' });

export class InvalidCouncilIssueError extends Error {
  constructor(message = 'Council issue non valida: chiavi di fatto o di segnale richieste') {
    super(message); this.name = 'InvalidCouncilIssueError';
  }
}

/**
 * P09 — Le chiavi ignote **degradano**, non uccidono.
 *
 * Il difetto (misurato su una generazione vera): il modello, senza le chiavi
 * canoniche sotto gli occhi, le **inventa**; una sola chiave ignota faceva
 * fallire l'INTERA scheda e la proposta — titolo, domanda, **opzioni** — spariva,
 * dopo che il modello aveva già lavorato. Il principio da non perdere è un
 * altro: **una chiave inventata non si accetta mai**. Le due cose convivono:
 * la chiave ignota si **scarta** (con un avviso leggibile), la scheda resta; se
 * non resta **nessuna** fonte, allora la scheda muore — come deve.
 */
function resolveSignalLinks(snapshot: VerifiedWorldSnapshot, signalKeys: readonly string[]): { signalKeys: string[]; factKeys: string[]; sourceRefs: string[]; unknown: string[] } {
  const resolved: string[] = [];
  const factKeys: string[] = [];
  const sourceRefs: string[] = [];
  const unknown: string[] = [];
  if (!signalKeys.length) return { signalKeys: resolved, factKeys, sourceRefs, unknown };
  const byKey = new Map(buildRealitySignals(snapshot).map(signal => [signal.key, signal]));
  for (const signalKey of signalKeys) {
    const signal = byKey.get(signalKey);
    // Chiave ignota: si scarta, non si accetta e non si propaga — ma si registra,
    // perché se la scheda non dovesse sopravvivere il motivo deve nominarla.
    if (!signal) { console.warn(`[CouncilIssue] signalKey ignota scartata: ${signalKey}`); unknown.push(`Unknown reality signal key: ${signalKey}`); continue; }
    if (resolved.includes(signalKey)) continue;
    resolved.push(signalKey);
    factKeys.push(...signal.factKeys);
    sourceRefs.push(...signal.sourceRefs);
  }
  return { signalKeys: resolved, factKeys, sourceRefs, unknown };
}

/** Gli anchor si risolvono come le signal: chiave ignota scartata, fatti ricalcolati. */
function resolveAnchorLinks(snapshot: VerifiedWorldSnapshot, anchorKeys: readonly string[]): { anchorKeys: string[]; factKeys: string[]; sourceRefs: string[]; unknown: string[] } {
  const resolved: string[] = [];
  const factKeys: string[] = [];
  const sourceRefs: string[] = [];
  const unknown: string[] = [];
  if (!anchorKeys.length) return { anchorKeys: resolved, factKeys, sourceRefs, unknown };
  const byKey = new Map(buildCouncilProposalAnchors(snapshot).map(anchor => [anchor.key, anchor]));
  for (const anchorKey of anchorKeys) {
    const anchor = byKey.get(anchorKey);
    if (!anchor) { console.warn(`[CouncilIssue] anchorKey ignota scartata: ${anchorKey}`); unknown.push(`Unknown council anchor key: ${anchorKey}`); continue; }
    if (resolved.includes(anchorKey)) continue;
    resolved.push(anchorKey);
    factKeys.push(...anchor.factKeys);
    sourceRefs.push(...anchor.sourceRefs);
  }
  return { anchorKeys: resolved, factKeys, sourceRefs, unknown };
}

/**
 * P09 — Fail-closed sul RISULTATO, non su ogni chiave: la scheda è valida se
 * resta almeno una **fonte canonica** (fatto, segnale o anchor realmente risolti).
 * Le chiavi ignote sono già state scartate; se non resta nulla il motivo le
 * **nomina** (mai in silenzio): la scheda muore per la ragione vera, non per una
 * generica assenza di fatti.
 */
export function resolveCouncilIssue(snapshot: VerifiedWorldSnapshot, raw: unknown, origin?: CouncilIssueOrigin): CouncilIssue {
  const parsed = councilIssueInputSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidCouncilIssueError();
  const input = parsed.data;
  const linked = resolveSignalLinks(snapshot, input.signalKeys ?? []);
  const linkedAnchors = resolveAnchorLinks(snapshot, input.anchorKeys ?? []);
  // Con signalKeys O anchorKeys presenti sono loro l'AUTORITÀ: factKeys/verifiedFacts
  // del client sono ignorati. Solo in loro assenza vale il percorso legacy fail-closed.
  const hasSignals = linked.signalKeys.length > 0 || linkedAnchors.anchorKeys.length > 0;
  const keys = hasSignals
    ? [...new Set([...linked.factKeys, ...linkedAnchors.factKeys])]
    : [...new Set([...(input.factKeys ?? []), ...(input.verifiedFacts ?? []).map(fact => fact.key)])];
  const verifiedFacts = keys.map(key => {
    if (!Object.prototype.hasOwnProperty.call(snapshot.facts, key)) throw new InvalidCouncilIssueError(`Unknown verified fact key: ${key}`);
    const fact = snapshot.facts[key];
    return { key: fact.key, label: fact.label, value: fact.value, source: fact.source, sourceRef: fact.sourceRef };
  });
  // I riferimenti sono SEMPRE canonici: con signalKeys/anchorKeys solo quelli
  // della fonte, mai quelli del modello.
  const sourceRefs = hasSignals
    ? [...new Set([...linked.sourceRefs, ...linkedAnchors.sourceRefs])]
    : [...new Set(verifiedFacts.map(fact => fact.sourceRef))];
  // Una signal canonica senza factKeys resta valida se porta un riferimento canonico.
  // Se non resta NULLA, il motivo nomina le chiavi scartate (mai in silenzio):
  // la scheda muore per la ragione vera, non per una generica assenza di fatti.
  if (!verifiedFacts.length && !sourceRefs.length) {
    const unknown = [...linked.unknown, ...linkedAnchors.unknown];
    throw new InvalidCouncilIssueError(
      unknown.length ? unknown.join('; ') : 'Council issue senza fatto né riferimento canonico');
  }
  return {
    id: input.id ?? `issue-${shortId()}`, title: input.title, question: input.question,
    // P01 — le opzioni sono PROSA: niente chiavi, niente cifre. Si conservano
    // solo se presenti e già validate dallo schema (2-5, lunghezze).
    ...(input.options?.length ? { options: input.options.map(option => ({ title: option.title, content: option.content })) } : {}),
    // Si conservano SOLO le chiavi realmente risolte (deduplicate): il round-trip
    // del client non può aggiungere chiavi inventate.
    ...(linked.signalKeys.length ? { signalKeys: linked.signalKeys } : {}),
    ...(linkedAnchors.anchorKeys.length ? { anchorKeys: linkedAnchors.anchorKeys } : {}),
    ...(input.situationId ? { situationId: input.situationId } : {}),
    verifiedFacts, suggestedMinisters: [...new Set(input.suggestedMinisters)],
    origin: origin ?? input.origin ?? 'advisor', sourceRefs,
    createdDate: snapshot.date ?? 'unknown',
  };
}

/** Cap tecnico di sicurezza: NON è una quota da riempire, solo un limite anti-abuso. */
export const MAX_COUNCIL_ISSUES = 8;
/** Cap di sicurezza del briefing; non è una quota di questioni da produrre. */
export const MAX_BRIEFING_COUNCIL_ISSUES = 72;

export const COUNCIL_ISSUE_PROTOCOL = [
  'Puoi proporre questioni interministeriali, NON aprire una seduta o creare una crisi. Il Presidente decide se portarle al Consiglio.',
  'Se identifichi una questione concreta che richiede una decisione del Presidente o del Governo, DEVI emettere anche la relativa scheda fenced ```council_issue, una per questione distinta, con JSON {"title":"...","question":"...","options":[{"title":"...","content":"..."}],"signalKeys":["..."],"suggestedMinisters":["lavori","tesoro"]}. Un turno senza decisioni può avere zero schede: solo allora non proporre nulla.',
  'Proponi tutte e sole le questioni strategiche realmente distinte e salienti che meritano una decisione: possono essere nessuna, una o più. Non duplicare lo stesso problema e non creare questioni per riempire una quota. Ogni questione deve poter essere portata separatamente al Consiglio, con fatti canonici e solo ministri pertinenti alla domanda.',
  `Sedie ammesse: ${CABINET_SEATS.join(', ')}. Usa solo chiavi presenti in facts del VerifiedWorldSnapshot se ricorri a factKeys; per il collegamento canonico preferisci signalKeys presi dai SEGNALI DEL MOMENTO / CURRENT STRATEGIC SIGNALS. Niente valori, sourceRefs, fatti nuovi, costi inventati, opzioni Pressure o effetti.`,
  'Per una nuova opera distingui intenzione e inventario; Lavori verifica tracciato e materiali, Tesoro la copertura. Una proposta non certifica fattibilità o autorizzazione.',
  'Una council_issue richiede una decisione concreta (autorizzare, finanziare, ordinare, negoziare, avviare/sospendere, dispiegare); valutare, verificare o sondare restano attività istruttorie.',
].join('\n');

/** Advisor-only question generation; the minister protocol above is unchanged. */
export const ADVISOR_COUNCIL_ISSUE_PROTOCOL = [
  'Il CONSULENTE presenta la questione; il CONSIGLIO costruisce le soluzioni. Le soluzioni devono emergere SOLO nel Consiglio: non generare alternative già pronte, piani operativi o ordini eseguibili, neppure in prosa.',
  'Se identifichi una questione concreta che richiede una decisione del Presidente o del Governo, DEVI emettere la relativa scheda fenced ```council_issue, una per questione distinta, con JSON {"title":"...","question":"...","situationId":"tema-politico","signalKeys":["..."],"anchorKeys":["..."],"suggestedMinisters":["guerra","tesoro"]}. Usa situationId solo per una situazione presente; includi solo le liste di chiavi pertinenti e non vuote. Una questione senza soluzioni è completa.',
  'Presenta tutte e sole le questioni strategiche realmente distinte e salienti che meritano una decisione: possono essere nessuna, una o più. Non duplicare lo stesso problema e non creare questioni per riempire una quota. Ogni questione deve poter essere portata separatamente al Consiglio, con fonti canoniche e solo ministri pertinenti alla domanda.',
  `Sedie ammesse: ${CABINET_SEATS.join(', ')}. Usa solo chiavi presenti in facts del VerifiedWorldSnapshot se ricorri a factKeys; preferisci signalKeys dai CURRENT STRATEGIC SIGNALS o anchorKeys dai COUNCIL PROPOSAL ANCHORS. Non generare valori, sourceRefs, fatti nuovi, costi inventati o effetti.`,
  'Formula cosa sta succedendo, perché è politicamente importante, quale decisione deve essere presa e quali ministri sono competenti. La decisione deve essere concreta ma NON già risolta: indica il problema politico, il risultato da perseguire e i vincoli, senza scegliere uno strumento operativo.',
  'Esempio: titolo «Autonomia logistica delle forze»; question «Come garantiamo continuità operativa alle forze senza compromettere la sostenibilità finanziaria?»; ministri Guerra e Tesoro. Non prescrivere convogli, acquisti o mobilitazioni: li discuterà il Consiglio.',
].join('\n');

/**
 * Istruzioni valide SOLO per il Consulente (che riceve la sezione anchor).
 * Tenute fuori da `COUNCIL_ISSUE_PROTOCOL` — condiviso col ministro — perché il
 * prompt del ministro ha un budget di contesto stretto (JEV-W3).
 */
export const COUNCIL_ANCHOR_PROTOCOL = [
  'Una questione può nascere da un PROBLEMA (aggancia `signalKeys` dai CURRENT STRATEGIC SIGNALS) oppure da un\'OPPORTUNITÀ concreta (aggancia `anchorKeys` dai COUNCIL PROPOSAL ANCHORS). I segnali dicono ciò che MERITA ATTENZIONE; gli anchor sono fatti canonici che POSSONO SOSTENERE una questione. Nel BRIEFING MODE senza crisi identifica almeno un\'opportunità sostenuta dagli anchor disponibili e formula la domanda politica aperta: cassa non significa surplus libero, capacità non significa fattibilità. Se mancano appigli non inventarli; dichiara il limite. A ogni richiesta del Presidente cerca attivamente opportunità e presenta questioni politiche concrete pertinenti, anche in conversazione, senza anticipare le risposte. Parti da paese, data e scenario del preset; aggiorna le opportunità con stato e storia della partita. Per un quadro generale presenta le questioni realmente distinte sostenute dai fatti; per una domanda o un focus specifico resta sul tema, senza ripubblicare l’agenda nazionale. Le opportunità non devono sparire quando ci sono crisi. Ogni questione deve avere la propria council_issue con anchorKeys o signalKeys canoniche, risultato politico da perseguire e vincoli espliciti, non una misura già scelta. Non ripetere atti firmati o questioni già presenti nello stesso messaggio; non riempire una quota se mancano basi verificabili e non trasformare capacità in risorse libere.',
  'Un atto GIÀ FIRMATO è una decisione presa: non riproporlo come se fosse ancora da decidere.',
  'Ogni questione esplicita il risultato politico da perseguire e i vincoli verificati, non una soluzione operativa. Nessuna cifra non verificata o percentuale inventata.',
  'Registro: prosa da memoria di governo o da briefing politico, MAI un bollettino. Vietati «soddisfazione 32/100», «pressione 19/100», «stabilità 46/100», «PIL», «potenza militare»: l’umore politico si racconta a parole. Non nominare anime del governo, fazioni, dossier, indicatori o meccaniche di gioco.',
  'Non inventare guerre, alleanze, crisi, unità, tecnologie, organizzazioni o territori assenti dal contesto: se un dato manca, dichiara il vincolo senza fabbricarlo. Non riproporre iniziative completate o progetti già aperti come se fossero nuovi.',
].join('\n');

/**
 * WS-CONSULENTE-SITUAZIONI — Separa la SITUAZIONE dalla PROPOSTA DI ATTO in
 * ogni modalità. Vale solo per il Consulente: il ministro riceve il solo
 * `COUNCIL_ISSUE_PROTOCOL` e il suo prompt resta entro il budget di contesto.
 */
export const SITUATION_BASE_PROTOCOL = [
  'Distingui SITUAZIONE da QUESTIONE POLITICA. Una SITUAZIONE è ciò che merita attenzione nel paese, dai segnali e dai fatti verificati. La QUESTIONE POLITICA esprime la decisione concreta ancora aperta, non una proposta di atto già costruita: emetti la relativa council_issue quando esiste davvero una decisione da prendere.',
  'Non fondere situazione e questione: la prima descrive il presente, la seconda pone una domanda politica. Nel briefing ogni situazione deve avere una questione verificata collegata; in conversazione non occorre rigenerare le schede. Non esiste un numero fisso globale e non riempire artificialmente una quota.',
  'La domanda deve chiarire quale risultato politico occorre perseguire e sotto quali vincoli, senza prescrivere una misura. Valutare, verificare, approfondire, monitorare, studiare o sondare informalmente da soli restano attività istruttorie, non decisioni politiche.',
].join('\n');

/**
 * BRIEFING MODE — situazioni e risposte politiche separate ma collegate.
 * Il server integra la base deterministica e segnala la copertura incompleta.
 */
export const ADVISOR_BRIEFING_SITUATION_PROTOCOL = [
  'BRIEFING MODE: formula una questione politica concreta per ogni situazione interpretata come STRATEGIC THREAD (escluse le decisioni già prese), oltre alla sua advisor_situation. Emetti le questioni in blocchi council_issue separati, collegate tramite situationId e usando come prima signalKey quella della situazione principale affrontata. Ogni situazione richiede una propria questione verificata: non usare una sola scheda con molti tag per coprire l’intera agenda. Nessun numero fisso globale: copri tutte le situazioni, non solo quelle raccontate in prosa. La decisione è concreta ma NON già risolta; le soluzioni spettano al Consiglio.',
  'Se non ci sono crisi rilevanti, interpreta almeno una opportunità reale dai COUNCIL PROPOSAL ANCHORS e produci una council_issue con anchorKeys canoniche. Anche un’opportunità può avere una advisor_situation kind=opportunity fondata su evidenceKeys, senza inventare una signalKey o una crisi. Non copiare una soluzione generica per ogni segnale. Non riproporre atti firmati: solo modifiche o follow-up motivati da nuove esigenze.',
  'Il Presidente sceglie se approfondire la situazione o portare la questione al Consiglio. Non aprire sedute, firmare atti o avanzare il tempo. Parla come un consigliere politico: collega fatti, significato politico e vincoli; i blocchi servono alla UI, non recitare un elenco robotico.',
  'Non inventare costi, uomini, tempi operativi o risorse: senza cifre verificate esplicita i vincoli di copertura del Tesoro e disponibilità effettiva, senza formulare un piano. Niente attacchi senza forze disponibili, porti in paesi senza accesso al mare, uso di infrastrutture inesistenti, interlocutori non presenti o tecnologie fuori epoca. Usa cronaca, programmi e atti firmati per distinguere una nuova esigenza da una decisione già presa.',
  'BRIEFING MODE. Descrivi le SITUAZIONI correnti rilevanti: quante ne giustifica lo stato reale del paese, senza un numero fisso. Emetti per ogni situazione un blocco separato ```advisor_situation con JSON {"id":"tema-politico","title":"...","summary":"...","kind":"problem","signalKeys":["chiave-canonica-1","chiave-canonica-2"],"evidenceKeys":["chiave da STRATEGIC THREAD EVIDENCE"]}. Le signalKeys vanno da 0 a 5 e devono essere prese dai CURRENT STRATEGIC SIGNALS: zero è ammesso SOLO con evidenceKeys verificate. Quando ci sono segnali pertinenti collegali comunque. Per attori/luoghi/origini storiche cita evidenceKeys pertinenti, non usare un segnale generico come prova di una crisi specifica. Unisci più segnali in UNA sola situazione SOLO quando raccontano lo stesso problema politico concreto (es. insicurezza nel nord = stabilità interna + prontezza + rifornimenti + rapporti col vicino); non unire problemi distinti solo perché simili: due vicini ostili senza un nesso politico restano due situazioni.',
  'Il thread nasce da CURRENT STATE + PLAYER HISTORY + baseline pertinente, poi diventa advisor_situation e infine questione politica. Non emettere un blocco separato strategic_thread. Usa situationId nelle council_issue per collegarle alla id della situazione; conserva sempre signalKeys, anchorKeys o factKeys canoniche per vincoli e fattibilità: situationId non è una fonte di fatti. Una situazione priva di segnali non autorizza questioni prive di prove.',
  'Editoriale: normalmente organizza il quadro in circa 3-6 situazioni strategiche principali, raggruppando i segnali che descrivono lo stesso problema politico. Produci più di 6 situazioni solo quando esistono davvero più crisi indipendenti e importanti: non una scheda per indicatore.',
  'Ordina le situazioni per importanza politica e urgenza, non per categoria: prima la crisi principale, poi la seconda priorità, poi le altre situazioni e opportunità. Non organizzare automaticamente in economia, difesa, diplomazia, società.',
  'La SITUAZIONE è la storia politica che emerge dalle prove, non l’etichetta dell’indicatore: spiega cosa sta succedendo, chi o che cosa è coinvolto, perché conta e quale vincolo reale limita il Presidente. I numeri (scorte, prontezza, cassa) restano prove a supporto: non devono dominare il titolo né il corpo del testo. Quando la HISTORICAL BASELINE contiene attori o luoghi reali pertinenti (un gruppo armato, una città, un governo confinante), puoi usarli per dare concretezza, con prudenza e solo se non contraddicono il CURRENT STATE.',
  'I titoli devono essere concreti e specifici, ancorati all\'entità reale (insurrezione documentata, impegno regionale, fragilità degli approvvigionamenti, opportunità di integrazione): evita titoli generici come «Situazione diplomatica», «Problema militare», «Economia» o «Difesa». Una scheda council_issue non sostituisce la sua situazione.',
  'Scrivi come un consigliere politico che conosce il paese, non come il report di un motore: collega i fatti al loro significato politico invece di annunciare «ho rilevato N situazioni». Presenta titolo, sintesi, domanda politica, fonti canoniche, ministri competenti e collegamento situazione/questione. Non generare soluzioni né alternative già pronte.',
].join('\n');

/**
 * CONVERSATION MODE — chat normale e approfondimento. Qui il modello NON deve
 * rigenerare l'elenco delle situazioni: solo eventuali problemi NUOVI e distinti.
 */
export const ADVISOR_CONVERSATION_PROTOCOL = [
  'CONVERSATION MODE. NON rigenerare l\'elenco delle situazioni e NON emettere blocchi advisor_situation, salvo che durante la conversazione emerga davvero una NUOVA situazione distinta, non già presentata. Una situazione già presentata resta sullo sfondo: approfondiscila a parole, senza ripubblicarne la scheda.',
  'Se il Presidente sta approfondendo una situazione (FOCUS SITUATION), rispondi SOLO su quella: non presentare nuovamente il quadro nazionale e non elencare le altre situazioni. Restano ammesse le schede council_issue quando esiste una decisione politica concreta ancora aperta, senza anticiparne la soluzione.',
].join('\n');

/**
 * WS-CONSULENTE-MAPPA (M05) — Il Consulente può chiedere al governo di mostrare
 * una **mappa del contesto**. Solo per il Consulente: il ministro non ha questo
 * blocco. Il modello dichiara l'**INTENTO**, mai i territori: gli `id` delle
 * regioni li risolve il server dal read model canonico (invariante M-I1). Il
 * blocco è `tavola` (lo stesso che il client riconosce) con `op:focus`,
 * `evidence:mappa` e **nessun** `regionIds`.
 */
export const ADVISOR_MAP_PROTOCOL = [
  'MAPPA — quando conta il territorio. Se la tua raccomandazione riguarda DOVE stanno le cose — il territorio del paese, un confine, uno schieramento, un vicino, una zona contesa — puoi chiedere al governo di mostrare una mappa: scrivi su una riga sola, da sola, esattamente questo blocco.' +
  '\n```tavola\n{"op":"focus","evidence":"mappa"}\n```',
  'NON scrivere MAI gli id delle regioni dentro il comando: il territorio lo risolve il governo con i dati della mappa, tu dichiari solo *che* vuoi mostrare la geografia. Un `regionIds` scritto a mano non è riconosciuto e non serve. Usa la mappa solo quando conta il dove, al massimo una per risposta, e accanto spiega in una frase cosa guardare.',
  'La mappa è una RICHIESTA, non una prova: non sai se il governo potrà disegnarla. Non dire «la mappa conferma», «come vede sulla mappa» o «le mostro questa zona»; descrivi il contesto con prudenza e non inventare confini, guerre o movimenti.',
].join('\n\n');

/**
 * C01 (ripristinata) — Le FIGURE del Consulente. Solo per il Consulente. Il
 * modello sceglie *cosa* mostrare, mai le cifre: la figura la disegna il client
 * con i numeri del motore. La sintassi vive qui e **deve** stare nel prompt
 * reale (`buildRealityAdvisorPrompt`): la PR #192 (2026-10-04) ha sostituito il
 * vecchio prompt, e da allora la vecchia istruzione in `prompts/advisor.ts` è
 * codice morto. Vedi `docs/CONSULENTE_E_MODULO_ORDINI.md`.
 */
export const ADVISOR_FIGURE_PROTOCOL = [
  'FIGURE — quando una frase non basta. Quando una decisione si capisce meglio vedendo *dove* vanno le cose o *come* stanno, puoi chiedere al governo di disegnare una figura: scrivi su una riga sola, da sola, uno di questi comandi.' +
  '\n  [[chart: territorio]]  dove sono ricche le province del paese' +
  '\n  [[chart: bilancio]]    dove va il denaro: le uscite per voce' +
  '\n  [[chart: risorse]]     giacimenti noti e siti produttivi' +
  '\n  [[chart: trend]]       come sta evolvendo il paese (cassa, saldo, stabilità, tensione)',
  'NON scrivere MAI cifre dentro il comando: la figura la disegna il governo con i numeri del motore, tu scegli solo *cosa* mostrare. «[[chart: bilancio]]» è giusto; «[[chart: bilancio 12 mld]]» non è riconosciuto e resta testo. Usa una figura solo quando serve a decidere, al massimo una o due per risposta, e accanto spiega in una frase cosa guardare: la figura mostra, l\'interpretazione è tua.',
].join('\n\n');

/** Narrow advisor-only guard, not a semantic classifier. Ministers/council are unchanged. */
export function isPreparatoryCouncilIssue(issue: Pick<CouncilIssue, 'question'>): boolean {
  return /^(?:(?:si propone di|proporre di|possiamo|vogliamo)\s+)?(?:valutare|verificare|approfondire|monitorare|studiare|sondare)\b/i.test(issue.question.trim())
    || /^(?:autorizzare|ordinare)\s+(?:(?:una?|la|lo|il)\s+)?(?:verifica|valutazione|approfondimento|monitoraggio|studio|sondaggio)\b/i.test(issue.question.trim());
}

/** Conservative identity, not semantic similarity: shared facts/ministers/titles are not duplicates. */
function councilQuestionKey(question: string): string {
  return question.normalize('NFKC').toLowerCase().trim()
    .replace(/[.!?…]+$/u, '').trim().replace(/\s+/g, ' ');
}

/** Normalizza per il confronto atto↔proposta: punteggiatura e spazi, non semantica. */
function signedActKey(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[.!?…:;,]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Un atto già firmato è una decisione PRESA, non una questione aperta. La
 * proposta che lo ripete (testo dell'atto contenuto in titolo o domanda) non
 * deve tornare al Consiglio. Confronto conservativo: solo identità o
 * contenimento dell'INTERO testo dell'atto, mai somiglianza vaga.
 */
function duplicatesSignedAct(snapshot: VerifiedWorldSnapshot, issue: Pick<CouncilIssue, 'title' | 'question'>): string | null {
  const question = signedActKey(issue.question);
  const title = signedActKey(issue.title);
  for (const act of snapshot.recent.signedActs) {
    const text = signedActKey(act.text);
    if (text.length < 8) continue;
    if (question === text || title === text || question.includes(text) || title.includes(text)) return act.id;
  }
  return null;
}

/** Strip invalid/unfinished/duplicate proposals; model text never supplies canonical facts. */
export interface CouncilIssueParseOptions {
  /** Limite server-side; il briefing può coprire più delle otto questioni di una chat. */
  maxIssues?: number;
  /** Motivo dello scarto: callback per i test, altrimenti il server logga. */
  onDiscard?: (reason: string) => void;
}

export function parseCouncilIssues(snapshot: VerifiedWorldSnapshot, text: string, origin: CouncilIssueOrigin = 'advisor', options: CouncilIssueParseOptions = {}): { reply: string; issues: CouncilIssue[] } {
  const issues: CouncilIssue[] = [];
  const questions = new Set<string>();
  const limit = Math.max(0, Math.min(options.maxIssues ?? MAX_COUNCIL_ISSUES, MAX_BRIEFING_COUNCIL_ISSUES));
  const reply = text.replace(/```council_issue\b([^]*?)(?:```|$)/gi, (_block, json: string) => {
    try {
      if (issues.length < limit) {
        const issue = resolveCouncilIssue(snapshot, JSON.parse(json.trim()), origin);
        // Un atto già firmato è una decisione PRESA: riproporlo non è una nuova
        // questione. Deterministico, così il filtro non dipende dal prompt.
        const signed = duplicatesSignedAct(snapshot, issue);
        if (signed) throw new InvalidCouncilIssueError(`Decision already signed: ${signed}`);
        const questionKey = councilQuestionKey(issue.question) || issue.question;
        if (!questions.has(questionKey)) {
          questions.add(questionKey);
          issues.push(issue);
        }
      }
    } catch (error) {
      // Mai in silenzio: il motivo dello scarto resta leggibile.
      const reason = error instanceof Error ? error.message : String(error);
      if (options.onDiscard) options.onDiscard(reason);
      else console.warn(`[CouncilIssue] proposta scartata: ${reason}`);
    }
    return '';
  }).trim();
  return { reply, issues };
}

/** Legacy text/plain transports keep ONLY server-validated issue blocks. */
export function serializeCouncilIssues(result: { reply: string; issues: CouncilIssue[] }): string {
  return [result.reply, ...result.issues.map(issue => `\`\`\`council_issue\n${JSON.stringify(issue)}\n\`\`\``)].filter(Boolean).join('\n\n');
}

/** Title/question are discussion, the facts are canonical and there is no option menu. */
export function councilIssueSituation(issue: CouncilIssue): SituationBrief {
  return {
    factsVerified: true,
    title: issue.title, briefing: 'Tema proposto per la discussione; i fatti correnti sono elencati separatamente.',
    decisionQuestion: issue.question,
    verifiedFacts: issue.verifiedFacts.map(fact => `${fact.label}: ${fact.value}`),
    source: issue.sourceRefs.join('; '), suggestedMinisters: issue.suggestedMinisters, originType: issue.origin,
  };
}

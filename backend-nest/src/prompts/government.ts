/**
 * World Story — Prompt delle anime del governo
 * ============================================
 * Il governo non parla con una voce sola. Questo modulo dà voce alle fazioni
 * calcolate dal motore (`GovernmentFactions`): il modello non decide chi esiste
 * né che cosa chiede — quello è deterministico — ma **come lo dice**, con
 * petizioni brevi e in carattere, coerenti con umore e pressione registrati.
 *
 * Lo stesso blocco entra nel prompt della simulazione: l'orchestratore del
 * turno legge le anime, i loro interessi e le loro richieste, e ne tiene conto
 * nella narrazione. La narrazione resta prosa scorrevole: i numeri servono alla
 * storia, non diventano un bollettino.
 */

import type { PromptVariables } from './types';
import type { GovernmentSnapshot } from '../core/simulation/GovernmentFactions';
import { parseJsonLoose } from '../utils/json-repair';

/** Voce di una fazione: petizione breve, in italiano, senza cifre inventate. */
export interface GovernmentVoice {
  id: string;
  petition: string;
}

export interface GovernmentVoices {
  council: string;
  voices: Record<string, string>;
}

/**
 * Blocco deterministico + voci (se generate) da inserire nel prompt del turno.
 * Contiene i numeri come **fonte**, mai come testo da recitare: le istruzioni
 * di stile impongono al modello di raccontarli in prosa.
 */
export function buildGovernmentStateBlock(
  snapshot?: GovernmentSnapshot | null,
  voices?: GovernmentVoices | null,
): string {
  if (!snapshot || snapshot.factions.length === 0) {
    return '(Nessuna anima del governo registrata per questa nazione.)';
  }
  const lines = [
    `Coesione del governo ${Math.round(snapshot.cohesion)}/100; pressione politica ${Math.round(snapshot.pressureIndex)}/100.`,
    snapshot.debt
      ? `Debito pubblico ${Math.round(snapshot.debt.ratioPct)}% del PIL; interessi passivi ${Math.round(snapshot.debt.servicePct)}% delle entrate annue (scadenze da rifinanziare).`
      : '',
    snapshot.headline,
    'Anime del governo — interesse, influenza, umore, pressione e richiesta:',
  ].filter(Boolean);
  for (const faction of snapshot.factions) {
    const voice = voices?.voices?.[faction.id];
    const demand = `${faction.demand.title} (${faction.demand.detail})`;
    lines.push(
      `- ${faction.name} [${faction.id}] — interesse: ${faction.interest}; `
      + `influenza ${Math.round(faction.powerPct)}%; soddisfazione ${Math.round(faction.satisfaction)}/100; `
      + `pressione ${faction.pressure}/100; posizione: ${faction.stance}. Richiesta: ${demand}`
      + (voice ? ` Voce in consiglio: «${voice}»` : ''),
    );
  }
  if (voices?.council) lines.push(`Come si presenta il consiglio: ${voices.council}`);
  return lines.join('\n');
}

/**
 * Regola di stile del governo: le anime entrano nella narrazione, ma la
 * narrazione resta racconto. Senza questa regola il modello tende a riversare
 * gli indicatori nel testo come un bollettino.
 */
export function buildGovernmentNarrativeGuard(vars: PromptVariables): string {
  return `
[ANIME DEL GOVERNO E NARRAZIONE — regola non negoziabile]
- Il governo di ${vars.PLAYER_POLITY} non è un blocco unico: le anime elencate spingono per i propri interessi. Quando un ordine tocca difesa, fisco, welfare, istruzione, infrastrutture o conti pubblici, il dispaccio mostra chi dentro il governo approva, chi frena e chi minaccia, usando soddisfazione e pressione come causa, non come etichetta.
- Puoi far parlare o agire una fazione soltanto se ha davvero un ruolo nel fatto. Non inventare ministri, partiti o organi non elencati e non attribuire loro richieste nuove.
- La narrazione finale e le descrizioni sono PROSA SCORREVOLE: persone, decisioni e conseguenze in frasi continue. VIETATO trasformarle in un elenco di cifre, un bollettino statistico, una sequenza di indicatori o un elenco puntato di numeri. Una cifra entra solo se serve alla storia, dentro una frase, mai come tabella o inventario.
- Non ripetere le parole «influenza», «soddisfazione» o «pressione» nel testo per il giocatore: racconta il fatto e lascia che il conflitto politico si veda nelle scelte e nelle reazioni.`;
}

/**
 * Prompt che chiede al modello di dare voce alle fazioni. Il roster è chiuso:
 * il modello può solo scrivere la petizione, non aggiungere o togliere anime.
 */
export function buildGovernmentVoicePrompt(vars: PromptVariables, snapshot: GovernmentSnapshot): string {
  const roster = snapshot.factions.map((faction) => (
    `- id "${faction.id}": ${faction.name}; interesse ${faction.interest}; `
    + `richiesta «${faction.demand.title}» (${faction.demand.detail}); `
    + `soddisfazione ${Math.round(faction.satisfaction)}/100, pressione ${faction.pressure}/100, posizione ${faction.stance}.`
  )).join('\n');

  return `Sei la voce collettiva del governo di ${vars.PLAYER_POLITY} alla data ${vars.ORIGIN_ROUND_DATE}, in un gioco di storia alternativa.

Il governo non è un blocco unico: dentro ci sono anime con interessi propri. Per ognuna scrivi una breve petizione in prima persona plurale, come se parlasse al capo del governo: al massimo due frasi, in italiano, tono da consiglio dei ministri, coerente con la richiesta e con l'umore indicati. Se una fazione è soddisfatta o alleata, la sua voce sostiene e ringrazia; se è critica o ostile, la sua voce è dura, diffida o minaccia conseguenze. Non inventare richieste, cifre, nomi o fatti nuovi; non usare elenchi, etichette o statistiche; non nominare «giocatore», «turno» o meccaniche di gioco.

Anime del governo:
${roster}

Poi scrivi "council": una sintesi scorrevole di due o tre frasi su come si presenta il consiglio e quale tensione lo attraversa, senza elenchi di numeri.

Rispondi SOLO con JSON valido, in questa forma esatta:
{"council":"...","voices":[{"id":"id esatto dell'anima","petition":"..."}]}`;
}

/**
 * Interpreta la risposta del modello e tiene solo le voci delle fazioni note.
 * Un id sconosciuto o una voce vuota vengono scartati: meglio nessuna voce che
 * una voce inventata. Ritorna null se non c'è nulla di utilizzabile.
 */
export function parseGovernmentVoices(content: string, validIds: string[]): GovernmentVoices | null {
  let parsed: any;
  try {
    parsed = parseJsonLoose(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const allowed = new Set(validIds);
  const voices: Record<string, string> = {};
  const rawVoices = Array.isArray(parsed.voices) ? parsed.voices : [];
  for (const entry of rawVoices) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const petition = typeof entry.petition === 'string' ? entry.petition.trim() : '';
    if (!allowed.has(id) || petition.length < 8) continue;
    voices[id] = petition.slice(0, 600);
  }
  const council = typeof parsed.council === 'string' ? parsed.council.trim().slice(0, 800) : '';
  if (Object.keys(voices).length === 0 && !council) return null;
  return { council, voices };
}

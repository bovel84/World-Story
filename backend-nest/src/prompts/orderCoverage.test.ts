/**
 * Test-contratto — «una notizia per ordine» (Fase F)
 * ==================================================
 * Il difetto misurato: il turno produceva **un solo** dispaccio anche con più
 * ordini in coda, perché il prompt ordinava l'opposto — «NON trasformare
 * automaticamente ciascun ordine in un dispaccio separato: raggruppa gli ordini
 * collegati». Era già scritto in tre punti (guards.ts, prompt.ts ×2): il modello
 * eseguiva, e il giocatore perdeva di vista le proprie azioni.
 *
 * Qui si difende il contrario, e si difende **in entrambi i protocolli**: il
 * compatto è quello che ricevono i modelli veloci (glm-5.3-flash,
 * deepseek-v4.1-flash) — se la regola vivesse solo nel percorso lungo, proprio
 * i modelli per cui stiamo ottimizzando non la vedrebbero.
 *
 * Guardia contro il falso verde: i test leggono il prompt **davvero generato**,
 * non il sorgente, e verificano che il testo sia lungo abbastanza da non far
 * passare un `toContain` su una stringa vuota.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSimulationPrompt,
  buildConstrainedSimulationPrompt,
  buildIncrementalOutputInstruction,
} from './simulation/prompt';
import { buildSimulationNarrativeContract } from './simulation/guards';
import type { PromptVariables } from './types';

function vars(overrides: Partial<PromptVariables> = {}): PromptVariables {
  const base: Record<string, unknown> = {
    PLAYER_POLITY: 'Italia',
    ORIGIN_ROUND_DATE: '1951-01-01',
    TARGET_ROUND_DATE: '1951-06-30',
    PLAYER_ACTIONS_THIS_ROUND: '[actionId:action-1] Costruire una fabbrica a Torino\n[actionId:action-2] Proporre un patto alla Francia',
    STRATEGIC_STATE: 'Dossier sintetico.',
    REACTION_CONTEXT: 'FRA: accettare | rifiutare',
    NPC_STRATEGIC_PROFILES: 'Francia: diffida dell’Italia.',
    ONGOING_PROCESSES: '(nessuno)',
    ALL_EVENTS_WITH_CONSOLIDATION: '(nessuno)',
    CHATS_NON_CONSOLIDATED_ROUNDS: '(nessuna)',
    GRAND_MAP_DESCRIPTION_NO_CITY: 'Piemonte, Lombardia.',
    WORLD_BEFORE_ROUND_ONE_TEXT: 'Europa del 1950.',
    HISTORICAL_PRESET_SIMULATION_RULES: 'Regole del 1950.',
    STARTING_ROUND_DATE: '1950-01-01',
    CURRENT_ROUND_NUMBER: '4',
    PLAYER_EVERY_ACTION_NOT_PREVIOUS: '(nessuna)',
    ORDER_FUNDING: '',
  };
  return { ...base, ...overrides } as unknown as PromptVariables;
}

/**
 * I due percorsi **come vengono composti davvero**.
 *
 * Attenzione, e qui la misura ha corretto il test: `buildSimulationPrompt` da
 * sola non contiene tutto il protocollo pieno — il contratto narrativo non
 * aggirabile e l'istruzione NDJSON li aggiunge `prompt-builder.ts` al momento
 * dell'uso (righe ~971-982). Confrontare le funzioni nude farebbe dichiarare
 * «manca §5.11» una divergenza che non esiste. Perciò qui il percorso pieno è
 * ricomposto con gli stessi pezzi che il costruttore aggiunge.
 */
const PIENO_COMPOSTO = buildSimulationPrompt(vars(), { autoJump: true, eventBudget: 8 })
  + buildSimulationNarrativeContract(vars(), false)
  + buildIncrementalOutputInstruction(vars(), 8, true);

const ENTRAMBI = [
  ['protocollo pieno', PIENO_COMPOSTO],
  ['protocollo compatto', buildConstrainedSimulationPrompt(vars(), { autoJump: true, eventBudget: 8 })],
] as const;

describe('una notizia per ordine — entrambi i protocolli', () => {
  it('i due prompt sono generati e lunghi (guardia contro il falso verde)', () => {
    for (const [nome, prompt] of ENTRAMBI) {
      expect(prompt.length, `${nome}: prompt sospettosamente corto`).toBeGreaterThan(2_000);
    }
  });

  it('la regola è presente in tutti e due i protocolli', () => {
    for (const [nome, prompt] of ENTRAMBI) {
      expect(prompt, `${nome}: manca il blocco`).toContain('OGNI ORDINE PRODUCE UNA NOTIZIA');
      expect(prompt, `${nome}: manca la copertura ordini`).toContain('ogni ordine riceve il proprio dispaccio');
      expect(prompt, `${nome}: manca il caso respinto`).toContain('produce comunque la sua notizia');
    }
  });

  it('la vecchia regola contraria non è più scritta da nessuna parte', () => {
    for (const [nome, prompt] of ENTRAMBI) {
      expect(prompt, `${nome}: la vecchia regola è ancora qui`).not.toContain('NON trasformare automaticamente');
      expect(prompt, `${nome}: la vecchia regola è ancora qui`).not.toContain('raggruppa gli ordini');
      expect(prompt, `${nome}: la vecchia regola è ancora qui`).not.toContain('sintetizzando gli ordini collegati');
    }
  });

  it('il collegamento ordine → dispaccio è dichiarato per ID e per headline esatta', () => {
    for (const [nome, prompt] of ENTRAMBI) {
      expect(prompt, `${nome}: manca eventHeadlines`).toContain('eventHeadlines');
      expect(prompt, `${nome}: manca actionId esatto`).toContain('actionId');
    }
  });

  it('la regola resta anche senza auto-jump (salto a data fissa)', () => {
    const compatto = buildConstrainedSimulationPrompt(vars(), { autoJump: false, eventBudget: 4 });
    const pieno = buildSimulationPrompt(vars(), { autoJump: false, eventBudget: 4 });
    for (const prompt of [compatto, pieno]) {
      expect(prompt).toContain('OGNI ORDINE PRODUCE UNA NOTIZIA');
    }
  });

  /**
   * Fase H — misura fatta, non dedotta. Confrontando i due prompt generati
   * (33.249 vs 12.096 caratteri) le guardie essenziali risultano **già
   * presenti in entrambi**: ordini→notizia, identità del giocatore, coerenza
   * dei soggetti, stile dei dispacci, contratto delle reazioni, unità e opere
   * ammesse. L'unica divergenza reale era il **vocabolario** di §5.11
   * («avanzamento tecnico», «fine mese»), che il percorso pieno copriva con le
   * parole del contratto narrativo e il compatto con una regola dedicata.
   *
   * Il vincolo sulle cifre non inventate mancava al compatto; ora sta nel
   * contratto delle reazioni, che è comune ai due percorsi.
   *
   * Questo test difende il **contenuto** delle due divergenze, non la loro
   * posizione: leggerle è l'unico modo per accorgersi se una delle due sparisce.
   */
  it('le due stesure dichiarano §5.11 entrambe, con il proprio vocabolario', () => {
    // Non si pretende la stessa frase: il percorso pieno usa il contratto
    // narrativo, il compatto la regola 11. Si pretende che **entrambe** vietino
    // il riempimento: era la divergenza misurata, e non va nascosta.
    const pieno = ENTRAMBI[0][1];
    const compatto = ENTRAMBI[1][1];
    expect(pieno, 'pieno: manca §5.11').toContain('dispacci di riempimento');
    expect(compatto, 'compatto: manca §5.11').toContain('avanzamento tecnico');
    expect(compatto, 'compatto: manca il divieto esplicito').toContain('non riempire il budget');
    for (const [nome, prompt] of ENTRAMBI) {
      expect(prompt, `${nome}: manca il divieto di riempimento`).toContain('causa verificabile');
    }
  });

  it('il vincolo sulle cifre sta in entrambi, via il contratto condiviso', () => {
    // Era la divergenza vera: il percorso pieno lo diceva per la via economica,
    // il compatto non lo diceva affatto. Ora la frase vive nel contratto delle
    // reazioni, che i due percorsi usano entrambi — scritta una volta sola.
    for (const [nome, prompt] of ENTRAMBI) {
      expect(prompt, `${nome}: manca il vincolo sulle cifre`).toContain('non inventare numeri nuovi');
    }
  });

  /**
   * Condizione esatta di `tests/stage2.test.ts` («auto-jump con più ordini»:
   * due ordini, budget 4). Quella suite non gira in questa macchina — il
   * modulo nativo SQLite è un binario Mach-O — quindi la sua aspettativa è
   * difesa qui, sul prompt generato e non sul database.
   */
  it('due ordini in auto-jump: il prompt porta la regola, non il divieto', () => {
    const prompt = buildSimulationPrompt(vars(), { autoJump: true, eventBudget: 4 });
    expect(prompt).toContain('OGNI ORDINE PRODUCE UNA NOTIZIA');
    expect(prompt).toContain('ogni ordine riceve il proprio dispaccio');
    expect(prompt).not.toContain('NON trasformare automaticamente');
    expect(prompt).toContain('Fermati SOLO sull\'evento che contiene quella decisione');
  });
});

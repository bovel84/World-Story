/**
 * M05 — Il Consulente impara a chiedere la mappa.
 *
 * Contratto (invariante M-I1/M-I2): il prompt **realmente usato in partita** per
 * il Consulente insegna la direttiva mappa **senza** gli id delle regioni — il
 * modello dichiara solo *che* vuole mostrare la geografia, gli id li risolve il
 * motore.
 *
 * Nota importante: la produzione NON usa `buildAdvisorPrompt` (codice morto);
 * il percorso reale è `PromptBuilder.getAdvisor` → `buildRealityAdvisorPrompt`.
 * Questo test punta perciò al prompt vero, non a quello storico.
 */
import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt } from '../src/core/government/RealityAdvisor';
import { MINISTER_DIALOGUE_PROTOCOL } from '../src/core/government/MinisterDialogueRules';

function advisorPrompt(message: string, audience: 'advisor' | 'minister' = 'advisor'): string {
  const snapshot = buildVerifiedWorldSnapshot({
    gameData: {
      id: 'map-directive', playerPolityId: 'KOR', playerPolityName: 'Corea del Sud', currentDate: '2000-06-01',
      world: { regions: { seoul: { id: 'seoul', name: 'Seul', owner: 'KOR', coastal: true, objects: [] } } },
      worldState: { accounts: { KOR: { population: 47_000_000, stability: 55, monthlyBalance: 1, nominalGdpUsdBillions: 500 } }, resources: { stock: { money: 1 }, needs: {} }, arsenal: { units: {} } },
      relationships: {}, ongoingProcesses: [],
    },
    commitments: [], operationalRows: [], foodCoverageMonths: 3,
  });
  const context = buildRealityAdvisorContext(snapshot).advisorContext;
  return buildRealityAdvisorPrompt(context, message, [], undefined, audience);
}

describe('M05 — la direttiva mappa nel prompt REALE del Consulente', () => {
  const prompt = advisorPrompt('Mostrami la mappa del nostro paese.');

  it('insegna la sintassi della direttiva mappa (blocco tavola, op focus, evidence mappa)', () => {
    const occurrences = prompt.match(/\{"op":"focus","evidence":"mappa"\}/g) ?? [];
    // Guardia contro il falso verde: il blocco-comando completo, non una sottostringa.
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(prompt).toContain('```tavola');
  });

  it('ordina di NON scrivere gli id delle regioni', () => {
    expect(prompt).toMatch(/non scrivere mai gli id delle regioni/i);
    // E il comando d'esempio **non** contiene `regionIds`.
    const example = prompt.match(/```tavola\s*(\{[^`]*\})\s*```/);
    expect(example).not.toBeNull();
    expect(example![1]).not.toContain('regionIds');
    expect(example![1]).toBe('{"op":"focus","evidence":"mappa"}');
  });

  it('avverte che la mappa è una richiesta, non una prova (guardrail anti-allucinazione)', () => {
    expect(prompt).toMatch(/la mappa è una richiesta, non una prova/i);
    expect(prompt).toContain('la mappa conferma');
  });

  it('blocco mappa presente anche in conversazione; assente per il ministro', () => {
    expect(advisorPrompt('Come vanno le finanze?', 'advisor')).toContain('{"op":"focus","evidence":"mappa"}');
    expect(advisorPrompt('Rapporto al Presidente.', 'minister')).not.toContain('{"op":"focus","evidence":"mappa"}');
  });

  it('non ha rimosso i protocolli esistenti', () => {
    expect(prompt).toContain('council_issue');
    expect(prompt).toContain('CONVERSATION MODE');
  });
});

describe('MAP05 — la grandezza dichiarata, mai le cifre', () => {
  it('il prompt REALE del Consulente insegna `metric`, con le tre grandezze canoniche', () => {
    const prompt = advisorPrompt('Dove produce il paese?');
    expect(prompt).toMatch(/MAP05/);
    expect(prompt).toContain('"metric":"pil"');
    for (const metric of ['pil', 'popolazione', 'difesa']) expect(prompt).toContain(metric);
    // Il confine di C01 resta: il modello sceglie COSA guardare, non le cifre.
    expect(prompt).toMatch(/mai una cifra/i);
    expect(prompt).toMatch(/non scrivere mai gli id delle regioni/i);
  });

  it('il protocollo REALE del ministro insegna `metric` e vieta di indovinare gli id', () => {
    expect(MINISTER_DIALOGUE_PROTOCOL).toMatch(/MAP05/);
    expect(MINISTER_DIALOGUE_PROTOCOL).toContain('"metric":"pil"');
    expect(MINISTER_DIALOGUE_PROTOCOL).toMatch(/non indovinarli/i);
    // Il ministro continua a poter indicare gli id canonici quando li ha.
    expect(MINISTER_DIALOGUE_PROTOCOL).toMatch(/regionIds/);
  });
});

describe('M-PROGETTI — la mappa serve anche a spiegare un progetto o un\'idea', () => {
  it('il prompt REALE del Consulente autorizza la mappa per un progetto/idea, senza derogare a M-I1', () => {
    const prompt = advisorPrompt('Come svilupperesti il progetto della rete ferroviaria?');
    expect(prompt).toMatch(/tuo progetto o una tua idea/i);
    // M-I1 resta: il Consulente dichiara cosa mostrare, mai gli id.
    expect(prompt).toMatch(/non scrivere mai gli id delle regioni/i);
  });

  it('il protocollo REALE del ministro (composeMinisterDialoguePrompt) autorizza la mappa di progetto con id canonici', () => {
    // `MINISTER_DIALOGUE_PROTOCOL` è interpolato in `composeMinisterDialoguePrompt`
    // (MinisterDialogue.ts), il prompt usato dal Consiglio.
    expect(MINISTER_DIALOGUE_PROTOCOL).toMatch(/tuo progetto o una tua idea/i);
    expect(MINISTER_DIALOGUE_PROTOCOL).toMatch(/regionIds/);
    expect(MINISTER_DIALOGUE_PROTOCOL).toMatch(/id canonici/i);
  });
});

describe('C01 — le figure del Consulente vivono nel prompt REALE', () => {
  const prompt = advisorPrompt('Come sta andando il bilancio?');

  it('insegna i quattro comandi figura esatti', () => {
    for (const kind of ['territorio', 'bilancio', 'risorse', 'trend']) {
      expect(prompt).toContain(`[[chart: ${kind}]]`);
    }
  });

  it('ordina di non scrivere cifre dentro il comando (il modello sceglie COSA, mai le cifre)', () => {
    expect(prompt).toMatch(/non scrivere mai cifre dentro il comando/i);
  });

  it('assente per il ministro', () => {
    expect(advisorPrompt('Rapporto al Presidente.', 'minister')).not.toContain('[[chart: bilancio]]');
  });
});


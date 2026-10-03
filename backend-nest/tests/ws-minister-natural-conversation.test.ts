import { describe, expect, it } from 'vitest';
import { briefingFor, colleagueRedirect, colleagueRedirectContext } from '../src/core/government/MinisterChat';
import { buildMinisterDialogueBrief, composeMinisterDialoguePrompt, fallbackMinisterDialogue, dialogueResponseIsNatural, normalizeCurrentDecision, withMinisterDialogueRequest, currentMinisterDialogueRequest } from '../src/core/government/MinisterDialogue';
import { personaFor } from '../src/core/government/MinisterPersona';
import type { CabinetAddress } from '../src/core/government/Cabinet';
import type { MinisterWorldContext } from '../src/prompts/national-context';

const world: MinisterWorldContext = { worldName: 'Ricostruzione', country: 'Paese', currentDate: '1946-01-01', scenarioPremise: 'Il paese si ricostruisce.', simulationRules: '', nationalContext: '', recentHistory: '', activeCommitments: '', ongoingProcesses: '' };
const address: CabinetAddress = { seat: 'tesoro', label: 'Ministro del Tesoro', reads: 'conti', opening: '', items: [{ voiceId: 'treasury_condition', need: 'Usare l’avanzo', because: 'Debito pesante', urgency: 'urgente', figures: [{label:'Saldo',value:'7.60',unit:'mld',basis:{kind:'measured',source:'conti'}}], paths: [] }] };
const history = [{ role: 'assistant' as const, content: 'Abbiamo 7,60 mld di avanzo, ma con il debito al 110% io non spenderei tutto.' }];
const decision = { objective: 'Usare l’avanzo', measures: [{ label: 'Debito', kind: 'allocation', sharePct: 50, source: 'minister' as const, status: 'proposed' as const }], unresolved: ['Destinazione del resto'] };
const brief = (message: string) => buildMinisterDialogueBrief({ seat: 'tesoro', worldContext: world, currentIssues: address.items, presidentMessage: message, recentHistory: history, currentDecision: decision });

describe('WS-MINISTER-NATURAL-CONVERSATION — view e continuità', () => {
  it('il briefing separa regole e fatti strutturati senza conteggio o cuciture narrative', () => {
    const context = briefingFor(address, { voices: [], headline: '', canonicalMutation: false }).context;
    for (const section of ['IDENTITY', 'VERIFIED FACTS', 'MEMORY', 'DIALOGUE STYLE', 'PROTOCOL']) expect(context).toContain(`[${section}]`);
    expect(context).toContain('STAI PARLANDO CON IL PRESIDENTE');
    expect(context).toContain('"voiceId":"treasury_condition"');
    expect(context).not.toMatch(/Ci sono \d+ questioni|COME RAGIONI — TRE LIVELLI|Perché adesso:|QUELLO CHE PORTI AL CONSIGLIO/);
  });
  it('§26-27: E il resto? e Perché? riprendono storia e proposta, senza dossier recitato', () => {
    for (const message of ['E il resto?', 'Perché?']) {
      const dialogue = brief(message);
      expect(dialogue.currentDecision?.measures?.[0].source).toBe('minister');
      expect(dialogue.recentHistory[0].content).toBe(history[0].content);
      const prompt = composeMinisterDialoguePrompt(dialogue);
      expect(prompt).toContain('NON RIPETERE ciò che hai appena detto');
      expect(prompt).toContain('50');
      expect(prompt).toContain(message);
      expect(prompt).toContain('30–80');
      expect(prompt.match(/\[DIALOGUE STYLE\]/g)).toHaveLength(1);
      expect(prompt.match(/\[PROTOCOL\]/g)).toHaveLength(1);
      const withMemory = composeMinisterDialoguePrompt({ ...dialogue, memory: { context: 'MEMORY_SENTINEL' } });
      expect(withMemory).toContain('MEMORY_SENTINEL');
      expect(fallbackMinisterDialogue(dialogue)).not.toMatch(/Non capisco|110|Fatti:|Lettura:|Tocca a te/);
    }
  });
  it('§28-29: obiezione e cambio idea hanno regole di continuazione e precedenza recente', () => {
    for (const message of ['Non sono convinto.', 'Prima volevo ridurre il debito, ma ora preferisco investire.']) {
      const prompt = composeMinisterDialoguePrompt(brief(message));
      expect(prompt).toContain('La decisione più recente del Presidente prevale');
      expect(prompt).toContain('difendi o rivedi');
      expect(prompt).toContain(message);
    }
  });
  it('§30-31: redirect strutturato e fallback Tesoro/Esteri, mai tono da manuale', () => {
    const redirect = colleagueRedirectContext('tesoro', 'Costruiamo una fabbrica a Sarajevo?');
    expect(redirect).toMatchObject({ targetSeat: 'lavori', currentSeat: 'tesoro' });
    expect(redirect?.currentAngle).toMatch(/finanzi|conti|margine/);
    expect(colleagueRedirect('tesoro', 'Costruiamo una fabbrica a Sarajevo?')).toMatch(/Lavori/);
    expect(colleagueRedirect('tesoro', 'Costruiamo una fabbrica a Sarajevo?')).not.toMatch(/Non è la mia materia|se ne occupa|e legge/);
    expect(colleagueRedirect('esteri', 'Aumentiamo la spesa sanitaria?')).toMatch(/Sanità.*partner|Sanità.*impegni/);
    expect(brief('Costruiamo una fabbrica a Sarajevo?').redirect).toMatchObject({ targetSeat: 'lavori' });
  });
  it('la conferma conserva la proposta, ma il protocollo richiede source president per i valori confermati', () => {
    const prompt = composeMinisterDialoguePrompt(brief('Va bene.'));
    expect(prompt).toContain('source = president');
    expect(prompt).toContain('source = minister');
    expect(prompt).toContain('update-proposal');
    expect(decision.measures[0].source).toBe('minister');
    expect(normalizeCurrentDecision({ ...decision, measures: [{ ...decision.measures[0], source: 'made-up' }] })?.measures).toEqual([]);
  });
  it('le risposte da report sono rifiutate, ma direttive, approfondimenti e richieste esplicite restano possibili', () => {
    const response = 'Certo. Ti metto a confronto le due strade.\n```tavola\n{"op":"compare"}\n```';
    expect(dialogueResponseIsNatural(response, brief('Fammi vedere.'))).toBe(true);
    for (const text of ['Fatti: il saldo regge.', 'Lettura: serve prudenza.', 'Non è la mia materia: il Ministro dei Lavori se ne occupa.', 'Ho 2 cose da portare al consiglio.']) expect(dialogueResponseIsNatural(text, brief('Perché?'))).toBe(false);
    expect(dialogueResponseIsNatural('Fatti: il saldo regge.', brief('Scrivi una sezione Fatti:'))).toBe(true);
    const signature = personaFor('tesoro').signature;
    expect(dialogueResponseIsNatural(signature, brief('Perché?'))).toBe(false);
    expect(dialogueResponseIsNatural(signature.replace(/[«»]/g, ''), brief('Perché?'))).toBe(false);
    for (let turn = 0; turn < 3; turn++) {
      const repeated = { ...brief('Perché?'), recentHistory: [{ role: 'assistant' as const, content: signature }] };
      expect(dialogueResponseIsNatural(`${signature} Io terrei spazio per la scelta.`, repeated)).toBe(false);
    }
    expect(dialogueResponseIsNatural('FATTI\nIl saldo regge.', brief('Perché?'))).toBe(false);
    const long = Array(81).fill('Parliamo').join(' ');
    expect(dialogueResponseIsNatural(long, brief('Perché?'))).toBe(false);
    expect(dialogueResponseIsNatural(long, brief('Abbiamo margine?'))).toBe(true);
    expect(dialogueResponseIsNatural(`${long} ${long}`, brief('Abbiamo margine?'))).toBe(false);
    expect(dialogueResponseIsNatural(`${long} ${long}`, brief('Spiega bene il compromesso.'))).toBe(true);
  });
  it('fallback: conferma completa di 13 misure senza cambiare dati engine o accettare ipotesi', async () => {
    const { emptyWorkspace, applyDecisionBatch, parseDecisionActions, activeProposal } = await import('../../frontend/src/components/Game/decisionWorkspace');
    const measures = Array.from({ length: 13 }, (_, index) => ({ label: `Scelta ${index}`, kind: 'priority' as const, source: 'minister' as const, status: 'proposed' as const }));
    let workspace = emptyWorkspace('tesoro');
    for (let start = 0; start < measures.length; start += 12) workspace = applyDecisionBatch(workspace, [{ op: 'update-proposal', changes: measures.slice(start, start + 12) }], { messageId: `propose-${start}` });
    const currentDecision = { measures: [...measures, { label: 'Dato verificato', kind: 'target' as const, source: 'engine' as const, status: 'accepted' as const }] };
    const response = fallbackMinisterDialogue({ ...brief('Va bene.'), currentDecision });
    const actions = parseDecisionActions(response);
    expect(actions).toHaveLength(2);
    workspace = applyDecisionBatch(workspace, actions, { messageId: 'confirm' });
    expect(activeProposal(workspace)?.measures).toHaveLength(13);
    expect(activeProposal(workspace)?.measures.every(measure => measure.source === 'president' && measure.status === 'accepted')).toBe(true);
    expect(response).not.toContain('Dato verificato');
    expect(currentDecision.measures[0].source).toBe('minister');
    expect(parseDecisionActions(fallbackMinisterDialogue({ ...brief('Va bene, ma forse no.'), currentDecision }))).toEqual([]);
    expect(fallbackMinisterDialogue(brief('Fammi vedere.'))).toContain('```tavola');
  });
  it('lo snapshot è isolato per richiesta concorrente, partita e sedia', async () => {
    await Promise.all(['game-a', 'game-b'].map(gameId => withMinisterDialogueRequest(gameId, 'tesoro', { objective: gameId }, async () => {
      await Promise.resolve();
      expect(currentMinisterDialogueRequest(gameId, 'tesoro')?.currentDecision?.objective).toBe(gameId);
      expect(currentMinisterDialogueRequest(gameId === 'game-a' ? 'game-b' : 'game-a', 'tesoro')).toBeUndefined();
      expect(currentMinisterDialogueRequest(gameId, 'sanita')).toBeUndefined();
    })));
    expect(currentMinisterDialogueRequest('game-a', 'tesoro')).toBeUndefined();
  });
});

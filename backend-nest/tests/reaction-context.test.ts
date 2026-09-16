/**
 * Blocco 2, punto 2 — RelevantActor / ReactionContext
 * ===================================================
 * Il motore identifica chi è coinvolto e quali opzioni sono materialmente
 * possibili; l'LLM sceglie solo fra quelle. Nessun accesso a DB: il builder è
 * puro e deterministico.
 */
import { describe, expect, it } from 'vitest';
import {
  buildReactionContext,
  renderReactionContext,
  allowedActorIds,
  type ReactionContextInput,
} from '../src/core/simulation/ReactionContext';

function input(overrides: Partial<ReactionContextInput> = {}): ReactionContextInput {
  return {
    playerPolityId: 'BWA',
    playerPolityName: 'Botswana',
    focusTexts: ['Attaccare le posizioni dello Zimbabwe a Gwanda'],
    currentActions: [{ actionId: 'a1', text: 'Attaccare le posizioni dello Zimbabwe a Gwanda' }],
    polityNames: { BWA: 'Botswana', ZWE: 'Zimbabwe', ZAF: 'Sudafrica', MYS: 'Malaysia' },
    regions: {
      bwa: { id: 'bwa', name: 'Botswana', owner: 'BWA', borders: ['zwe', 'zaf'] },
      zwe: { id: 'zwe', name: 'Zimbabwe', owner: 'ZWE', borders: ['bwa'] },
      zaf: { id: 'zaf', name: 'Sudafrica', owner: 'ZAF', borders: ['bwa'] },
      mys: { id: 'mys', name: 'Malaysia', owner: 'MYS', borders: [] },
    },
    relationships: { ZWE: { BWA: 'hostile' }, ZAF: { BWA: 'neutral' } },
    accounts: {
      BWA: { militaryPower: 40, effectiveMilitaryPower: 44, stability: 60, socialTension: 30 },
      ZWE: { militaryPower: 70, effectiveMilitaryPower: 80 },
      ZAF: { militaryPower: 90, effectiveMilitaryPower: 95 },
      MYS: { militaryPower: 50 },
    },
    resources: { debt: 10, creditLimit: 100, creditHeadroom: 42, stock: { money: 30, weapons: 5, fuel: 4 } },
    government: { factions: [{ id: 'army', name: 'Stato maggiore', pressure: 70, stance: 'favorevole' }] },
    ongoingProcesses: [],
    crisis: { level: 'watch', headline: 'Vigilanza' },
    ...overrides,
  };
}

describe('buildReactionContext', () => {
  it('identifica la controparte nominata e i vicini, escludendo le potenze lontane', () => {
    const context = buildReactionContext(input());
    const ids = context.actors.map(actor => actor.id);
    expect(ids).toContain('ZWE');
    expect(ids).toContain('ZAF');
    expect(ids).not.toContain('MYS');

    const zimbabwe = context.actors.find(actor => actor.id === 'ZWE')!;
    expect(zimbabwe.role).toBe('rival');
    expect(zimbabwe.because).toMatch(/nominata esplicitamente/);
    const southAfrica = context.actors.find(actor => actor.id === 'ZAF')!;
    expect(southAfrica.role).toBe('neighbour');
    expect(southAfrica.because).toMatch(/confina/);
  });

  it('espone la causa esplicita (trigger) con il riferimento all’ordine', () => {
    const context = buildReactionContext(input());
    expect(context.trigger.kind).toBe('player_action');
    expect(context.trigger.sourceRef).toBe('a1');
    expect(context.trigger.summary).toContain('Zimbabwe');
  });

  // Q02-bis / A: il trigger è l'ordine del turno CORRENTE, mai lo storico.
  it('A — usa l’ordine corrente e non la prima azione dello storico', () => {
    const context = buildReactionContext(input({
      focusTexts: ['Invia ultimatum alla Germania'],
      currentActions: [{ actionId: 'A9', text: 'Invia ultimatum alla Germania' }],
    }));
    expect(context.trigger).toMatchObject({
      kind: 'player_action',
      summary: 'Invia ultimatum alla Germania',
      sourceRef: 'A9',
    });
    // Le vecchie azioni non esistono più nel contratto del trigger.
    expect(context.trigger.sourceRef).not.toBe('A1');
    expect(context.trigger.summary).not.toContain('Firma un accordo con Francia');
  });

  it('A2 — summary e sourceRef appartengono sempre alla stessa azione', () => {
    const context = buildReactionContext(input({
      focusTexts: ['Costruisci una fabbrica', 'Invia ultimatum alla Germania'],
      currentActions: [
        { actionId: 'A2', text: 'Costruisci una fabbrica' },
        { actionId: 'A9', text: 'Invia ultimatum alla Germania' },
      ],
    }));
    expect(context.trigger.sourceRef).toBe('A2');
    expect(context.trigger.summary).toBe('Costruisci una fabbrica');
  });

  it('A3 — senza ID canonico non associa l’ID di un’altra azione', () => {
    const context = buildReactionContext(input({
      focusTexts: ['Invia ultimatum alla Germania'],
      currentActions: [{ text: 'Invia ultimatum alla Germania' }],
    }));
    expect(context.trigger).toMatchObject({ kind: 'player_action', summary: 'Invia ultimatum alla Germania' });
    expect(context.trigger.sourceRef).toBeUndefined();
  });

  it('risale al processo mondiale quando non ci sono ordini nel turno', () => {
    const context = buildReactionContext(input({
      focusTexts: [],
      currentActions: [],
      ongoingProcesses: [{ id: 'p1', title: 'Riforma agraria in corso', sourceActionId: 'a0' }],
    }));
    expect(context.trigger.kind).toBe('world_process');
    expect(context.trigger.sourceRef).toBe('p1');
  });

  it('filtra le opzioni con i vincoli materiali (militare assente, credito, geografia)', () => {
    const context = buildReactionContext(input({
      accounts: { ...input().accounts, ZAF: { militaryPower: 0 } },
    }));
    const southAfrica = context.actors.find(actor => actor.id === 'ZAF')!;
    const optionIds = southAfrica.options.map(option => option.id);
    expect(optionIds).toContain('ZAF:negotiate');
    expect(optionIds).not.toContain('ZAF:mobilize');

    const kinds = context.constraints.map(constraint => constraint.kind);
    expect(kinds).toContain('military');
    expect(kinds).toContain('geography');
    expect(kinds).toContain('budget');
  });

  it('aggiunge fazioni interne e settori economici alla causale', () => {
    const context = buildReactionContext(input());
    const roles = context.actors.map(actor => actor.role);
    expect(roles).toContain('internal_faction');
    expect(roles).toContain('economic_sector');
    expect(renderReactionContext(context)).toContain('Stato maggiore');
  });

  it('limita il numero di reazioni e gli attori (niente catene infinite)', () => {
    const context = buildReactionContext(input());
    expect(context.maxReactions).toBeLessThanOrEqual(4);
    expect(context.actors.length).toBeLessThanOrEqual(8);
    expect(context.allowedOptionIds.length).toBeGreaterThan(0);
  });

  it('allowedActorIds contiene solo polityId, non gli attori interni', () => {
    const ids = allowedActorIds(buildReactionContext(input()));
    expect(ids.has('ZWE')).toBe(true);
    expect([...ids].some(id => id.includes(':'))).toBe(false);
  });

  it('il rendering è compatto e cita vincoli e opzioni', () => {
    const rendered = renderReactionContext(buildReactionContext(input()));
    expect(rendered).toContain('CAUSA (player_action');
    expect(rendered).toContain('VINCOLI MATERIALI');
    expect(rendered).toContain('ZWE:negotiate');
    expect(rendered).toContain('Rispondono al massimo');
  });

  it('riconosce la controparte nominata con alias italiano o con una forma flessa', () => {
    // Il contratto fail-closed rifiuta un attore non elencato: il motore deve
    // quindi riconoscere anche i nomi con cui il giocatore nomina davvero la
    // controparte (nome italiano del registro, forma flessa).
    const byAlias = buildReactionContext(input({
      focusTexts: ['Negoziare con la Polonia'],
      currentActions: [],
      polityNames: { POL: 'Польша' },
      polityAliases: { POL: ['POL', 'Polonia'] },
      regions: { r1: { id: 'r1', name: 'Польша', owner: 'POL' } },
    }));
    expect(byAlias.actors.map(actor => actor.id)).toContain('POL');

    const flexed = buildReactionContext(input({
      focusTexts: ['Mediazione cecoslovacca nella crisi'],
      currentActions: [],
      regions: {
        r1: { id: 'r1', name: 'Botswana', owner: 'BWA', borders: [] },
        r2: { id: 'r2', name: 'Cecoslovacchia', owner: 'CZE', borders: [] },
      },
    }));
    expect(flexed.actors.map(actor => actor.id)).toContain('CZE');
  });
});

/**
 * MG06 — Una nazione reagisce con le SUE capacità, non con quelle del giocatore
 * =========================================================================
 * Il difetto misurato dalla prima revisione, e ancora aperto fino a qui:
 * `buildReactionContext` costruisce le opzioni di ogni polity passando
 * `input.resources.creditHeadroom`, che è la proiezione del **giocatore**. La
 * conseguenza non è astratta: quando il giocatore è a corto di credito, ogni
 * controparte riceve l'opzione «embargo o ritorsione commerciale» motivata con
 * «nessun margine di credito proprio» — un margine che non è il suo.
 *
 * Le regole che i test difendono:
 *  - **il margine che conta è quello della polity**, quando il motore lo
 *    conosce: una controparte con credito proprio non riceve quella
 *    motivazione, anche se il giocatore è a secco;
 *  - **un margine ignoto non si deduce da un altro soggetto**: se il motore non
 *    ha i numeri della polity, l'opzione lo **dichiara** invece di prendere in
 *    prestito quelli del giocatore;
 *  - **l'effetto del difetto è misurabile**: con il giocatore a secco e la
 *    controparte no, la motivazione non deve comparire.
 *
 * Guardia contro il falso verde: si verifica il caso opposto — una polity
 * davvero senza credito DEVE ricevere la motivazione «nessun margine proprio»:
 * senza quel controllo, il test passerebbe anche con l'opzione sempre neutra.
 */
import { describe, expect, it } from 'vitest';
import { buildReactionContext, type ReactionContextInput } from '../src/core/simulation/ReactionContext';

/** Un contesto minimo: due polity, il giocatore e un vicino. */
function contextWith(overrides: Partial<ReactionContextInput> = {}): ReactionContextInput {
  return {
    playerPolityId: 'ALPHA',
    playerPolityName: 'Alphaland',
    polityNames: { ALPHA: 'Alphaland', BETA: 'Betaland' },
    // BETA è rilevante perché CONFINA con il giocatore: una regione di ALPHA
    // che dichiara `borders` verso quella di BETA. Senza il confine, la polity
    // non entrerebbe nel contesto e il test non misurerebbe nulla.
    regions: {
      r_home: { id: 'r_home', name: 'Capitale', owner: 'ALPHA', borders: ['r_confine'] },
      r_confine: { id: 'r_confine', name: 'Confine', owner: 'BETA' },
    },
    accounts: {
      ALPHA: { militaryPower: 10 },
      BETA: { militaryPower: 20 },
    },
    focusTexts: ['BETA reagisce alla nuova strada di confine'],
    currentActions: [],
    ...overrides,
  } as ReactionContextInput;
}

describe('MG06 — le opzioni di una polity usano le SUE capacità', () => {
  it('con il giocatore a secco e la controparte con credito, l’embargo NON è motivato dal credito', () => {
    // Il difetto, riprodotto: il margine del giocatore è zero, quello della
    // polity è positivo. Prima, ogni controparte riceveva la motivazione
    // «nessun margine di credito proprio» — che era falsa.
    const context = buildReactionContext(contextWith({
      resources: { creditHeadroom: 0 },
      polityResources: { BETA: { creditHeadroom: 8.5 } },
    }));
    const beta = context.actors.find(actor => actor.id === 'BETA');
    expect(beta).toBeTruthy();
    const embargo = beta!.options.find(option => option.id === 'BETA:embargo');
    expect(embargo, 'la leva commerciale deve esistere').toBeTruthy();
    // La motivazione NON deve dire che non ha margine: ne ha.
    expect(embargo!.constraint ?? '').not.toContain('nessun margine');
  });

  it('una polity DAVVERO senza credito riceve la motivazione corretta', () => {
    // Il controllo opposto: senza di esso, il test passerebbe anche con
    // l'opzione sempre neutra — cioè non verificherebbe nulla.
    const context = buildReactionContext(contextWith({
      resources: { creditHeadroom: 5 },
      polityResources: { BETA: { creditHeadroom: 0 } },
    }));
    const beta = context.actors.find(actor => actor.id === 'BETA')!;
    const embargo = beta.options.find(option => option.id === 'BETA:embargo')!;
    expect(embargo.constraint).toContain('nessun margine di credito proprio');
  });

  it('un margine IGNOTO non si deduce dal giocatore: l’opzione lo dichiara', () => {
    // Senza i numeri della polity, il motore non sa. Non prende in prestito
    // quelli del giocatore, anche se sono zero: dice che non ha verificato.
    const context = buildReactionContext(contextWith({
      resources: { creditHeadroom: 0 },
      // polityResources assente: il motore non ha i numeri di BETA.
    }));
    const beta = context.actors.find(actor => actor.id === 'BETA')!;
    const embargo = beta.options.find(option => option.id === 'BETA:embargo')!;
    expect(embargo.constraint).toContain('non verificato');
    expect(embargo.constraint ?? '').not.toContain('nessun margine di credito proprio');
  });

  it('le opzioni non economiche restano intatte: il vincolo non allarga nulla', () => {
    // Il difetto era nella motivazione di UNA opzione: le altre non cambiano.
    const context = buildReactionContext(contextWith({
      resources: { creditHeadroom: 0 },
      polityResources: { BETA: { creditHeadroom: 8.5 } },
    }));
    const beta = context.actors.find(actor => actor.id === 'BETA')!;
    expect(beta.options.map(option => option.id)).toEqual(expect.arrayContaining([
      'BETA:negotiate', 'BETA:reject', 'BETA:condition', 'BETA:embargo',
    ]));
    // Con un esercito, la mobilitazione c'è e dichiara la potenza di quella
    // polity (20), non quella del giocatore (10).
    const mobilize = beta.options.find(option => option.id === 'BETA:mobilize');
    expect(mobilize, 'BETA ha un esercito: la mobilitazione è ammessa').toBeTruthy();
    expect(mobilize!.constraint).toContain('20');
  });

  it('una polity senza esercito non riceve la mobilitazione', () => {
    const context = buildReactionContext(contextWith({
      accounts: { ALPHA: { militaryPower: 10 }, BETA: { militaryPower: 0 } },
      resources: { creditHeadroom: 5 },
      polityResources: { BETA: { creditHeadroom: 3 } },
    }));
    const beta = context.actors.find(actor => actor.id === 'BETA')!;
    expect(beta.options.some(option => option.id === 'BETA:mobilize')).toBe(false);
  });

  it('il percorso vivo passa le risorse di OGNI polity, non solo del giocatore', () => {
    // Il difetto era nel contratto, non solo nella lettura: `polityResources`
    // doveva arrivare dal percorso vivo. Questo test verifica che il contesto
    // usi davvero la mappa per-polity quando c'è, e che una polity senza voce
    // resti senza margine dedotto — senza fingere di sapere.
    const conRisorse = buildReactionContext(contextWith({
      resources: { creditHeadroom: 0 },
      polityResources: { BETA: { creditHeadroom: 4 } },
    }));
    const senzaVoce = buildReactionContext(contextWith({
      resources: { creditHeadroom: 0 },
      polityResources: { ALTRA: { creditHeadroom: 9 } },
    }));

    const embargoDi = (context: ReturnType<typeof buildReactionContext>): string => {
      const beta = context.actors.find(actor => actor.id === 'BETA');
      return beta?.options.find(option => option.id === 'BETA:embargo')?.constraint ?? '';
    };

    // Con la voce: il margine è il suo (4), non quello del giocatore (0).
    expect(embargoDi(conRisorse)).not.toContain('nessun margine');
    // Con la voce di UN'ALTRA polity: per BETA il margine resta ignoto, e lo dice.
    expect(embargoDi(senzaVoce)).toContain('non verificato');
  });

  it('il contesto resta deterministico: due letture danno le stesse opzioni', () => {
    // Il vincolo non introduce casualità: la stessa situazione dà le stesse
    // opzioni, o la reazione non sarebbe riproducibile.
    const input = contextWith({
      resources: { creditHeadroom: 0 },
      polityResources: { BETA: { creditHeadroom: 8.5 } },
    });
    const first = buildReactionContext(input);
    const second = buildReactionContext(input);
    expect(second.actors.map(a => a.options.map(o => o.id + '|' + (o.constraint ?? ''))))
      .toEqual(first.actors.map(a => a.options.map(o => o.id + '|' + (o.constraint ?? ''))));
  });
});

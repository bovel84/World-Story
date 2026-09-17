/**
 * ARMY-MOVE — le truppe si muovono, i blocchi sono espliciti
 * ========================================================
 * Diagnosi reale (turno 5 del gioco 1815 dell'utente, data 1816-04-02):
 *
 *   [GameSession] move_unit non applicato: destinazione non risolta {
 *     destinazione: 'Confederazione Germanica', origine: 'Confederazione Germanica',
 *     'unità': 'Battaglione federale di fanteria del Sud' }
 *
 * Il modello aveva emesso `move_unit`, ma la destinazione coincideva con la
 * regione di partenza (su una mappa a livello di paese «Monaco di Baviera» è una
 * città dentro la Confederazione Germanica): il movimento veniva scartato con un
 * solo `console.warn`. Il giocatore leggeva la narrativa del dirottamento e
 * l'unità restava ferma. Qui si verifica il parser deterministico (con
 * motivazione) e le note esplicite che finiscono nei dispacci.
 */
import { describe, expect, it } from 'vitest';
import { analyzeMovementOrder, parseMovementOrder } from '../src/utils/movement-orders';
import { buildMovementNotices } from '../src/game/movementNotices';

function region(id: string, name: string, owner: string, objects: any[] = []) {
  return { id, name, owner, objects };
}

const REGIONS = [
  region('W_DEU', 'Confederazione Germanica', 'DEU', [
    { id: 'unit-sud', type: 'battalion', name: 'Battaglione Sud', owner: 'DEU' },
    { id: 'mob-sud', type: 'mobilization', name: 'Battaglione Nord', owner: 'DEU', metadata: { status: 'forming', plannedType: 'battalion' } },
    { id: 'city-munich', type: 'city', name: 'Munich', owner: 'DEU' },
  ]),
  region('W_AUT', "Impero d'Austria", 'AUT', [
    { id: 'city-vienna', type: 'city', name: 'Vienna', owner: 'AUT' },
    { id: 'unit-aut', type: 'battalion', name: 'Corpo austriaco del Reno', owner: 'AUT' },
  ]),
  region('W_FRA', 'Regno di Francia', 'FRA', [{ id: 'city-paris', type: 'city', name: 'Paris', owner: 'FRA' }]),
];

describe('ARMY-MOVE — parser deterministico con motivazione', () => {
  it('sposta la formazione nominata verso una regione', () => {
    const analysis = analyzeMovementOrder('Sposta il Battaglione Sud in Impero d\'Austria', REGIONS, 'DEU', 'a1');
    expect(analysis.block).toBeUndefined();
    expect(analysis.intents).toHaveLength(1);
    expect(analysis.intents[0]).toMatchObject({ actionId: 'a1', unitId: 'unit-sud', originId: 'W_DEU', targetId: 'W_AUT' });
  });

  it('accetta una CITTÀ come destinazione (stessa regola di resolveMovementRegion)', () => {
    const analysis = analyzeMovementOrder('Sposta il Battaglione Sud a Vienna', REGIONS, 'DEU', 'a2');
    expect(analysis.block).toBeUndefined();
    expect(analysis.intents.map(intent => intent.targetId)).toEqual(['W_AUT']);
  });

  it('una mobilitazione in formazione è spostabile (plannedType battalion)', () => {
    const analysis = analyzeMovementOrder('Sposta il Battaglione Nord a Vienna', REGIONS, 'DEU', 'a3');
    expect(analysis.intents).toHaveLength(1);
    expect(analysis.intents[0]).toMatchObject({ unitId: 'mob-sud', unitType: 'battalion' });
    expect(analyzeMovementOrder('Sposta il Battaglione Nord a Vienna', REGIONS, 'DEU', 'a3').block).toBeUndefined();
  });

  it('spiega i blocchi invece di restare in silenzio', () => {
    const noDestination = analyzeMovementOrder('Sposta il Battaglione Sud verso il confine', REGIONS, 'DEU', 'b1');
    expect(noDestination.intents).toEqual([]);
    expect(noDestination.block?.code).toBe('no_destination');
    expect(noDestination.block?.message).toContain('destinazione');

    const negated = analyzeMovementOrder('Non spostare il Battaglione Sud in Impero d\'Austria', REGIONS, 'DEU', 'b2');
    expect(negated.block?.code).toBe('negated');

    // Una città interna al proprio paese non è una destinazione valida su una
    // mappa a livello di paese: la menzione esiste ma senza ruolo direzionale.
    const internalCity = analyzeMovementOrder('Sposta il Battaglione Sud a Monaco di Baviera', REGIONS, 'DEU', 'b3');
    expect(internalCity.intents).toEqual([]);
    expect(internalCity.block).toBeDefined();

    const foreignUnit = analyzeMovementOrder('Sposta il Corpo austriaco del Reno in Regno di Francia', REGIONS, 'DEU', 'b4');
    expect(foreignUnit.block?.code).toBe('not_owned');

    // Due formazioni del giocatore sono battaglioni: il riferimento generico
    // non è univoco e il motore rifiuta di scegliere al posto del giocatore.
    const ambiguous = analyzeMovementOrder('Sposta il battaglione in Regno di Francia', REGIONS, 'DEU', 'b5');
    expect(ambiguous.intents).toEqual([]);
    expect(ambiguous.block?.code).toBe('ambiguous_unit');

    // Con una sola formazione di quel tipo il riferimento generico è univoco.
    const singleUnit = [
      region('W_DEU', 'Confederazione Germanica', 'DEU', [{ id: 'unit-sud', type: 'battalion', name: 'Battaglione Sud', owner: 'DEU' }]),
      REGIONS[1],
    ];
    const single = analyzeMovementOrder('Sposta il battaglione a Vienna', singleUnit, 'DEU', 'b6');
    expect(single.intents.map(intent => intent.unitId)).toEqual(['unit-sud']);
  });

  it('non è un ordine di movimento: nessun blocco da mostrare', () => {
    const analysis = analyzeMovementOrder('Apriamo un negoziato con il Regno di Francia', REGIONS, 'DEU', 'c1');
    expect(analysis).toEqual({ intents: [] });
    expect(parseMovementOrder('Apriamo un negoziato con il Regno di Francia', REGIONS, 'DEU', 'c1')).toEqual([]);
  });

  it('parseMovementOrder resta la stessa funzione di prima (solo intenti)', () => {
    const text = 'Sposta il Battaglione Sud a Vienna';
    expect(parseMovementOrder(text, REGIONS, 'DEU', 'd1')).toEqual(analyzeMovementOrder(text, REGIONS, 'DEU', 'd1').intents);
  });
});

describe('ARMY-MOVE — note esplicite per i movimenti non eseguiti', () => {
  const AFTER_NO_MOVE = [
    region('W_DEU', 'Confederazione Germanica', 'DEU', [{ id: 'unit-sud', type: 'battalion', name: 'Battaglione Sud', owner: 'DEU' }]),
    region('W_FRA', 'Regno di Francia', 'FRA', []),
  ];

  it('un intento accettato che non ha spostato nulla produce una motivazione', () => {
    const notes = buildMovementNotices({
      accepted: [{ actionId: 'a1', text: 'Sposta il Battaglione in Regno di Francia' }],
      analyses: [{ actionId: 'a1' }],
      intents: [{
        actionId: 'a1', unitId: 'unit-sud', unitName: 'Battaglione Sud',
        unitType: 'battalion', originId: 'W_DEU', targetId: 'W_FRA', fingerprint: '{}',
      }],
      regions: AFTER_NO_MOVE,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Movimento non eseguito');
    expect(notes[0]).toContain('Confederazione Germanica');
    expect(notes[0]).toContain('Regno di Francia');
  });

  it('destinazione uguale all\'origine: spiega perché non c\'è spostamento', () => {
    const notes = buildMovementNotices({
      accepted: [{ actionId: 'a1', text: 'Presidio a Monaco di Baviera' }],
      analyses: [{ actionId: 'a1' }],
      intents: [{
        actionId: 'a1', unitId: 'unit-sud', unitName: 'Battaglione Sud',
        unitType: 'battalion', originId: 'W_DEU', targetId: 'W_DEU', fingerprint: '{}',
      }],
      regions: AFTER_NO_MOVE,
    });
    expect(notes[0]).toContain('coincide con la regione di partenza');
  });

  it('nessuna nota quando l\'unità si è mossa davvero, o è stata rimossa', () => {
    const moved = [
      region('W_DEU', 'Confederazione Germanica', 'DEU', []),
      region('W_FRA', 'Regno di Francia', 'FRA', [{ id: 'unit-sud', type: 'battalion', name: 'Battaglione Sud', owner: 'DEU' }]),
    ];
    const intent = {
      actionId: 'a1', unitId: 'unit-sud', unitName: 'Battaglione Sud',
      unitType: 'battalion', originId: 'W_DEU', targetId: 'W_FRA', fingerprint: '{}',
    };
    expect(buildMovementNotices({ accepted: [{ actionId: 'a1', text: 'x' }], analyses: [], intents: [intent], regions: moved })).toEqual([]);
    expect(buildMovementNotices({ accepted: [{ actionId: 'a1', text: 'x' }], analyses: [], intents: [intent], regions: AFTER_NO_MOVE.map(r => ({ ...r, objects: [] })) })).toEqual([]);
  });

  it('un movimento eseguito con scorte insufficienti lo dice', () => {
    const moved = [
      region('W_DEU', 'Confederazione Germanica', 'DEU', []),
      region('W_FRA', 'Regno di Francia', 'FRA', [{
        id: 'unit-sud', type: 'battalion', name: 'Battaglione Sud', owner: 'DEU',
        metadata: { logistics: { food: 1, fuel: 1, money: 1, motorized: false, covered: false } },
      }]),
    ];
    const notes = buildMovementNotices({
      accepted: [{ actionId: 'a1', text: 'x' }],
      analyses: [],
      intents: [{
        actionId: 'a1', unitId: 'unit-sud', unitName: 'Battaglione Sud',
        unitType: 'battalion', originId: 'W_DEU', targetId: 'W_FRA', fingerprint: '{}',
      }],
      regions: moved,
    });
    expect(notes[0]).toContain('scorte insufficienti');
  });

  it('un blocco del parser diventa la motivazione mostrata', () => {
    const notes = buildMovementNotices({
      accepted: [{ actionId: 'a1', text: 'Sposta il battaglione verso il confine' }],
      analyses: [{ actionId: 'a1', block: { code: 'no_destination', message: 'nessuna destinazione riconosciuta: …' } }],
      intents: [],
      regions: AFTER_NO_MOVE,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('nessuna destinazione riconosciuta');
  });

  it('un esito non accettato non riceve note del motore', () => {
    expect(buildMovementNotices({ accepted: [], analyses: [{ actionId: 'a1', block: { code: 'no_destination', message: 'x' } }], intents: [], regions: AFTER_NO_MOVE })).toEqual([]);
  });
});

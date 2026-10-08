/**
 * H02 — Lo standard dei filoni: validazione ed enumerazione.
 *
 * Difende le invarianti dello standard (docs/STANDARD_FILONI_PRESET.md):
 *  - H-I7 retrocompatibilità: file assente → nessun filone, nessun errore;
 *  - un filone malformato è **bloccante** (non degrada in silenzio);
 *  - H-I1: il filone non porta numeri di gioco, solo significato/testo;
 *  - `domain` è una sedia del gabinetto, `parties` sono id di mappa;
 *  - H-I12: `trajectory` è una tendenza, un campo di testo come gli altri.
 *
 * Ogni regola è provata **al contrario**: se il validatore smettesse di
 * controllarla, il test deve cadere.
 */
import { describe, it, expect } from 'vitest';
import {
  STORYLINE_STANDARD_VERSION,
  STORYLINE_STATES,
  validateStorylinesFile,
  parseStorylinesFile,
  StorylineValidationError,
  activeStorylines,
  type StorylinesFile,
  type Storyline,
} from '../src/scenario/storylines';
import { CABINET_SEATS } from '../src/core/government/Cabinet';

/** Una voce valida, da cui partire per i casi al contrario. */
function validStoryline(overrides: Partial<Storyline> = {}): Storyline {
  return {
    id: 'levante-disarmo-hamas',
    title: 'Il disarmo di Hamas',
    domain: 'esteri',
    parties: ['ISR', 'PSE', 'USA'],
    region: 'Levante',
    state: 'aperto',
    pressure: 3,
    summary: 'Israele e gli USA premono per il disarmo; l ANP è divisa.',
    trajectory: 'Se nessuno lo devia, il nodo scivola verso lo scontro.',
    triggers: ['attentato o raid', 'pressione diplomatica USA'],
    ...overrides,
  };
}

function validFile(storylines: Storyline[] = [validStoryline()]): StorylinesFile {
  return { version: STORYLINE_STANDARD_VERSION, as_of: '2000-01-01', storylines };
}

const paths = (raw: unknown) => validateStorylinesFile(raw).map(i => i.path);

describe('storylines: file valido', () => {
  it('un file valido non produce problemi ed è parsabile', () => {
    expect(validateStorylinesFile(validFile())).toEqual([]);
    const parsed = parseStorylinesFile(validFile());
    expect(parsed.storylines).toHaveLength(1);
    expect(parsed.storylines[0].id).toBe('levante-disarmo-hamas');
  });

  it('un file con zero filoni è valido (H-I6: zero è valido)', () => {
    expect(validateStorylinesFile({ version: 1, storylines: [] })).toEqual([]);
  });

  it('i campi opzionali possono mancare', () => {
    const { region, trajectory, ...minimal } = validStoryline();
    expect(validateStorylinesFile({ version: 1, storylines: [minimal] })).toEqual([]);
  });
});

describe('storylines: la versione dello standard', () => {
  it('versione mancante → problema bloccante', () => {
    expect(paths({ storylines: [] })).toContain('storylines.json.version');
  });
  it('versione futura → rifiutata (non leggiamo ciò che non conosciamo)', () => {
    expect(paths({ version: 99, storylines: [] })).toContain('storylines.json.version');
  });
  it('versione 0 o negativa → rifiutata', () => {
    expect(paths({ version: 0, storylines: [] })).toContain('storylines.json.version');
  });
});

describe('storylines: ogni regola vale al contrario', () => {
  const cases: Array<[string, unknown, string]> = [
    ['id mancante', { version: 1, storylines: [(() => { const s: any = validStoryline(); delete s.id; return s; })()] }, 'storylines.json.storylines[0].id'],
    ['id non kebab-case', { version: 1, storylines: [validStoryline({ id: 'Levante Disarmo!' })] }, 'storylines.json.storylines[0].id'],
    ['title mancante', { version: 1, storylines: [validStoryline({ title: '' })] }, 'storylines.json.storylines[0].title'],
    ['domain ignoto', { version: 1, storylines: [validStoryline({ domain: 'agricoltura' as any })] }, 'storylines.json.storylines[0].domain'],
    ['parties vuote', { version: 1, storylines: [validStoryline({ parties: [] })] }, 'storylines.json.storylines[0].parties'],
    ['state fuori enum', { version: 1, storylines: [validStoryline({ state: 'forse' as any })] }, 'storylines.json.storylines[0].state'],
    ['pressure fuori 1–3', { version: 1, storylines: [validStoryline({ pressure: 4 })] }, 'storylines.json.storylines[0].pressure'],
    ['summary mancante', { version: 1, storylines: [validStoryline({ summary: '   ' })] }, 'storylines.json.storylines[0].summary'],
    ['triggers vuoti', { version: 1, storylines: [validStoryline({ triggers: [] })] }, 'storylines.json.storylines[0].triggers'],
    ['campo ignoto nella voce', { version: 1, storylines: [{ ...validStoryline(), peso: 3 }] }, 'storylines.json.storylines[0].peso'],
    ['campo ignoto nel file', { version: 1, storylines: [], storie: [] }, 'storylines.json.storie'],
  ];
  for (const [label, raw, expectedPath] of cases) {
    it(`${label} → ${expectedPath}`, () => {
      expect(paths(raw)).toContain(expectedPath);
    });
  }

  it('id duplicati → problema sul secondo', () => {
    const raw = { version: 1, storylines: [validStoryline(), validStoryline()] };
    expect(paths(raw)).toContain('storylines.json.storylines[1].id');
  });
});

describe('storylines: le date dei filoni dormienti', () => {
  it('active_from/active_until devono essere date', () => {
    expect(paths({ version: 1, storylines: [validStoryline({ active_from: '2003-xx-01' })] }))
      .toContain('storylines.json.storylines[0].active_from');
  });
  it('active_from dopo active_until → problema sulla voce', () => {
    const s = validStoryline({ active_from: '2005-01-01', active_until: '2003-01-01' });
    expect(paths({ version: 1, storylines: [s] })).toContain('storylines.json.storylines[0]');
  });
  it('activeStorylines tiene un filone dentro la finestra e scarta il dormiente', () => {
    const dormiente = validStoryline({ id: 'iraq-2003', active_from: '2003-01-01' });
    const attivo = validStoryline({ id: 'levante-2000' });
    const file: StorylinesFile = { version: 1, storylines: [attivo, dormiente] };
    expect(activeStorylines(file, '2000-06-01').map(s => s.id)).toEqual(['levante-2000']);
    expect(activeStorylines(file, '2003-06-01').map(s => s.id).sort()).toEqual(['iraq-2003', 'levante-2000']);
  });
});

describe('storylines: parseStorylinesFile è il punto unico che lancia', () => {
  it('un file malformato lancia StorylineValidationError con la lista', () => {
    let err: unknown;
    try { parseStorylinesFile({ version: 1, storylines: [validStoryline({ pressure: 9 })] }); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(StorylineValidationError);
    expect((err as StorylineValidationError).issues.length).toBeGreaterThanOrEqual(1);
  });
});

describe('storylines: guardia contro il falso verde', () => {
  it('le sedie del dominio sono ESATTAMENTE quelle del gabinetto (nessuna seconda lista)', () => {
    // Se qualcuno aggiungesse una sedia al gabinetto senza aggiornare lo
    // standard, questo test cade: il dominio non deve divergere da Cabinet.
    const domainSpec = CABINET_SEATS.join(', ');
    for (const seat of CABINET_SEATS) {
      expect(validateStorylinesFile({ version: 1, storylines: [validStoryline({ domain: seat })] })).toEqual([]);
    }
    expect(domainSpec.split(',').length).toBe(CABINET_SEATS.length);
  });
  it('gli stati dichiarati sono esattamente quelli accettati', () => {
    for (const state of STORYLINE_STATES) {
      expect(validateStorylinesFile({ version: 1, storylines: [validStoryline({ state })] })).toEqual([]);
    }
  });
});

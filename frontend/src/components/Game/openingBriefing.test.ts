/**
 * WS-GAME-OPENING — Il read model risponde alle cinque domande, senza inventare.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveGameOpening, deriveNeighbors, deriveNationReadings, extractOpeningParagraphs, formatOpeningDate,
} from './openingBriefing';

const items = [
  { id: 'infra', severity: 'warning', label: 'Ricostruzione incompleta', detail: 'La rete limita lo sviluppo.' },
  { id: 'industry', severity: 'opportunity', label: 'Opportunità industriale' },
  { id: 'cohesion', severity: 'info', label: 'Coesione da curare' },
];

const input = {
  world: {
    name: 'Millennium Dawn',
    basePrompt: 'PRESET_MARKER_WORLD. La Guerra Fredda è finita, ma il nuovo ordine è instabile.\n\nL’Europa prepara una nuova espansione verso est e la Russia si trasforma.',
  },
  currentDate: '2000-01-01',
  nationalName: 'Bosnia ed Erzegovina',
  nationalAccount: {
    population: 3_800_000, annualGrowthRate: 1, monthlyBalance: -0.8,
    stability: 45, socialTension: 60, militaryPower: 12, debtRatioPct: 40,
  },
  relationships: { BIH: { SRB: 'hostile', HRV: 'neutral', EU: 'ally' } },
  relationshipNames: { SRB: 'Serbia', HRV: 'Croazia', EU: 'Unione Europea' },
  strategicAgenda: {
    powers: [{ polityId: 'USA', name: 'Stati Uniti', objectives: [{ id: 'o1', description: 'Stabilità nei Balcani', type: 'x', priority: 1, progress: 0, since: '', reviewDate: '', reason: '' }] }],
  },
  playerPolityId: 'BIH',
  council: [{ seat: 'lavori', label: 'Ministro dei Lavori', line: 'Ditemi dove e io vi dico cosa serve per partire.' }],
  items,
};

describe('WS-GAME-OPENING — deriveGameOpening', () => {
  it('risponde alle cinque domande d’apertura', () => {
    const opening = deriveGameOpening(input);
    // 1. DOVE SONO
    expect(opening.world.name).toBe('Millennium Dawn');
    expect(opening.world.dateLabel).toBe('1 GENNAIO 2000');
    expect(opening.world.paragraphs.join(' ')).toContain('Guerra Fredda');
    // 2. CHI GOVERNO
    expect(opening.nation.name).toBe('Bosnia ed Erzegovina');
    expect(opening.nation.readings.length).toBeGreaterThanOrEqual(4);
    // 3. COSA È SUCCESSO FINORA
    expect(opening.nation.identity).toBeTruthy();
    // 4. PROBLEMI/OPPORTUNITÀ
    expect(opening.inheritedSituation.length).toBe(3);
    expect(opening.inheritedSituation[0].symbol).toBe('problem');
    expect(opening.inheritedSituation[1].symbol).toBe('opportunity');
    // 5. COSA POSSO FARE
    expect(opening.entryPoints.map(point => point.id)).toEqual(['orders', 'map', 'advisor']);
  });

  it('il mondo viene dal preset, non da conoscenza generica: nessun testo se il preset manca', () => {
    const opening = deriveGameOpening({ ...input, world: { name: 'X', basePrompt: '' } });
    expect(opening.world.paragraphs).toEqual([]);
    // Il marker del preset arriva, e non compare se non è nel preset.
    const fromPreset = deriveGameOpening(input).world.paragraphs.join(' ');
    expect(fromPreset).toContain('PRESET_MARKER_WORLD');
    expect(fromPreset).not.toContain('MILLENNIUM_GENERIC_KNOWLEDGE');
  });

  it('espone la premessa grezza (§3) e applica il budget parole desktop/mobile (§4)', () => {
    expect(deriveGameOpening(input).world.premise).toContain('PRESET_MARKER_WORLD');
    const long = Array.from({ length: 500 }, (_, i) => `Parola${i}`).join(' ');
    const wide = deriveGameOpening({ ...input, world: { name: 'X', basePrompt: long } });
    const compact = deriveGameOpening({ ...input, world: { name: 'X', basePrompt: long } }, { compact: true });
    const words = (o: typeof wide) => o.world.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
    expect(words(wide)).toBeLessThanOrEqual(220);
    expect(words(compact)).toBeLessThanOrEqual(160);
    expect(words(compact)).toBeLessThan(words(wide));
  });

  it('distingue i tre livelli: Mondo (preset) / Paese (motore) / Agenda (briefing)', () => {
    const opening = deriveGameOpening(input);
    expect(opening.world.paragraphs.join(' ')).toContain('PRESET_MARKER_WORLD'); // preset
    expect(opening.nation.readings.some(r => r.key === 'finances')).toBe(true); // motore
    expect(opening.firstQuestions.map(q => q.label)).toEqual(items.map(i => i.label)); // briefing
  });

  it('mostra problemi e opportunità solo se supportati dallo stato', () => {
    const noProblems = deriveGameOpening({ ...input, items: [{ id: 'o', severity: 'opportunity', label: 'Solo opportunità' }] });
    expect(noProblems.inheritedSituation.every(i => i.symbol === 'opportunity')).toBe(true);
    const empty = deriveGameOpening({ ...input, items: [] });
    expect(empty.inheritedSituation).toEqual([]);
  });

  it('il consiglio è al massimo tre voci e non introduce cifre', () => {
    const many = deriveGameOpening({
      ...input,
      council: [
        { seat: 'lavori', label: 'Lavori', line: 'Ditemi dove e io vi dico cosa serve per partire.' },
        { seat: 'tesoro', label: 'Tesoro', line: 'Facciamo i conti prima di promettere.' },
        { seat: 'esteri', label: 'Esteri', line: 'Ogni porta aperta è un’opzione in più.' },
        { seat: 'guerra', label: 'Guerra', line: 'La forza che rassicura è quella che non deve sparare.' },
      ],
    });
    expect(many.council).toHaveLength(3);
    for (const voice of many.council) expect(/\d/.test(voice.line)).toBe(false);
  });

  it('senza narrative dal server usa le sedie del motore come fallback', () => {
    const opening = deriveGameOpening({
      ...input,
      council: null,
      cabinetAddresses: [
        { seat: 'tesoro', label: 'Ministro del Tesoro', opening: 'Ho la responsabilità della cassa, del debito e del credito del paese. Ho 1 cosa da portare.' },
      ],
    });
    expect(opening.council).toHaveLength(1);
    expect(opening.council[0].line).toBe('Ho la responsabilità della cassa, del debito e del credito del paese.');
  });

  it('i vicini vengono dal motore, non inventati', () => {
    const neighbors = deriveNeighbors(input);
    expect(neighbors.map(n => n.name)).toEqual(expect.arrayContaining(['Serbia', 'Croazia', 'Unione Europea']));
    expect(neighbors.length).toBeLessThanOrEqual(5);
    expect(neighbors.find(n => n.name === 'Serbia')?.tone).toBe('warning');
    expect(neighbors.find(n => n.name === 'Unione Europea')?.tone).toBe('positive');
  });

  it('le letture del paese sono qualitative, non un dashboard', () => {
    const readings = deriveNationReadings(input);
    expect(readings.length).toBeGreaterThanOrEqual(4);
    expect(readings.length).toBeLessThanOrEqual(6);
    expect(readings.find(r => r.key === 'finances')?.value).toContain('margine');
  });

  it('mostra il governo ereditato dal motore (§7), senza numeri', () => {
    const readings = deriveNationReadings({
      ...input,
      government: { cohesion: 40, pressureIndex: 70, factions: [], dominantId: null, angriestId: null, headline: '', budget: {} } as never,
    });
    const gov = readings.find(r => r.key === 'government');
    expect(gov).toBeTruthy();
    expect(gov?.tone).toBe('warning');
    expect(readings.length).toBeLessThanOrEqual(6);
    // Le letture qualitative non portano cifre (la popolazione è l'eccezione, §7).
    for (const reading of readings.filter(r => r.key !== 'population')) {
      expect(/\d/.test(reading.value)).toBe(false);
    }
  });

  it('formatta la data in italiano e non inventa una data mancante', () => {
    expect(formatOpeningDate('2000-01-01')).toBe('1 GENNAIO 2000');
    expect(formatOpeningDate('')).toBe('');
    expect(formatOpeningDate(null)).toBe('');
  });
});

describe('WS-GAME-OPENING — extractOpeningParagraphs', () => {
  it('estrae pochi paragrafi, senza lore completo né markdown', () => {
    const paragraphs = extractOpeningParagraphs('# Titolo\n\nPrimo paragrafo abbastanza lungo da restare nel prologo.\n\n- Secondo blocco, **con enfasi** e una lista.', 4, 100);
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs.length).toBeLessThanOrEqual(4);
    expect(paragraphs.join(' ')).not.toContain('#');
    expect(paragraphs.join(' ')).not.toContain('**');
    expect(paragraphs.join(' ')).not.toContain('- Secondo');
  });

  it('è deterministica', () => {
    const a = extractOpeningParagraphs('Uno. Due. Tre.\n\nQuattro. Cinque.');
    const b = extractOpeningParagraphs('Uno. Due. Tre.\n\nQuattro. Cinque.');
    expect(a).toEqual(b);
  });
});

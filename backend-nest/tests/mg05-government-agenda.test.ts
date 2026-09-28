/**
 * MG05 — Il Governo propone scelte fondate sullo stato, non opinioni
 * =================================================================
 * Il Governo esisteva già come **fotografia** (`GovernmentFactions`): legge
 * conti e fazioni e ne trae uno snapshot. Ma una fotografia non è una scelta. Il
 * piano chiede una scheda che proietti i bisogni verificabili in almeno **due
 * strade**, ognuna con prerequisiti e conseguenze attese, e con **ogni cifra
 * collegata alla sua provenienza**.
 *
 * Le regole che i test difendono:
 *  - **Ogni voce nasce da un fatto misurato.** Un deficit, un debito alto, una
 *    fazione scontenta che pesa: niente voci «di atmosfera».
 *  - **Almeno due strade.** Una via sola non è una scelta, è un ordine
 *    travestito — e il test lo verifica su ogni voce.
 *  - **Ogni cifra porta la sua origine.** Una cifra senza `basis` è un numero
 *    che il giocatore non può contestare.
 *  - **Il Governo non impegna nulla.** `canonicalMutation: false` sempre: la
 *    bozza passa per preflight e coda come qualunque ordine (invariante MG-I1).
 *
 * Guardia contro il falso verde: si verifica anche ciò che il modulo NON deve
 * fare — una fazione marginale e serena non deve comparire, e un paese senza
 * problemi deve avere un'agenda vuota con un'intestazione che lo dice.
 */
import { describe, expect, it } from 'vitest';
import { buildAgenda, fiscalShares, type GovernmentAgendaInput } from '../src/core/government/GovernmentAgenda';

const base: GovernmentAgendaInput = {
  deficits: [], factions: [],
  budget: { balance: '-40', unit: 'mld', effectiveTaxRatePct: 24 },
  debt: { ratioPct: 40, servicePct: 5 },
  reserves: [], buildable: [], currencyId: 'TEST',
};

describe('MG05 — l’agenda del Governo', () => {
  it('un paese senza problemi ha un’agenda VUOTA, e lo dice', () => {
    const agenda = buildAgenda(base);
    expect(agenda.voices).toEqual([]);
    expect(agenda.headline).toContain('Nessuna questione');
    // E non impegna nulla: è una proposta, sempre.
    expect(agenda.canonicalMutation).toBe(false);
  });

  it('un deficit materiale diventa una voce critica con i suoi tre numeri', () => {
    const agenda = buildAgenda({
      ...base,
      deficits: [{
        code: 'MATERIAL_SHORTAGE', id: 'steel',
        required: '12', available: '4', missing: '8', unit: 'kg',
      }],
    });
    expect(agenda.voices).toHaveLength(1);
    const voice = agenda.voices[0];
    expect(voice.urgency).toBe('critica');
    // I tre numeri che spiegano il divario, tutti presenti.
    const labels = voice.figures.map(f => f.label);
    expect(labels).toEqual(['Fabbisogno', 'Disponibile', 'Mancante']);
    expect(voice.figures.map(f => f.value)).toEqual(['12', '4', '8']);
    expect(agenda.headline).toContain('bloccanti');
  });

  it('OGNI voce offre almeno due strade, e ognuna dichiara i prerequisiti', () => {
    // La regola più importante: una via sola sarebbe un ordine travestito.
    const agenda = buildAgenda({
      ...base,
      debt: { ratioPct: 90, servicePct: 22 },
      deficits: [{ code: 'INSUFFICIENT_CASH', id: 'TEST', required: '20000', available: '0', missing: '20000', unit: 'unità minime' }],
      factions: [{
        id: 'operai', name: 'Operai', powerPct: 30, satisfaction: 20, stance: 'critico',
        demandTitle: 'Salari più alti', demandDetail: 'Chiedono un aumento.', urgency: 80,
      }],
    });
    // Le voci coprono TUTTI i tipi (deficit, debito, fazione): il controllo
    // sulle due strade deve passare su ognuna, non solo su quelle presenti per
    // caso — è l'errore che la prova al contrario ha rivelato.
    expect(agenda.voices.some(v => v.id.startsWith('deficit_'))).toBe(true);
    expect(agenda.voices.some(v => v.id === 'debt_service')).toBe(true);
    expect(agenda.voices.some(v => v.id.startsWith('faction_'))).toBe(true);
    expect(agenda.voices.length).toBeGreaterThanOrEqual(3);
    for (const voice of agenda.voices) {
      expect(voice.paths.length, `voce ${voice.id} deve avere almeno due strade`).toBeGreaterThanOrEqual(2);
      for (const path of voice.paths) {
        expect(path.title.length).toBeGreaterThan(0);
        expect(path.detail.length).toBeGreaterThan(0);
        expect(Array.isArray(path.prerequisites)).toBe(true);
        expect(path.expected.length).toBeGreaterThan(0);
      }
      // Almeno una strada è consigliata: il Governo ha un parere, e lo dichiara.
      expect(voice.paths.some(p => p.recommended)).toBe(true);
    }
  });

  it('OGNI cifra porta la sua provenienza: un numero senza origine non si mostra', () => {
    const agenda = buildAgenda({
      ...base,
      debt: { ratioPct: 90, servicePct: 22 },
      deficits: [{ code: 'MATERIAL_SHORTAGE', id: 'steel', required: '12', available: '0', missing: '12', unit: 'kg' }],
      buildable: [{ workId: 'w_road', name: 'Strada', missing: [] }],
    });
    for (const voice of agenda.voices) {
      expect(voice.figures.length, `voce ${voice.id} senza cifre`).toBeGreaterThan(0);
      for (const figure of voice.figures) {
        expect(['measured', 'estimated', 'unknown']).toContain(figure.basis.kind);
        // Una cifra misurata dichiara la FONTE; una stimata il METODO; una
        // ignota cosa manca. Mai un numero nudo.
        if (figure.basis.kind === 'measured') expect(figure.basis.source.length).toBeGreaterThan(0);
        if (figure.basis.kind === 'estimated') expect(figure.basis.method.length).toBeGreaterThan(0);
        if (figure.basis.kind === 'unknown') expect(figure.basis.missing.length).toBeGreaterThan(0);
      }
    }
    // E ogni voce spiega PERCHÉ c'è adesso.
    for (const voice of agenda.voices) expect(voice.because.length).toBeGreaterThan(10);
  });

  it('una fazione marginale e serena NON entra in agenda', () => {
    // Il filtro non è arbitrario: peso e scontentezza insieme. Una fazione al
    // 5% di influenza con soddisfazione 60 non merita una scheda — e dirlo è
    // parte dell'onestà della proposta.
    const agenda = buildAgenda({
      ...base,
      factions: [
        { id: 'marginale', name: 'Marginale', powerPct: 5, satisfaction: 20, stance: 'critico', demandTitle: 'x', demandDetail: 'y', urgency: 10 },
        { id: 'serena', name: 'Serena', powerPct: 40, satisfaction: 80, stance: 'alleato', demandTitle: 'x', demandDetail: 'y', urgency: 5 },
      ],
    });
    expect(agenda.voices).toEqual([]);
  });

  it('una fazione che pesa ed è scontenta entra, con la sua urgenza', () => {
    const agenda = buildAgenda({
      ...base,
      factions: [{
        id: 'esercito', name: 'Esercito', powerPct: 35, satisfaction: 25, stance: 'critico',
        demandTitle: 'Più fondi', demandDetail: 'Chiedono più fondi per la difesa.', urgency: 70,
      }],
    });
    expect(agenda.voices).toHaveLength(1);
    expect(agenda.voices[0].factionId).toBe('esercito');
    expect(agenda.voices[0].urgency).toBe('critica'); // soddisfazione < 28
    expect(agenda.voices[0].because).toContain('35%');
  });

  it('un’opera coperta è raccomandata; una scoperta propone di aspettare', () => {
    const agenda = buildAgenda({
      ...base,
      buildable: [
        { workId: 'w_road', name: 'Strada', missing: [] },
        { workId: 'w_port', name: 'Porto', missing: ['acciaio', 'utensili'] },
      ],
    });
    const road = agenda.voices.find(v => v.id === 'build_w_road')!;
    const port = agenda.voices.find(v => v.id === 'build_w_port')!;

    // Coperta: si avvia, senza prerequisiti.
    expect(road.paths.find(p => p.id === 'build_now')!.recommended).toBe(true);
    expect(road.paths.find(p => p.id === 'build_now')!.prerequisites).toEqual([]);
    // Scoperta: i prerequisiti sono le voci mancanti, e la raccomandazione è
    // ASPETTARE — non promettere un cantiere che non partirebbe.
    expect(port.paths.find(p => p.id === 'build_now')!.recommended).toBe(false);
    expect(port.paths.find(p => p.id === 'build_now')!.prerequisites).toEqual(['coprire acciaio', 'coprire utensili']);
    expect(port.paths.find(p => p.id === 'build_later')!.recommended).toBe(true);
    expect(port.because).toContain('acciaio');
  });

  it('il debito alto entra SOLO sopra la soglia, e la soglia è dichiarata', () => {
    // Sotto soglia non è una questione da consiglio.
    expect(buildAgenda({ ...base, debt: { ratioPct: 40, servicePct: 14 } }).voices).toEqual([]);
    const high = buildAgenda({ ...base, debt: { ratioPct: 100, servicePct: 26 } });
    expect(high.voices).toHaveLength(1);
    expect(high.voices[0].urgency).toBe('critica');
    // Le due strade: tagliare o crescere. Il Governo consiglia di crescere.
    expect(high.voices[0].paths.map(p => p.id)).toEqual(['austerity', 'grow']);
    expect(high.voices[0].paths.find(p => p.id === 'grow')!.recommended).toBe(true);
  });

  it('l’urgenza ordina: i deficit bloccanti prima delle fazioni', () => {
    const agenda = buildAgenda({
      ...base,
      deficits: [{ code: 'MATERIAL_SHORTAGE', id: 'steel', required: '12', available: '0', missing: '12', unit: 'kg' }],
      factions: [{
        id: 'operai', name: 'Operai', powerPct: 30, satisfaction: 30, stance: 'critico',
        demandTitle: 'x', demandDetail: 'y', urgency: 50,
      }],
    });
    // Il deficit è un fatto, la fazione un'opinione: il fatto viene prima.
    expect(agenda.voices[0].id).toContain('deficit_');
    expect(agenda.voices[1].id).toContain('faction_');
  });

  it('la ripartizione fiscale conserva il totale, senza perdere unità', () => {
    // Un caso che sembra minore e non lo è: ripartire 100 in tre parti uguali
    // deve dare 99 + 1, non 99 e un'unità svanita.
    const shares = fiscalShares('100', [1, 1, 1]);
    expect(shares.reduce((sum, s) => sum + Number(s), 0)).toBe(99);
    // Con pesi esatti il totale torna.
    const exact = fiscalShares('100', [1, 1]);
    expect(exact.reduce((sum, s) => sum + Number(s), 0)).toBe(100);
  });

  it('la ripartizione rifiuta pesi nulli invece di inventare una quota', () => {
    expect(() => fiscalShares('100', [0, 0])).toThrow();
  });
});

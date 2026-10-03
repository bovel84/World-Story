/**
 * P02-bis — Parlare con un ministro: la sua sedia, i suoi numeri
 * =============================================================
 * L'autore ha chiesto il concetto centrale: «il parlare». «I ministri portano
 * problemi, una chat come il consulente con idee e soluzioni, con della grafica
 * dentro e numeri reali. Poi alla fine la chat termina con un ordine.»
 *
 * Questo file difende ciò che rende quella chat **onesta**, e cioè il contesto
 * che si dà al modello. La regola non cambia perché c'è di mezzo un modello
 * linguistico: **il ministro non è una fonte di dati**. Un ministro che
 * inventasse una cifra sarebbe peggio di un ministro muto — darebbe autorevolezza
 * a un numero falso.
 *
 * Le regole che i test difendono:
 *  - **il briefing contiene le cifre con la loro provenienza**, e una cifra
 *    ignota è marcata «DATO MANCANTE» con l'istruzione di dichiararla;
 *  - **il briefing dichiara le regole che il modello non può violare**: usare
 *    solo le cifre date, non impegnare nulla, restare nella competenza;
 *  - **la sedia delimita il contesto**: il briefing del Tesoro non contiene i
 *    cantieri dei Lavori;
 *  - **una chat vuota si apre su un fatto**, non sul vuoto: la domanda
 *    d'apertura è composta dai bisogni, non dal modello.
 *
 * Guardia contro il falso verde: si verifica anche il caso senza bisogni — il
 * ministro deve dire di non avere nulla, e non inventare una preoccupazione.
 */
import { describe, expect, it } from 'vitest';
import { briefingFor, colleagueRedirect, figureLine, ministerDossierFrom, openingMessage, seatForQuestion, seatsWithNeeds } from '../src/core/government/MinisterChat';
import { SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem, type CabinetSession } from '../src/core/government/Cabinet';
import type { GovernmentAgenda, GovernmentVoice } from '../src/core/government/GovernmentAgenda';

function voice(id: string, urgency: GovernmentVoice['urgency'] = 'critica'): GovernmentVoice {
  return {
    id, need: `Bisogno ${id}`, because: `Perché ${id}`, urgency,
    factionId: id.startsWith('faction_') ? 'x' : null,
    figures: [
      { label: 'Fabbisogno', value: '12', unit: 'kg', basis: { kind: 'measured', source: 'distinta dell’opera' } },
      { label: 'Disponibile', value: '4', unit: 'kg', basis: { kind: 'measured', source: 'ledger del ramo' } },
      { label: 'Prezzo', value: '', unit: '', basis: { kind: 'unknown', missing: 'il catalogo non dichiara un prezzo' } },
    ],
    paths: [
      { id: 'produce', title: 'Produrre in casa', detail: 'Capacità interna.', prerequisites: [], expected: 'Il divario si chiude.', recommended: true },
      { id: 'procure', title: 'Cercare fuori', detail: 'Trattare.', prerequisites: ['scorte libere'], expected: 'Arriva dopo il viaggio.', recommended: false },
    ],
  };
}

function address(seat: CabinetAddress['seat'], items: CabinetItem[]): CabinetAddress {
  return { seat, label: `Ministro ${seat}`, reads: `competenze di ${seat}`, items, opening: 'Ho cose da dire.' };
}

const item = (voiceId: string, overrides: Partial<CabinetItem> = {}): CabinetItem => ({
  voiceId,
  need: `Bisogno ${voiceId}`,
  because: `Perché ${voiceId}`,
  urgency: 'critica',
  figures: [
    { label: 'Fabbisogno', value: '12', unit: 'kg', basis: { kind: 'measured', source: 'distinta dell’opera' } },
    { label: 'Prezzo', value: '', unit: '', basis: { kind: 'unknown', missing: 'il catalogo non dichiara un prezzo' } },
  ],
  paths: [
    { id: 'a', title: 'Via A', detail: 'Dettaglio A', prerequisites: [], expected: 'Esito A', recommended: true },
    { id: 'b', title: 'Via B', detail: 'Dettaglio B', prerequisites: ['serve X'], expected: 'Esito B', recommended: false },
  ],
  ...overrides,
});

const emptyAgenda: GovernmentAgenda = { voices: [], headline: '', canonicalMutation: false };

describe('P02-bis — parlare con un ministro', () => {
  it('il briefing porta le cifre con la LORO provenienza', () => {
    const briefing = briefingFor(address('lavori', [item('deficit_MATERIAL_SHORTAGE_steel')]), emptyAgenda);
    expect(ministerDossierFrom(briefing.context)?.issues[0].figures).toEqual([
      { label: 'Fabbisogno', value: '12', unit: 'kg', basis: { kind: 'measured', source: 'distinta dell’opera' } },
      { label: 'Prezzo', value: '', unit: '', basis: { kind: 'unknown', missing: 'il catalogo non dichiara un prezzo' } },
    ]);
  });

  it('una cifra ignota è marcata come mancante, con l’istruzione di dichiararla', () => {
    // Il punto: un modello a cui si dice «non inventare» inventa meno. Il testo
    // del briefing è la guardia, non un ornamento.
    const briefing = briefingFor(address('lavori', [item('deficit_MATERIAL_SHORTAGE_steel')]), emptyAgenda);
    expect(briefing.context).toContain('DATO MANCANTE');
    expect(briefing.context).toContain('dichiaralo, non inventarlo');
  });

  it('il briefing dichiara le REGOLE che il modello non può violare', () => {
    const briefing = briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);
    expect(briefing.context).toContain('REGOLE CHE NON PUOI VIOLARE');
    // Le tre regole che contano: cifre date, nulla di inventato, nessun impegno.
    expect(briefing.context).toContain('Usi SOLO le cifre verificate della sedia');
    expect(briefing.context).toContain('Non impegni nulla');
    expect(briefing.context).toContain('senza rispondere al posto suo');
  });

  it('la sedia delimita il contesto: il Tesoro non riceve i cantieri', () => {
    const briefing = briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);
    expect(briefing.seat).toBe('tesoro');
    expect(briefing.context).toContain('Ministro del Tesoro');
    // Il cantiere dei Lavori non entra nel briefing del Tesoro: nessuna voce di
    // costruzione, nessun workId.
    expect(briefing.context).not.toContain('deficit_MATERIAL');
    expect(ministerDossierFrom(briefing.context)).toEqual({ seat: 'tesoro', issues: [item('debt_service')] });
  });

  it('l’opera, se c’è, entra nel briefing col suo id', () => {
    // Serve perché il modello possa parlarne con cognizione: l'ordine che ne
    // nasce deve dichiarare l'opera al motore.
    const workItem = item('build_w_road', {
      work: { workId: 'w_road', name: 'Strada ordinaria' },
      declaration: {
        workId: 'w_road', payerActorId: 'treasury', materialActorId: null, funded: false,
        missingMaterials: [{ resourceId: 'steel', missing: '8' }],
      },
    });
    const briefing = briefingFor(address('lavori', [workItem]), emptyAgenda);
    const dossier = ministerDossierFrom(briefing.context);
    expect(dossier?.issues[0].work).toEqual({ workId: 'w_road', name: 'Strada ordinaria' });
    expect(dossier?.issues[0].declaration).toEqual({
      workId: 'w_road', payerActorId: 'treasury', materialActorId: null, funded: false,
      missingMaterials: [{ resourceId: 'steel', missing: '8' }],
    });
  });

  it('una chat vuota si apre su un FATTO, non sul vuoto', () => {
    const itemWithNeed = item('deficit_MATERIAL_SHORTAGE_steel');
    const briefing = briefingFor(address('lavori', [itemWithNeed]), emptyAgenda);
    const opening = openingMessage(briefing, [itemWithNeed]);
    // La prima frase è il bisogno misurato, non un saluto.
    expect(opening).toContain('Bisogno deficit_MATERIAL_SHORTAGE_steel');
    expect(opening).toContain('è urgente');
  });

  it('un ministro senza bisogni lo DICE, e non inventa una preoccupazione', () => {
    // Il controllo opposto: una sedia vuota non deve produrre una frase di
    // circostanza che sembri un problema.
    const briefing = briefingFor(address('guerra', []), emptyAgenda);
    expect(briefing.hasNeeds).toBe(false);
    expect(briefing.context).toContain('Non hai nulla da portare');
    const opening = openingMessage(briefing, []);
    expect(opening).toContain('non ho nulla da portare');
    expect(opening).toContain('Chiedimi quello che vuoi');
  });

  it('le strade entrano nel briefing con prerequisiti ed esito atteso', () => {
    const briefing = briefingFor(address('lavori', [item('build_w_road')]), emptyAgenda);
    // Il dossier conserva tutti i campi: non una concatenazione narrativa.
    expect(ministerDossierFrom(briefing.context)?.issues[0].paths).toEqual([
      { id: 'a', title: 'Via A', detail: 'Dettaglio A', prerequisites: [], expected: 'Esito A', recommended: true },
      { id: 'b', title: 'Via B', detail: 'Dettaglio B', prerequisites: ['serve X'], expected: 'Esito B', recommended: false },
    ]);
  });

  it('la provenienza si scrive in italiano, in tre forme', () => {
    expect(figureLine({ label: 'A', value: '5', unit: 'kg', basis: { kind: 'measured', source: 'ledger' } }))
      .toBe('- A: 5 kg (misurato da: ledger)');
    expect(figureLine({ label: 'B', value: '7', unit: 'unità', basis: { kind: 'estimated', source: 'catalogo', method: 'prezzo × quantità' } }))
      .toBe('- B: 7 unità (stimato con: prezzo × quantità)');
    expect(figureLine({ label: 'C', value: '', unit: '', basis: { kind: 'unknown', missing: 'assente' } }))
      .toBe('- C: DATO MANCANTE (assente) — dichiaralo, non inventarlo');
    // E una cifra senza origine non si spaccia per misurata.
    expect(figureLine({ label: 'D', value: '1', unit: '', basis: {} })).toBe('- D: 1');
  });

  it('le sedie con bisogni sono quelle con cui vale la pena parlare', () => {
    const session: CabinetSession = {
      addresses: [address('lavori', [item('build_w_road')]), address('guerra', [])],
      president: { opening: '', closing: '' },
      summary: { total: 1, critical: 1 },
      canonicalMutation: false,
    };
    // La sedia senza bisogni non compare: non si offre una chat che non ha nulla
    // da dire.
    expect(seatsWithNeeds(emptyAgenda, session)).toEqual(['lavori']);
  });

  it('il briefing è deterministico: due letture danno lo stesso testo', () => {
    const a = briefingFor(address('lavori', [item('build_w_road')]), emptyAgenda);
    const b = briefingFor(address('lavori', [item('build_w_road')]), emptyAgenda);
    expect(b.context).toBe(a.context);
    void voice('x');
  });
});

/**
 * WS-GOVOFFICE-05 — Il dialogo raccontato e il collega giusto
 * ============================================================
 * Il ministro deve **raccontare**, non elencare — ma ogni frase deve poggiare su
 * un campo del motore. Le due regole nuove:
 *
 *  - quando la domanda è fuori competenza, il ministro **nomina** il collega
 *    giusto con la sua competenza (non rimbalza in modo secco);
 *  - la chiusura **pone** la scelta, usando i titoli delle strade già dichiarate
 *    — non decide al posto del giocatore.
 *
 * La prosa è composta dai soli campi esistenti: `need`, `because`, `urgency`,
 * `paths[].title`, `SEAT_LABEL`, `SEAT_READS`. Nessun aneddoto, nessuna cifra
 * nuova.
 */
describe('WS-GOVOFFICE-05 — il dialogo raccontato e il collega giusto', () => {
  it('il briefing elenca i colleghi con la loro competenza, senza includere sé stesso', () => {
    const briefing = briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);
    expect(briefing.context).toContain('I TUOI COLLEGHI');
    expect(briefing.context).toContain(SEAT_LABEL.lavori);
    expect(briefing.context).toContain(SEAT_READS.lavori);
    // Istruzione e Sanità sono colleghe come le altre.
    expect(briefing.context).toContain(SEAT_LABEL.istruzione);
    expect(briefing.context).toContain(SEAT_LABEL.sanita);
    // La sedia corrente non compare fra i propri colleghi.
    expect(briefing.context).not.toContain(`- ${SEAT_LABEL.tesoro}:`);
  });

  it('la regola impone di NOMINARE il collega giusto, non di rimbalzare', () => {
    const briefing = briefingFor(address('tesoro', [item('debt_service')]), emptyAgenda);
    expect(briefing.context).toContain('NOMINI il collega giusto');
    expect(briefing.context).toContain('aggiungi il tuo punto di vista');
    // E la regola del racconto. WS-MINISTER-UX-02: niente aneddoti né dati
    // inventati, ma l'opinione è ammessa — dichiarata come tale, su tre livelli.
    expect(briefing.context).toContain('[DIALOGUE STYLE]');
    expect(briefing.context).toContain('Non aggiungere aneddoti, nomi propri, date o promesse');
    expect(briefing.context).toContain('[VERIFIED FACTS]');
    expect(briefing.context).toContain('Usa internamente fatti, interpretazione e consiglio');
    expect(briefing.context).toContain('un’opinione non è un dato');
  });

  it('una domanda fuori competenza nomina naturalmente il collega e aggiunge la propria lettura', () => {
    const redirect = colleagueRedirect('tesoro', 'E le fabbriche? Servono più cantieri.');
    expect(redirect).toContain(SEAT_LABEL.lavori.replace(/^Ministro /, 'il ministro '));
    expect(redirect).toMatch(/Io .*finanziariamente.*margine.*conti/);
    expect(redirect).not.toMatch(/Non è la mia materia|se ne occupa|e legge/);
  });

  it('una domanda in competenza non produce alcun rimando (e non si inventa un collega)', () => {
    // La sedia giusta è la corrente: nessun rimando.
    expect(colleagueRedirect('tesoro', 'Come stanno il debito e il bilancio di cassa?')).toBeNull();
    // Nessun argomento riconoscibile: non si inventa un collega.
    expect(colleagueRedirect('tesoro', 'Buongiorno, come va?')).toBeNull();
  });

  it('la mappa argomento → sedia riconosce le due sedie nuove', () => {
    expect(seatForQuestion('Servono più scuole e atenei.')).toBe('istruzione');
    expect(seatForQuestion('La sanità e gli ospedali reggono?')).toBe('sanita');
  });

  it('il fallback consiglia senza recitare le strade o decidere', () => {
    const itemWithNeed = item('debt_service');
    const opening = openingMessage(briefingFor(address('tesoro', [itemWithNeed]), emptyAgenda), [itemWithNeed]);
    expect(opening).not.toContain('La strada è una scelta:');
    expect(opening).not.toContain('Tocca a te decidere');
    expect(opening).toContain('Bisogno debt_service');
    expect(opening).not.toContain('Perché debt_service');
    expect(opening).toContain('Io verificherei');
    expect(opening).toContain('Vuoi che confrontiamo le coperture');
  });

  it('senza almeno due strade non si finge una scelta', () => {
    const single = item('x', {
      paths: [{ id: 'only', title: 'Solo', detail: 'd', prerequisites: [], expected: 'e', recommended: true }],
    });
    const opening = openingMessage(briefingFor(address('tesoro', [single]), emptyAgenda), [single]);
    expect(opening).not.toContain('Tocca a te decidere');
  });
});

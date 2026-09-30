/**
 * P02 — La seduta del gabinetto: come si legge, e cosa NON deve fare
 * =================================================================
 * L'autore ha chiesto «le persone che chattano con me e propongono i loro piani
 * e bisogni», con **solo tipografia** e nessuna immagine. Questo file difende
 * tre cose che il componente deve garantire, e una che non deve fare mai.
 *
 * Le regole:
 *  - **ogni cifra mostra la sua provenienza**: misurata, stimata, o dichiarata
 *    mancante. Una cifra senza origine non si presenta come un fatto;
 *  - **una sedia senza dati non compare**: il componente non riempie il vuoto;
 *  - **una seduta vuota lo dice**, e non finge un pannello rotto;
 *  - **il componente non registra ordini**: scegliere una strada consegna la
 *    proposta, e la registrazione resta un atto separato (invariante MG-I1).
 *
 * Guardia contro il falso verde: si verifica anche il caso con dati — i ministri
 * e le loro cifre DEVONO comparire. Un componente che non rendesse nulla
 * passerebbe i test sulla seduta vuota.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CabinetSession, basisLabel, isUnknown } from './CabinetSession';
import type { CabinetSessionView } from '../../services/api';

const session = (overrides: Partial<CabinetSessionView> = {}): CabinetSessionView => ({
  addresses: [],
  president: { opening: 'Il consiglio è riunito.', closing: 'Seduta chiusa.' },
  summary: { total: 0, critical: 0 },
  canonicalMutation: false,
  ...overrides,
});

/** Una sedia con una voce e una cifra misurata. */
function seatWithFigures(): CabinetSessionView {
  return session({
    addresses: [{
      seat: 'lavori',
      label: 'Ministro dei Lavori',
      reads: 'cantieri, deficit misurati, opere del catalogo',
      opening: 'Ho 1 cosa da portare al consiglio, 1 urgente.',
      items: [{
        voiceId: 'deficit_MATERIAL_SHORTAGE_steel',
        need: 'Manca acciaio: 8 kg per una costruzione in corso',
        because: 'Il fabbisogno misurato è 12 kg e il disponibile è 4: il cantiere non parte.',
        urgency: 'critica',
        figures: [
          { label: 'Fabbisogno', value: '12', unit: 'kg', basis: { kind: 'measured', source: 'distinta dell’opera' } },
          { label: 'Disponibile', value: '4', unit: 'kg', basis: { kind: 'measured', source: 'ledger del ramo' } },
          { label: 'Costo stimato', value: '300', unit: 'unità', basis: { kind: 'estimated', source: 'catalogo', method: 'prezzo dichiarato × quantità' } },
          { label: 'Prezzo di mercato', value: '', unit: '', basis: { kind: 'unknown', missing: 'il catalogo non dichiara un prezzo' } },
        ],
        paths: [
          { id: 'produce', title: 'Produrre in casa', detail: 'Impiegare capacità interna.', prerequisites: [], expected: 'Il divario si chiude nei tempi della produzione.', recommended: true },
          { id: 'procure', title: 'Cercare fuori', detail: 'Trattare con chi ha quella merce.', prerequisites: ['una controparte con scorte libere'], expected: 'La merce arriva dopo il viaggio.', recommended: false },
        ],
      }],
    }],
    summary: { total: 1, critical: 1 },
  });
}

const render = (props: Parameters<typeof CabinetSession>[0]): string =>
  renderToStaticMarkup(<CabinetSession {...props} />);

describe('P02 — la seduta del gabinetto', () => {
  it('una seduta VUOTA lo dice, e non finge un pannello rotto', () => {
    const html = render({ session: session() });
    expect(html).toContain('Nessun ministro ha dati da portare al consiglio');
    // E il presidente spiega che non è un guasto.
    expect(html).toContain('una seduta vuota è un buon segno');
  });

  it('con i dati, il ministro COMPARE con il suo bisogno e le sue cifre', () => {
    // Il controllo opposto al precedente: senza, un componente muto passerebbe.
    const html = render({ session: seatWithFigures() });
    expect(html).toContain('Ministro dei Lavori');
    expect(html).toContain('Manca acciaio');
    // WS-GOVOFFICE-05B — le cifre si formattano alla resa: 12 kg → 12,00 kg.
    expect(html).toContain('12,00 kg');
    expect(html).toContain('4,00 kg');
    // E la competenza della sedia è dichiarata: chi legge sa cosa guarda.
    expect(html).toContain('cantieri, deficit misurati, opere del catalogo');
  });

  it('OGNI cifra mostra la sua provenienza, e quella ignota non si nasconde', () => {
    const html = render({ session: seatWithFigures() });
    // Misurata: dichiara la fonte.
    expect(html).toContain('misurato · distinta dell’opera');
    // Stimata: dichiara il metodo.
    expect(html).toContain('stimato · prezzo dichiarato × quantità');
    // Ignota: dichiara cosa manca, e mostra un trattino invece di un numero.
    expect(html).toContain('dato mancante · il catalogo non dichiara un prezzo');
    expect(html).toContain('cabinet-figure-unknown');
  });

  it('la provenienza si legge in italiano, senza gergo', () => {
    // La funzione è esportata perché la logica sia verificabile da sola: se il
    // testo cambia, il test lo dice prima della pagina.
    expect(basisLabel({ kind: 'measured', source: 'ledger' })).toBe('misurato · ledger');
    expect(basisLabel({ kind: 'estimated', source: 'catalogo', method: 'prezzo × quantità' })).toBe('stimato · prezzo × quantità');
    expect(basisLabel({ kind: 'unknown', missing: 'prezzo assente' })).toBe('dato mancante · prezzo assente');
    expect(isUnknown({ label: 'x', value: '1', unit: '', basis: { kind: 'unknown', missing: 'y' } })).toBe(true);
    expect(isUnknown({ label: 'x', value: '1', unit: '', basis: { kind: 'measured', source: 'z' } })).toBe(false);
  });

  it('le strade si vedono tutte, con prerequisiti e conseguenze', () => {
    const html = render({ session: seatWithFigures() });
    expect(html).toContain('Produrre in casa');
    expect(html).toContain('Cercare fuori');
    // La strada consigliata è marcata come tale — un consiglio, non un ordine.
    expect(html).toContain('consigliata');
    // I prerequisiti e l'esito atteso sono visibili, non nascosti dietro un clic.
    expect(html).toContain('una controparte con scorte libere');
    expect(html).toContain('La merce arriva dopo il viaggio');
  });

  it('scegliere una strada consegna la proposta, senza registrare nulla', () => {
    // L'invariante MG-I1 applicata alla pagina: il componente non accoda, non
    // spende e non chiama l'API. Consegna la scelta a chi lo usa.
    const chosen: string[] = [];
    const html = render({
      session: seatWithFigures(),
      onChoose: (item, path) => chosen.push(`${item.voiceId}|${path.id}`),
    });
    // La pagina rende i pulsanti: la scelta è dell'utente, non automatica.
    expect(html).toContain('cabinet-path');
    // E nulla è stato scelto durante il rendering.
    expect(chosen).toEqual([]);
  });

  it('lo stato di caricamento e l’errore sono dichiarati, non muti', () => {
    expect(render({ session: null, loading: true })).toContain('Il consiglio si sta riunendo');
    expect(render({ session: null, error: 'La seduta non è disponibile ora.' })).toContain('non è disponibile ora');
    expect(render({ session: null })).toContain('Nessuna seduta disponibile');
  });

  it('la seduta non contiene immagini: è la scelta dell’autore', () => {
    // «Nessuna immagine, solo tipografia»: nessun tag img, nessun ritratto, e
    // nessun elemento grafico che suggerisca un volto.
    const html = render({ session: seatWithFigures() });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('background-image');
  });

  it('il presidente apre e chiude: non è una sesta competenza', () => {
    const html = render({
      session: seatWithFigures(),
      ...{},
    });
    // L'apertura dichiara quante questioni ci sono, la chiusura ricorda che
    // nulla è stato deciso.
    expect(html).toContain('Il consiglio è riunito.');
    expect(html).toContain('Seduta chiusa.');
    // E il presidente non compare come sedia tra i ministri.
    expect(html).not.toContain('data-seat="presidente"');
  });
});

/**
 * WS-GOVOFFICE-05B — Le cifre leggibili, e il refuso che non c'è
 * ==============================================================
 * Il motore manda i valori pieni («0.06575272084693667»): sono la sorgente di
 * verità e non si toccano. Qui si difende la **resa**: 2 decimali (1 se
 * percentuali), virgola italiana — e gli interi del testo («Ho 1 cosa») restano
 * interi. Una cifra ignota resta «—», mai «0,00».
 */
describe('WS-GOVOFFICE-05B — le cifre del ministro', () => {
  it('formatta i valori assoluti: 2 decimali, virgola, migliaia', () => {
    const html = render({ session: seatWithFigures() });
    expect(html).toContain('12,00 kg');
    expect(html).toContain('4,00 kg');
    expect(html).toContain('300,00 unità');
  });

  it('la cifra IGNOTA resta «—»: non diventa 0,00', () => {
    const html = render({ session: seatWithFigures() });
    expect(html).toContain('dato mancante · il catalogo non dichiara un prezzo');
    expect(html).toContain('cabinet-figure-unknown');
    // La cella ignota mostra il trattino, non un numero (e mai «0,00»).
    expect(html).toMatch(/<dd>—<span class="cabinet-basis">dato mancante/);
  });

  it('gli interi del testo non si toccano: «Ho 1 cosa» resta «Ho 1 cosa»', () => {
    const html = render({ session: seatWithFigures() });
    // Il numero è reso lineare (non corsivo) ma è ancora «1», non «1,00».
    expect(html).toContain('<span class="op-numeral">1</span> cosa da portare al consiglio');
    expect(html).not.toContain('1,00 cosa');
  });

  it('i decimali e le percentuali del testo si formattano alla resa', () => {
    // Il caso reale: il «perché» del Tesoro con il saldo a 17 decimali.
    const conDecimali = session({
      addresses: [{
        seat: 'tesoro',
        label: 'Ministro del Tesoro',
        reads: 'bilancio',
        opening: 'Ho 1 cosa da portare al consiglio.',
        items: [{
          voiceId: 'treasury_condition',
          need: 'Il bilancio chiude in avanzo',
          because: 'Il saldo è 0.06575272084693667 mld (0.2% del PIL), al 30.4%.',
          urgency: 'ordinaria',
          figures: [
            { label: 'Saldo', value: '0.06575272084693667', unit: 'mld', basis: { kind: 'measured', source: 'conti nazionali' } },
            { label: 'Saldo su PIL', value: '0.2', unit: '%', basis: { kind: 'measured', source: 'conti nazionali' } },
          ],
          paths: [],
        }],
      }],
    });
    const html = render({ session: conDecimali, onlySeat: 'tesoro' });
    // Griglia: 2 decimali per l'assoluto, 1 per la percentuale.
    expect(html).toContain('0,07 mld');
    expect(html).toContain('0,2 %');
    // Testo narrato: gli stessi valori, con la virgola. I numeri sono resi in
    // <span> (leggibilità), quindi si confronta il testo, non l'HTML.
    const testo = html.replace(/<[^>]*>/g, '');
    expect(testo).toContain('0,07 mld (0,2% del PIL), al 30,4%');
    // Il valore pieno del motore non compare più a schermo.
    expect(html).not.toContain('0.06575272084693667');
  });
});

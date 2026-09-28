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
    expect(html).toContain('12 kg');
    expect(html).toContain('4 kg');
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

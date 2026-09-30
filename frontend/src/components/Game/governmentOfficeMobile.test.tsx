/**
 * WS-GOVOFFICE-04 — Il layout mobile dell'Ufficio del Governo.
 * ===========================================================
 * A ~390 px la seduta a due pannelli si accavallava: `.government-office` è una
 * colonna flex (eredita `display:flex` da `.suggestions-content`), lo split
 * veniva compresso dall'altezza fissa del modale e le due righe della griglia
 * finivano l'una sopra l'altra; in più il nome della sedia era reso in tre
 * punti (schermata, pannello dati, chat) e il piede non conteneva «Chiudi
 * ufficio». Qui si bloccano le invarianti CSS che tengono la schermata su una
 * colonna sola, senza overlap, con **una sola** intestazione visibile e il
 * pulsante dentro il proprio blocco.
 *
 * La verifica geometrica reale (misura degli overlap) vive nell'harness
 * `e2e/govoffice-shot.mjs` — che ora accetta un viewport — e negli screenshot
 * citati in `docs/implementation/WS-GOVOFFICE-04-report.md`. Questo file non
 * duplica quella misura: difende le regole che la rendono possibile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CabinetSession } from './CabinetSession';
import { MinisterDossier } from './MinisterDossier';
import type { CabinetAddressView, CabinetSessionView } from '../../services/api';

const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'editorial.css'), 'utf8');

/** Contenuto del blocco `@media (max-width: 767px) { … }` (parentesi bilanciate). */
function mobileBlock(): string {
  const start = css.indexOf('@media (max-width: 767px)');
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const from = css.indexOf('{', start);
  for (let i = from; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(from, i + 1);
    }
  }
  return css.slice(from);
}

/** Il corpo `{ … }` della prima regola con quel selettore, nel testo dato. */
function rule(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  expect(at, `regola «${selector}» assente`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

/** I selettori che ripetevano il titolo della sedia. */
const SEAT_TITLE_COPIES = ['.minister-dossier-name', '.minister-name', '.cabinet-seat-name'];

describe('WS-GOVOFFICE-04 — layout mobile dell’Ufficio', () => {
  it('la seduta mostra una superficie alla volta: il divisore sparisce e lo split è a una colonna', () => {
    const split = rule(mobileBlock(), '.government-office-split');
    expect(split).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(split).toMatch(/flex:\s*1 1 auto/);
    expect(split).toMatch(/min-height:\s*0/);
    expect(rule(mobileBlock(), '.government-office-divider')).toMatch(/display:\s*none/);
  });

  it('la linguetta attiva decide quale pannello resta visibile (Dialogo / Tavola)', () => {
    const block = mobileBlock();
    expect(rule(block, '.government-office-session[data-mobile-pane="dialogo"] .government-office-pane-table')).toMatch(/display:\s*none/);
    expect(rule(block, '.government-office-session[data-mobile-pane="tavola"] .government-office-pane-chat')).toMatch(/display:\s*none/);
    expect(rule(block, '.minister-session-views')).toMatch(/display:\s*flex/);
  });

  it('i pannelli non hanno scroll annidato: l’altezza la dà la sessione', () => {
    expect(rule(mobileBlock(), '.government-office-pane')).toMatch(/min-height:\s*0/);
    expect(rule(mobileBlock(), '.government-office-pane-table')).toMatch(/min-height:\s*0/);
  });

  it('a ≤767px le copie del titolo della sedia si spengono (una sola intestazione)', () => {
    const block = mobileBlock();
    for (const selector of SEAT_TITLE_COPIES) {
      expect(rule(block, selector), `${selector} deve essere nascosto su mobile`).toMatch(/display:\s*none/);
    }
    // Sul desktop le stesse regole NON nascondono nulla: la guardia vale solo
    // sotto la soglia, il pannello dati resta titolato a schermo largo.
    for (const selector of SEAT_TITLE_COPIES) {
      const base = rule(css, selector);
      expect(base, `${selector} non deve essere nascosto a desktop`).not.toMatch(/display:\s*none/);
    }
  });

  it('il piede si impila e «Chiudi ufficio» resta dentro, a tutta larghezza', () => {
    const footer = rule(mobileBlock(), '.government-office .suggestions-footer');
    expect(footer).toMatch(/flex-direction:\s*column/);
    expect(footer).toMatch(/align-items:\s*stretch/);
    expect(rule(mobileBlock(), '.government-office .btn-submit-actions')).toMatch(/width:\s*100%/);
  });

  it('il campo di scrittura cede spazio: «Invia» resta su una riga', () => {
    expect(rule(css, '.minister-compose input')).toMatch(/min-width:\s*0/);
    expect(rule(css, '.minister-compose textarea')).toMatch(/min-width:\s*0/);
    const button = rule(css, '.minister-compose button');
    expect(button).toMatch(/flex:\s*0 0 auto/);
    expect(button).toMatch(/white-space:\s*nowrap/);
  });
});

/** Una sedia minimale, con una cifra, per il markup. */
function seat(): CabinetAddressView {
  return {
    seat: 'tesoro',
    label: 'Ministro del Tesoro',
    reads: 'cassa, debito e bilancio',
    opening: 'La cassa regge, ma il margine si assottiglia.',
    items: [{
      voiceId: 'voice-1',
      need: 'Coprire il disavanzo del trimestre.',
      because: 'Le uscite superano le entrate del 6%.',
      urgency: 'urgente',
      figures: [{ label: 'Fabbisogno', value: '8', unit: 'mld', basis: { kind: 'measured', source: 'Tesoro' } }],
      paths: [],
    }],
  };
}

const seduta: CabinetSessionView = {
  addresses: [seat()],
  president: { opening: 'Il consiglio è riunito.', closing: 'Seduta chiusa.' },
  summary: { total: 1, critical: 0 },
  canonicalMutation: false,
};

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('WS-GOVOFFICE-04 — il markup non raddoppia l’intestazione', () => {
  it('la seduta rende una sola testata-sedia: la copia che il CSS spegne', () => {
    const html = renderToStaticMarkup(
      <CabinetSession variant="full" onlySeat="tesoro" session={seduta} />,
    );
    expect(count(html, 'class="cabinet-seat-name"')).toBe(1);
    expect(html).toContain('Ministro del Tesoro');
  });

  it('il pannello dati, APERTO, rende una sola intestazione: la copia che il CSS spegne', () => {
    // WS-GOVOFFICE-05 — il contenuto del pannello è reso solo da aperto, perciò
    // il render statico parte da `defaultOpen` per difendere l'invariante.
    const html = renderToStaticMarkup(<MinisterDossier address={seat()} picture={null} defaultOpen />);
    expect(count(html, 'class="minister-dossier-name"')).toBe(1);
  });
});

/**
 * WS-GOVOFFICE-05 — Il pannello dati è a scomparsa
 * =================================================
 * Prima era sempre aperto; ora parte **chiuso** (il dialogo è l'atto centrale) e
 * si apre con un controllo vero: un `<button>` con `aria-expanded` e
 * `aria-controls`. Da aperto mostra esattamente ciò che mostrava prima.
 *
 * Il progetto non ha un DOM nei test (environment `node`, nessuna testing-library):
 * lo stato "aperto" si verifica con `defaultOpen`, che ne è l'innesco dichiarato.
 * Il clic reale è coperto dall'harness E2E `e2e/govoffice-shot.mjs`.
 */
describe('WS-GOVOFFICE-05 — il pannello dati a scomparsa', () => {
  it('parte CHIUSO: il controllo è un pulsante con aria-expanded=false', () => {
    const html = renderToStaticMarkup(<MinisterDossier address={seat()} picture={null} />);
    // Un controllo vero, non un div cliccabile.
    expect(html).toContain('<button');
    expect(html).toContain('class="minister-dossier-toggle"');
    expect(html).toContain('aria-expanded="false"');
    // E indica il corpo che controlla.
    expect(html).toContain('aria-controls="minister-dossier-body"');
    expect(html).toContain('id="minister-dossier-body"');
    // Il corpo è nel DOM ma `hidden` quando chiuso.
    expect(html).toMatch(/id="minister-dossier-body"[^>]*hidden/);
  });

  it('da CHIUSO il contenuto non è reso: nessun dato pesa sul dialogo', () => {
    const html = renderToStaticMarkup(<MinisterDossier address={seat()} picture={null} />);
    expect(html).not.toContain('minister-dossier-name');
    expect(html).not.toContain('minister-figure');
    expect(html).not.toContain('Sul tavolo');
  });

  it('da APERTO mostra tutto ciò che il pannello mostrava prima', () => {
    const html = renderToStaticMarkup(<MinisterDossier address={seat()} picture={null} defaultOpen />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/id="minister-dossier-body"[^>]*hidden/);
    // Nome, cifre e bisogni: nessuna informazione persa.
    expect(html).toContain('class="minister-dossier-name"');
    expect(html).toContain('Ministro del Tesoro');
    expect(html).toContain('minister-figure');
    expect(html).toContain('Sul tavolo');
    expect(html).toContain('Coprire il disavanzo del trimestre.');
  });
});

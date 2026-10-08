/**
 * P02 — Le mosse della proposta sono scegliibili, e il clic **prepara** senza inviare.
 *
 * Test-contratto sul sorgente (convenzione del progetto: `environment: 'node'`,
 * niente render). Difende:
 *  - l'opzione è una **card cliccabile** con titolo e contenuto (forma di Pax);
 *  - il clic **non invia** nulla: passa l'opzione scelta a `onOpenIssue` (P-I2);
 *  - l'opzione scelta è uno **stato di presentazione** (`aria-pressed`), non un atto;
 *  - una proposta **senza opzioni** resta valida e rende come prima (P-I5).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const inline = read('CouncilIssueInline.tsx');
const office = read('GovernmentOffice.tsx');
const css = read('../../index.css');

describe('P02 — la card dell’opzione', () => {
  it('rende le opzioni come pulsanti con titolo e contenuto', () => {
    expect(inline).toContain('council-issue-options');
    expect(inline).toContain('council-option-title');
    expect(inline).toContain('council-option-content');
    expect(inline).toContain('aria-pressed');
  });

  it('una proposta senza opzioni resta valida (P-I5): la lista non si rende', () => {
    // La lista compare solo con `options.length > 0`.
    expect(inline).toMatch(/options\.length > 0/);
  });

  it('il pulsante «Porta al Consiglio» passa l’opzione scelta, o niente', () => {
    expect(inline).toContain("onOpenIssue(issue, chosen === null ? undefined : options[chosen])");
  });

  it('l’opzione scelta è uno stato di PRESENTAZIONE, non un atto', () => {
    // `useState` locale: nessuna chiamata al server nel click di scelta.
    expect(inline).toContain('useState<number | null>(null)');
    // La scelta si attiva e si disattiva: è una preferenza, non un impegno.
    expect(inline).toContain('setChosen(chosen === index ? null : index)');
  });

  it('l’opzione scelta è evidenziata (is-chosen), e il CSS lo copre', () => {
    expect(inline).toContain('is-chosen');
    expect(css).toContain('.council-option.is-chosen');
  });
});

describe('P02 — il clic prepara la bozza, non invia (P-I2)', () => {
  it('openIssue accoglie l’opzione scelta e la mette nella bozza', () => {
    expect(office).toContain('chosenOption?: { title: string; content: string }');
    expect(office).toContain('text: chosenOption.content.trim()');
  });

  it('startRoom restituisce la stanza, così la bozza può essere compilata dopo', () => {
    expect(office).toContain('): CouncilRoomState | null =>');
    expect(office).toContain('const room = startRoom(rapporteur, issue)');
  });

  it('NON invia l’ordine nel clic: nessuna chiamata a onQueueOrder dentro openIssue', () => {
    const start = office.indexOf('const openIssue =');
    const end = office.indexOf('\n  };', start);
    const body = office.slice(start, end);
    expect(body).not.toContain('onQueueOrder');
    // e non finge una firma già avvenuta
    expect(body).not.toContain('signDraft');
  });
});

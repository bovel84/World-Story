/**
 * V01 — le questioni fuori dal dossier (piano «dossier stile Victoria 3»)
 * ======================================================================
 * Le «Sfide del momento» — le pressioni di pace del motore con le loro opzioni
 * di risposta — **non vivono più nel Dossier nazionale**. Il dossier è un
 * documento di stato (cifre, toni, andamento); una sfida è una decisione da
 * prendere, e le decisioni hanno una casa propria: il pannello **Questioni**.
 *
 * Questi test difendono il contratto di V01. Come i test-contratto del dossier
 * (D01/D02), leggono il **sorgente con `fs` + regex** — l'ambiente di test è
 * `node`, senza render di componenti — e ogni test ha una **guardia contro il
 * falso verde**: un parser rotto o un file spostato devono far fallire il
 * test, non passare a vuoto.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionsPanel } from './QuestionsPanel';
import type { PeacetimePressure } from '../../services/api';

const read = (...parts: string[]): string =>
  fs.readFileSync(path.resolve(__dirname, ...parts), 'utf8');

const DOCK = read('NationDock.tsx');
const QUESTIONS = read('QuestionsPanel.tsx');
const DESK = read('../Shell/DeskContent.tsx');
const RAIL_CONTEXT = read('nationalContext.ts');
const WIDGETS = read('NationDock/widgets.tsx');

describe('V01 — le sfide escono dal dossier', () => {
  it('il dossier non contiene più la card «Sfide del momento»', () => {
    // La card era dentro il «Registro completo». Non deve esserci più: né come
    // card (`title="…"`), né come componente interattivo (`PressuresBlock`).
    // Si cerca il **titolo della card**, non la frase ovunque: la frase può
    // comparire in una nota che spiega dove sono finite le sfide.
    expect(
      DOCK,
      'il dossier non è più un documento di stato se contiene la card delle sfide',
    ).not.toMatch(/title="Sfide del momento"/);
    expect(
      DOCK,
      '`PressuresBlock` dentro il dossier significa che le sfide ci sono ancora',
    ).not.toContain('PressuresBlock');
  });

  it('la guardia vede davvero il file (non passa a vuoto)', () => {
    // Contro il falso verde: se il percorso fosse sbagliato o il file vuoto,
    // l'assenza di «Sfide del momento» sarebbe vera per il motivo sbagliato.
    expect(DOCK.length).toBeGreaterThan(20000);
    expect(DOCK, 'il dossier deve ancora contenere il suo registro').toMatch(/Registro completo/);
    expect(DOCK, 'la crisi resta nel dossier').toMatch(/<CrisisBlock/);
  });

  it('il registro del dossier non nomina più le sfide', () => {
    // V02 ha ulteriormente ridotto il registro (restano gli impegni): qui
    // l'invariante di V01 è che **le sfide non ci sono più**, non il titolo
    // esatto — che V02 è libero di cambiare.
    expect(DOCK).toMatch(/Registro completo: /);
    expect(DOCK, 'il vecchio titolo del registro non deve restare').not.toMatch(/crisi, sfide e impegni/);
    expect(DOCK, 'le sfide non sono più un blocco del registro').not.toMatch(/title="Sfide del momento"/);
  });

  it('le sfide restano una lettura nella lista unica (I4 non cambia)', () => {
    // Toglierle dal dossier non significa toglierle dal giudizio: la sintesi
    // continua a elencarle. Il read model della sintesi non è toccato da V01.
    const SYNTHESIS = read('nationalSynthesis.ts');
    expect(SYNTHESIS).toMatch(/source: 'sfida'/);
    expect(SYNTHESIS, 'la sintesi deve ancora produrre una voce per ogni sfida attiva')
      .toMatch(/for \(const pressure of pressures\)/);
  });
});

describe('V01 — il pannello Questioni è la casa nuova', () => {
  it('esiste, monta le pressioni e usa il blocco già collaudato', () => {
    expect(QUESTIONS.length).toBeGreaterThan(1000);
    expect(QUESTIONS).toMatch(/<PressuresBlock/);
    expect(QUESTIONS).toMatch(/pressures=\{pressures\}/);
    expect(QUESTIONS).toMatch(/onResolve=\{onResolvePressure\}/);
  });

  it('non inventa dati: riceve le stesse props che il dossier riceveva', () => {
    // V5 — il pannello non chiama il motore e non calcola cifre.
    expect(QUESTIONS).not.toMatch(/fetch\(|api\.|useEffect/);
    expect(QUESTIONS).toMatch(/peacetime|pressure/i);
  });

  it('il desk monta il pannello come modulo, chiudibile', () => {
    expect(DESK).toMatch(/activeModule === 'questioni'/);
    expect(DESK).toMatch(/<QuestionsPanel/);
    const block = DESK.slice(DESK.indexOf("activeModule === 'questioni'"));
    expect(block, 'il modulo Questioni deve avere il suo pulsante di chiusura')
      .toMatch(/Chiudi questioni/);
  });

  it('il dossier rimanda a Questioni per rispondere, invece di risolvere', () => {
    expect(DOCK).toMatch(/onOpenQuestions/);
    const PANEL = read('NationalSynthesisPanel.tsx');
    expect(PANEL).toMatch(/Rispondi in Questioni/);
    // Il pulsante compare **solo** per le voci-sfida: le altre restano rimandi.
    expect(PANEL).toMatch(/item\.source === 'sfida'/);
  });
});

describe('V01 — lo storico delle questioni chiuse', () => {
  it('mostra le sfide recenti anche quando non resta alcuna questione aperta', () => {
    const closed = {
      id: 'chiusa', title: 'Vertenza risolta', status: 'resolved', resolution: 'Accordo raggiunto',
    } as PeacetimePressure;
    const html = renderToStaticMarkup(createElement(QuestionsPanel, {
      pressures: [], recentPressures: [closed],
    }));
    expect(html).toContain('Nessuna sfida aperta');
    expect(html).toContain('Ultime sfide chiuse');
    expect(html).toContain('Vertenza risolta');
    expect(html).toContain('Accordo raggiunto');
  });
});

describe('V01 — il distintivo della barra comandi', () => {
  it('la barra ha la voce Questioni con il conteggio delle sfide attive', () => {
    expect(RAIL_CONTEXT).toMatch(/id: 'questioni'/);
    expect(RAIL_CONTEXT).toMatch(/label: 'Questioni'/);
    expect(RAIL_CONTEXT).toMatch(/badge: openQuestions > 0 \? openQuestions : 0/);
  });

  it('«Questioni» è un modulo canonico come ogni altro', () => {
    // V05 — l'elenco dei moduli ha ora **una sola** definizione (lo store):
    // la barra importa il tipo invece di ri-dichiararlo. Qui si verifica la
    // fonte, non la copia.
    const store = read('../../stores/moduleState.ts');
    expect(store).toMatch(/export type ActiveModule =[^;]*'questioni'/);
    const rail = read('../Shell/CommandRail.tsx');
    expect(rail).toMatch(/from '\.\.\/\.\.\/stores\/moduleState'/);
    expect(rail, 'CommandRail non deve ri-dichiarare ActiveModule').not.toMatch(/export type ActiveModule =/);
  });

  it('il conteggio è una funzione pura e conta solo le sfide attive', async () => {
    // La misura: una sfida risolta o scaduta non gonfia il numero.
    const { countOpenQuestions } = await import('./pressureWindow');
    expect(countOpenQuestions(null)).toBe(0);
    expect(countOpenQuestions([])).toBe(0);
    expect(countOpenQuestions([
      { status: 'active' },
      { status: 'resolved' },
      { status: 'expired' },
      { status: 'active' },
    ])).toBe(2);
  });
});

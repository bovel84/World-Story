/**
 * COUNTRY-CLARITY — lo stato canonico prima, gli approfondimenti dopo.
 * ====================================================================
 * Il Dossier Nazionale mostrava il nuovo schema (schede vive, attuale vs Turno 0)
 * mescolato con le UI precedenti: non si capiva cosa fosse canonico e cosa
 * approfondimento. Ora ogni sezione si apre con le schede `NationalDossierLive`
 * e relega il resto dietro un richiudibile «Approfondimenti».
 *
 * Verifica di **sorgente** (l'ordine nel markup) e di **render** (CouncilIssue
 * continua a funzionare).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CouncilIssue } from '../../services/api';
import { CouncilIssueInline } from './CouncilIssueInline';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const DOCK = read('./NationDock.tsx');
const WIDGETS = read('./NationDock/widgets.tsx');

const SECTIONS = ['situazione', 'regno', 'tesoro', 'statoMaggiore'] as const;

function section(name: (typeof SECTIONS)[number]): string {
  const start = DOCK.indexOf(`{active === '${name}' && (`);
  expect(start, `sezione ${name} non trovata`).toBeGreaterThan(-1);
  const next = DOCK.indexOf('{active === ', start + 1);
  return DOCK.slice(start, next === -1 ? DOCK.length : next);
}

describe('COUNTRY-CLARITY — stato canonico e approfondimenti', () => {
  it('ogni sezione si apre con lo stato canonico (NationalDossierLive)', () => {
    for (const name of SECTIONS) {
      const body = section(name);
      const live = body.indexOf('<NationalDossierLive');
      const approx = Math.min(
        ...[body.indexOf('<DeepDive'), body.indexOf('<details')].filter(index => index >= 0),
      );
      expect(live, `«${name}» non apre con una scheda viva`).toBeGreaterThan(-1);
      expect(live, `in «${name}» l'approfondimento precede lo stato canonico`).toBeLessThan(approx);
    }
  });

  it('il resto di ogni sezione è in un richiudibile «Approfondimenti»', () => {
    for (const name of SECTIONS) {
      const body = section(name);
      const hasContribution = body.includes('<DeepDive') || body.includes('<details');
      expect(hasContribution, `«${name}» non separa gli approfondimenti`).toBe(true);
    }
    // Il componente riusabile etichetta lo strato in modo unico.
    expect(WIDGETS).toMatch(/export function DeepDive\([\s\S]*?label = 'Approfondimenti'/);
    // In Situazione il richiudibile già esistente porta la stessa etichetta.
    expect(section('situazione')).toContain('Approfondimenti: quadro d&apos;insieme per dominio');
  });

  it('nessuna scheda viva è duplicata in due punti del dock', () => {
    for (const part of ['stato', 'finanze', 'risorse', 'capacita', 'tecnologia', 'militare']) {
      const occurrences = DOCK.match(new RegExp(`part="${part}"`, 'g')) ?? [];
      expect(occurrences.length, `la scheda «${part}» compare ${occurrences.length} volte`).toBe(1);
    }
  });

  it('le sezioni dense confinano i blocchi legacy: nessun blocco vive fuori dal dock', () => {
    // Ogni DossierBlock deve stare in una sezione (nessun blocco orfano dopo il
    // riordino): la somma per sezione è quella del piano §3.
    const total = SECTIONS.reduce((sum, name) => {
      const matches = section(name).match(/<DossierBlock[\s\S]*?<\/DossierBlock>/g) ?? [];
      return sum + matches.length;
    }, 0);
    expect(total, 'il parser non vede i 26 blocchi del dossier').toBe(26);
  });
});

describe('CouncilIssue — continua a renderizzare dopo il riordino', () => {
  it('«Porta al Consiglio» resta disponibile con la sua scheda', () => {
    const issue: CouncilIssue = {
      id: 'issue-live', title: 'Nuovo tratto ferroviario',
      question: 'Vogliamo studiare un nuovo tratto ferroviario?',
      verifiedFacts: [{ key: 'factories', label: 'Fabbriche possedute', value: '2', source: 'world_map', sourceRef: 'infrastructure.factories' }],
      suggestedMinisters: ['lavori', 'tesoro'], origin: 'advisor', sourceRefs: ['infrastructure.factories'],
      createdDate: '2000-06-01',
    };
    const html = renderToStaticMarkup(<CouncilIssueInline issue={issue} onOpenIssue={vi.fn()} />);
    expect(html).toContain('Porta al Consiglio');
    expect(html).toContain('Nuovo tratto ferroviario');
    expect(html).toContain('Fabbriche possedute');
  });
});

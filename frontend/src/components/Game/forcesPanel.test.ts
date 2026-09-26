/**
 * D-1 — la sala operativa fuori dal dossier
 * =========================================
 * `ObjectsBoard` è una sala che **agisce** — crea reparti, compra
 * equipaggiamento, impartisce ordini — e stava dentro il Dossier nazionale, che
 * da V01–V05 è un documento di stato. La decisione D-1 (opzione B) le dà un
 * pannello proprio, «Forze», nella barra comandi, per lo stesso principio che ha
 * fatto uscire le sfide in V01: il dossier si legge, le azioni si fanno in una
 * superficie dedicata.
 *
 * Il fatto misurato che rende la mossa obbligata: `raise_formation`, `procure` e
 * `trade` erano raggiungibili **solo** dal dossier. Devono restare raggiungibili
 * — da qui.
 *
 * Test-contratto: legge il sorgente con `fs` + regex, con guardie contro il
 * falso verde.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]): string =>
  fs.readFileSync(path.resolve(__dirname, ...parts), 'utf8');

const DOCK = read('NationDock.tsx');
const FORCES = read('ForcesPanel.tsx');
const DESK = read('../Shell/DeskContent.tsx');
const RAIL_CONTEXT = read('nationalContext.ts');
const STORE = read('../../stores/moduleState.ts');

describe('D-1 — il dossier non contiene più la sala operativa', () => {
  it('`ObjectsBoard` non è montato nel dossier', () => {
    expect(DOCK, 'la sala operativa è ancora nel dossier').not.toContain('<ObjectsBoard');
    expect(DOCK, 'l\'import di ObjectsBoard è un residuo')
      .not.toMatch(/import \{ ObjectsBoard \}/);
  });

  it('il dossier non ha più nessun blocco interattivo (V4 senza eccezioni)', () => {
    const details = [...DOCK.matchAll(/<details[\s\S]*?<\/details>/g)].map(m => m[0]);
    expect(details.length, 'il parser non vede i richiudibili').toBeGreaterThan(0);
    for (const block of details) {
      expect(block, 'un blocco che agisce non va in un richiudibile')
        .not.toMatch(/<ObjectsBoard|<PressuresBlock|<CrisisBlock|nation-decision-ack/);
    }
    // E fuori dai richiudibili: nel dossier non c'è nessuna sala operativa.
    expect(DOCK).not.toContain('<UnitActionPanel');
  });

  it('la guardia vede davvero il dossier (non passa a vuoto)', () => {
    expect(DOCK.length).toBeGreaterThan(20000);
    expect(DOCK, 'il dossier deve ancora avere le sue quattro sezioni')
      .toMatch(/active === 'statoMaggiore'/);
  });
});

describe('D-1 — il pannello Forze è la casa nuova', () => {
  it('esiste, monta ObjectsBoard con le stesse props', () => {
    expect(FORCES.length).toBeGreaterThan(1000);
    expect(FORCES).toMatch(/<ObjectsBoard/);
    expect(FORCES).toMatch(/arsenal=\{arsenal\}/);
    expect(FORCES).toMatch(/onRaiseFormation=\{onRaiseFormation\}/);
  });

  it('non inventa dati: nessuna chiamata al motore, nessuna cifra nuova', () => {
    expect(FORCES).not.toMatch(/fetch\(|useEffect|api\./);
  });

  it('il desk monta il pannello come modulo, chiudibile', () => {
    expect(DESK).toMatch(/activeModule === 'forze'/);
    expect(DESK).toMatch(/<ForcesPanel/);
    const block = DESK.slice(DESK.indexOf("activeModule === 'forze'"));
    expect(block, 'il modulo Forze deve avere il suo pulsante di chiusura')
      .toMatch(/Chiudi forze/);
  });

  it('le tre azioni uniche restano raggiungibili: il pannello riceve onRaiseFormation', () => {
    // Misura D-1: raise_formation/procure/trade erano SOLO nel dossier.
    // Ora sono qui — la mossa non le perde.
    expect(FORCES).toMatch(/onRaiseFormation/);
    expect(FORCES).toMatch(/onPreviewFormation/);
    const deskForces = DESK.slice(DESK.indexOf("activeModule === 'forze'"), DESK.indexOf('Modulo Nazione'));
    expect(deskForces).toMatch(/onRaiseFormation=\{onRaiseFormation\}/);
    expect(deskForces).toMatch(/onPreviewFormation=\{onPreviewFormation\}/);
  });
});

describe('D-1 — la barra comandi ha la voce Forze', () => {
  it('la voce esiste con il distintivo dei reparti con problemi', () => {
    expect(RAIL_CONTEXT).toMatch(/id: 'forze'/);
    expect(RAIL_CONTEXT).toMatch(/label: 'Forze'/);
    expect(RAIL_CONTEXT).toMatch(/badge: troubledUnits > 0 \? troubledUnits : 0/);
  });

  it('«Forze» è un modulo canonico come gli altri', () => {
    expect(STORE).toMatch(/export type ActiveModule =[^;]*'forze'/);
  });

  it('il conteggio è puro e conta solo i reparti, non gli impianti', async () => {
    const { countTroubledUnits } = await import('./operationalObjects');
    expect(countTroubledUnits(null)).toBe(0);
    expect(countTroubledUnits({ objects: [], chains: [], counts: {}, conventions: [] })).toBe(0);
    const picture = {
      chains: [], counts: {}, conventions: [],
      objects: [
        { kind: 'unit', problems: [{ severity: 'warning', label: 'x' }] },
        { kind: 'unit', problems: [] },
        // Un impianto degradato NON è un reparto: non deve gonfiare il numero.
        { kind: 'facility', problems: [{ severity: 'critical', label: 'y' }] },
        { kind: 'unit', problems: [{ severity: 'critical', label: 'z' }] },
      ],
    } as any;
    expect(countTroubledUnits(picture)).toBe(2);
  });
});

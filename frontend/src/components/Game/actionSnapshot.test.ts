/**
 * MAP P4.1 — una sola nozione di snapshot per il pannello azioni condiviso.
 * La chiave è composta da fatti canonici del motore: se due percorsi (mappa e
 * dossier nazionale) calcolassero chiavi diverse, una preview stale resterebbe
 * confermabile in uno dei due. Qui si fissano la forma e la sensibilità a
 * ciascuno dei cinque campi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionSnapshotKey } from './actionSnapshot';

const read = (...parts: string[]) => fs.readFileSync(path.resolve(__dirname, ...parts), 'utf8');

const game = {
  id: 'g1', currentTurn: 4, currentDate: '1951-02-01', worldRevision: 5, headBranchId: 'branch-live',
};

/** Il blocco JSX del pannello condiviso, per verificare cosa riceve davvero. */
const panelMount = (source: string) => {
  const start = source.indexOf('<UnitActionPanel');
  return source.slice(start, source.indexOf('/>', start));
};

describe('MAP P4.1 — chiave canonica dello snapshot', () => {
  it('compone partita, turno, data, revisione e ramo nello stesso ordine', () => {
    expect(actionSnapshotKey(game)).toBe('g1:4:1951-02-01:5:branch-live');
  });

  it('è stabile: lo stesso snapshot produce sempre la stessa chiave', () => {
    expect(actionSnapshotKey({ ...game })).toBe(actionSnapshotKey(game));
  });

  it('cambia se cambia uno qualsiasi dei cinque campi canonici', () => {
    const base = actionSnapshotKey(game);
    expect(actionSnapshotKey({ ...game, id: 'g2' })).not.toBe(base);
    expect(actionSnapshotKey({ ...game, currentTurn: 5 })).not.toBe(base);
    expect(actionSnapshotKey({ ...game, currentDate: '1951-02-02' })).not.toBe(base);
    expect(actionSnapshotKey({ ...game, worldRevision: 6 })).not.toBe(base);
    expect(actionSnapshotKey({ ...game, headBranchId: 'branch-restored' })).not.toBe(base);
  });

  it('rewind/restore con turno e ramo precedenti non coincide con lo stato attuale', () => {
    const restored = { ...game, currentTurn: 2, currentDate: '1951-01-15', worldRevision: 2, headBranchId: 'branch-restored' };
    expect(actionSnapshotKey(restored)).not.toBe(actionSnapshotKey(game));
  });

  it('senza partita non inventa valori: chiave vuota e canonica', () => {
    expect(actionSnapshotKey(null)).toBe(':0::0:');
    expect(actionSnapshotKey({ id: 'g1' })).toBe('g1:0::0:');
  });
});

describe('MAP P4.1 — propagazione della stessa chiave ai due percorsi', () => {
  it('GameScreen calcola la chiave con l’helper condiviso e la passa a entrambi', () => {
    const screen = read('GameScreen.tsx');
    expect(screen).toContain("import { actionSnapshotKey } from './actionSnapshot'");
    expect(screen).toContain('const snapshotKey = actionSnapshotKey(currentGame)');
    // Nessuna seconda formula locale nel componente.
    expect(screen).not.toContain("worldRevision || 0");
    const provinceMount = screen.slice(screen.indexOf('<ProvinceInspector'), screen.indexOf('/>', screen.indexOf('<ProvinceInspector')));
    expect(provinceMount).toContain('snapshotKey={snapshotKey}');
  });

  it('DeskContent dichiara e inoltra snapshotKey a NationDock', () => {
    const desk = read('..', 'Shell', 'DeskContent.tsx');
    expect(desk).toMatch(/snapshotKey\?: string;/);
    const dockMount = desk.slice(desk.indexOf('<NationDock'), desk.indexOf('/>', desk.indexOf('<NationDock')));
    expect(dockMount).toContain('snapshotKey={snapshotKey}');
  });

  it('NationDock dichiara il contratto e lo inoltra a ObjectsBoard', () => {
    expect(read('NationDock', 'types.ts')).toMatch(/snapshotKey\?: string;/);
    const dock = read('NationDock.tsx');
    const boardMount = dock.slice(dock.indexOf('<ObjectsBoard'), dock.indexOf('/>', dock.indexOf('<ObjectsBoard')));
    expect(boardMount).toContain('snapshotKey={props.snapshotKey}');
  });

  it('ObjectsBoard dichiara il contratto e lo passa al pannello condiviso', () => {
    const board = read('ObjectsBoard.tsx');
    // Un contratto pubblico (props del board) e uno interno (scheda dell'oggetto).
    expect(board.match(/snapshotKey\?: string;/g)).toHaveLength(2);
    expect(board).toContain('snapshotKey={snapshotKey}\n        onPreview={preview}');
    expect(panelMount(board)).toContain('snapshotKey={snapshotKey}');
  });
});

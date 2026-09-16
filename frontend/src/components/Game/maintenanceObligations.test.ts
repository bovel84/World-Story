/**
 * M07 passo 2 — obblighi di manutenzione esposti nel dossier (source-contract).
 * Verifica il wiring backend→frontend della proiezione read-only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');

describe('M07 passo 2 — manutenzione impianti nel dossier', () => {
  it('il client tipizza e legge gli obblighi di manutenzione', () => {
    expect(read('services/api.ts')).toContain('maintenanceRequired');
  });

  it('lo snapshot nazionale porta gli obblighi al dossier', () => {
    const snapshot = read('hooks/useNationSnapshot.ts');
    expect(snapshot).toContain('setMaintenanceObligations');
    expect(snapshot).toContain('maintenanceObligations');
  });

  it('il dossier li mostra (nessuna decisione silenziosa)', () => {
    const dock = read('components/Game/NationDock.tsx');
    expect(dock).toContain('maintenanceObligations');
    expect(dock).toContain('Manutenzione non coperta');
  });
});

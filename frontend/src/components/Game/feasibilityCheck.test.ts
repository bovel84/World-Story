import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const feasibilitySource = fs.readFileSync(path.resolve(__dirname, 'FeasibilityCheck.tsx'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'App.tsx'), 'utf8');
const apiSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'services', 'api.ts'), 'utf8');

describe('G4-B — verifica fattibilità prima della registrazione', () => {
  it('il client espone la chiamata all’endpoint di verifica', () => {
    expect(apiSource).toContain('checkFeasibility');
    expect(apiSource).toContain('/actions/check-feasibility');
  });

  it('«Registra ordine» apre la verifica e non accoda direttamente', () => {
    // registerOrder instrada verso verifyOrder: la coda è toccata solo
    // da handleFeasibilityRegister, cioè dopo un esito fattibile.
    expect(appSource).toContain('await verifyOrder(trimmed)');
    expect(appSource).not.toContain('if (await queuePlayerAction(trimmed)) {\n      clearOrderDraft();');
  });

  it('il dialog mostra costi, prerequisiti, rischi e avvisi', () => {
    expect(feasibilitySource).toContain('Costi stimati');
    expect(feasibilitySource).toContain('Prerequisiti');
    expect(feasibilitySource).toContain('Rischi');
    expect(feasibilitySource).toContain('Avvisi');
  });

  it('consente la registrazione solo di un ordine fattibile', () => {
    expect(feasibilitySource).toContain('disabled={loading || !result.feasible}');
  });

  it('l’errore tecnico non chiude il dialog e propone un riprova', () => {
    expect(feasibilitySource).toContain('Impossibile verificare');
    expect(feasibilitySource).toContain('onReverify');
  });

  it('il dialog è montato in App con lo stato di verifica dedicato', () => {
    expect(appSource).toContain('<FeasibilityCheck');
    expect(appSource).toContain('setShowFeasibility(true)');
    expect(appSource).toContain('setFeasibilityLoading(true)');
  });
});
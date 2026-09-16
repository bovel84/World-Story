import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const feasibilitySource = fs.readFileSync(path.resolve(__dirname, 'FeasibilityCheck.tsx'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'App.tsx'), 'utf8');
// Fase 2: la logica della coda ordini e della verifica vive in `useOrderQueue`.
const orderQueueSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'hooks', 'useOrderQueue.ts'), 'utf8');
// Fase 2: i dialoghi sovrapposti vivono in `GameModals`.
const gameModalsSource = fs.readFileSync(path.resolve(__dirname, 'GameModals.tsx'), 'utf8');
const apiSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'services', 'api.ts'), 'utf8');

describe('G4-B — verifica fattibilità prima della registrazione', () => {
  it('il client espone la chiamata all’endpoint di verifica', () => {
    expect(apiSource).toContain('checkFeasibility');
    expect(apiSource).toContain('/actions/check-feasibility');
  });

  it('«Registra ordine» apre la verifica e non accoda direttamente', () => {
    // registerOrder instrada verso verifyOrder: la coda è toccata solo
    // da handleFeasibilityRegister, cioè dopo un esito fattibile.
    expect(orderQueueSource).toContain('await verifyOrder(trimmed)');
    expect(orderQueueSource).not.toContain('if (await queuePlayerAction(trimmed)) {');
  });

  it('il dialog mostra costi da catalogo, prerequisiti, rischi e avvisi', () => {
    // G4-D: i costi sono consumi materiali e durata autorevoli dal catalogo,
    // non cifre fittizie di denaro/manodopera.
    expect(feasibilitySource).toContain('Costi stimati dal catalogo');
    expect(feasibilitySource).toContain('result.costs.inputs.map');
    expect(feasibilitySource).toContain('result.costs.upkeep.map');
    expect(feasibilitySource).not.toContain('Manodopera');
    expect(feasibilitySource).toContain('Prerequisiti');
    expect(feasibilitySource).toContain('Rischi');
    expect(feasibilitySource).toContain('Avvisi');
  });

  it('un ordine senza consumi dichiarati non inventa cifre', () => {
    expect(feasibilitySource).toContain("result.costs.basis === 'none'");
    expect(feasibilitySource).toContain('Nessun consumo materiale dichiarato');
  });

  it('consente la registrazione solo di un ordine fattibile', () => {
    expect(feasibilitySource).toContain('disabled={loading || !result.feasible}');
  });

  it('l’errore tecnico non chiude il dialog e propone un riprova', () => {
    expect(feasibilitySource).toContain('Impossibile verificare');
    expect(feasibilitySource).toContain('onReverify');
  });

  it('il dialog è montato in App con lo stato di verifica dedicato', () => {
    expect(gameModalsSource).toContain('<FeasibilityCheck');
    expect(orderQueueSource).toContain('setShowFeasibility(true)');
    expect(orderQueueSource).toContain('setFeasibilityLoading(true)');
  });

  it('espone alternative da confermare e distingue i dati mancanti (U02 µ2)', () => {
    expect(feasibilitySource).toContain('explainFeasibility');
    expect(feasibilitySource).toContain('Alternative possibili');
    expect(feasibilitySource).toContain('feasibility-alternatives');
    expect(feasibilitySource).toContain('Servono dati');
  });

  it('mostra la catena dati/deficit/fonti (U02 passo 2)', () => {
    expect(feasibilitySource).toContain('buildFeasibilityChain');
    expect(feasibilitySource).toContain('<FeasibilityChain');
  });
});
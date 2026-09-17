/**
 * Presentazione della crisi: etichette, toni e frasi derivate dai punteggi del
 * motore. Il Dossier non ricalcola nulla, quindi qui si testa la traduzione.
 */
import { describe, expect, it } from 'vitest';
import { CRISIS_DIMENSION_LABEL, CRISIS_LEVEL_LABEL, crisisDaysText, crisisLevelTone, criticalCount } from './crisisPanel';
import type { CrisisRisk } from '../../services/api';

const risk = (level: CrisisRisk['level']): CrisisRisk => ({
  dimension: 'revolt',
  level,
  score: level === 'critical' ? 82 : level === 'watch' ? 55 : 12,
  title: 'Rischio di rivolta',
  detail: 'Consenso consumato.',
  drivers: ['stabilità 30/100'],
});

describe('presentazione della crisi', () => {
  it('ha un’etichetta per ogni gradino della scala', () => {
    expect(CRISIS_LEVEL_LABEL.calm).toBeTruthy();
    expect(CRISIS_LEVEL_LABEL.watch).toBeTruthy();
    expect(CRISIS_LEVEL_LABEL.critical).toBeTruthy();
  });

  it('ha un’etichetta per ogni strada del collasso', () => {
    expect(CRISIS_DIMENSION_LABEL.revolt).toBe('Rivolta interna');
    expect(CRISIS_DIMENSION_LABEL.insolvency).toBe('Default sul debito');
    expect(CRISIS_DIMENSION_LABEL.invasion).toBe('Invasione straniera');
  });

  it('traduce il livello in tono semantico', () => {
    expect(crisisLevelTone('calm')).toBe('positive');
    expect(crisisLevelTone('watch')).toBe('warning');
    expect(crisisLevelTone('critical')).toBe('negative');
  });

  it('la frase sui giorni di criticità dipende dal livello', () => {
    expect(crisisDaysText(risk('critical'), 30, 90)).toContain('30/90 giorni');
    expect(crisisDaysText(risk('critical'), 95, 90)).toContain('a un passo dal collasso');
    expect(crisisDaysText(risk('critical'), 0, 90)).toContain('90 giorni di criticità');
    expect(crisisDaysText(risk('watch'), 12, 90)).toContain('Allarme da 12 giorni');
    expect(crisisDaysText(risk('watch'), 0, 90)).toContain('Allarme');
    // In recupero l'arretrato che si consuma è un'informazione utile.
    expect(crisisDaysText(risk('calm'), 8, 90)).toContain('Recupero');
    expect(crisisDaysText(risk('calm'), 0, 90)).toBe('');
  });

  it('conta le dimensioni critiche per l’HUD', () => {
    expect(criticalCount([risk('calm'), risk('watch'), risk('critical')])).toBe(1);
    expect(criticalCount([risk('critical'), risk('critical'), risk('critical')])).toBe(3);
  });
});

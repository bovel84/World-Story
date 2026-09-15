/**
 * Presentazione della crisi: etichette, toni e frasi derivate dai punteggi del
 * motore. Il Dossier non ricalcola nulla, quindi qui si testa la traduzione.
 */
import { describe, expect, it } from 'vitest';
import { CRISIS_DIMENSION_LABEL, CRISIS_LEVEL_LABEL, crisisLevelTone, crisisStreakText, criticalCount } from './crisisPanel';
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

  it('la frase sulla serie dipende dal livello', () => {
    expect(crisisStreakText(risk('critical'), 2, 3)).toContain('2/3 turni');
    expect(crisisStreakText(risk('critical'), 0, 3)).toContain('a un passo');
    expect(crisisStreakText(risk('watch'), 0, 3)).toContain('Allarme');
    expect(crisisStreakText(risk('calm'), 0, 3)).toBe('');
  });

  it('conta le dimensioni critiche per l’HUD', () => {
    expect(criticalCount([risk('calm'), risk('watch'), risk('critical')])).toBe(1);
    expect(criticalCount([risk('critical'), risk('critical'), risk('critical')])).toBe(3);
  });
});

/**
 * GAMEPLAY-LONG P0.1 — Coerenza temporale dei preset
 * =================================================
 * La data canonica di uno scenario è quella in `start_date`: il mondo parte da
 * lì e il tempo scorre solo secondo le decisioni del giocatore. Le cifre di
 * partenza (popolazione, PIL, debito) possono venire da dataset di riferimento
 * (2024), ma sono **baseline tecniche**, non «l'anno in cui si vive».
 *
 * Questo test blocca la regressione trovata su `modern_world_provinces`, che
 * partiva dal 2026 ma si presentava al modello come «il mondo del 2024».
 */
import { describe, it, expect } from 'vitest';
import { listPresets, loadPreset } from '../src/utils/preset-loader';
import { hasModernReferenceFacts } from '../src/utils/country-facts';

/** Tutte le descrizioni testuali che il modello riceve dal preset. */
function worldText(preset: NonNullable<ReturnType<typeof loadPreset>>): string {
  return [preset.lore, preset.base_prompt, preset.simulation_rules, preset.description]
    .filter(Boolean)
    .join('\n');
}

describe('GAMEPLAY-LONG — coerenza temporale dei preset', () => {
  it('la data canonica è start_date e non l’anno dei dati di riferimento', () => {
    const preset = loadPreset('modern_world_provinces');
    expect(preset).toBeTruthy();
    expect(preset!.start_date).toBe('2026-01-01');
    // L'era «moderna» (e quindi l'uso dei fatti di riferimento) è derivata
    // dalla data dello scenario, mai da un anno scritto nel motore.
    expect(hasModernReferenceFacts(preset!.start_date)).toBe(true);
    expect(hasModernReferenceFacts('1815-06-09')).toBe(false);
  });

  it('il preset moderno non si presenta più come «il mondo del 2024»', () => {
    const preset = loadPreset('modern_world_provinces')!;
    const text = worldText(preset);
    expect(text).not.toMatch(/mondo\s+(del\s+)?2024/i);
    expect(text).not.toMatch(/contemporaneo\s+del\s+2024/i);
    expect(text).not.toMatch(/nell'?anno\s+2024/i);
  });

  it('il preset moderno dichiara il 2024 come baseline di riferimento, non come data corrente', () => {
    const preset = loadPreset('modern_world_provinces')!;
    const text = worldText(preset);
    expect(text).toMatch(/2024/);
    expect(text.toLowerCase()).toMatch(/riferimento|baseline/);
    expect(text.toLowerCase()).toMatch(/data corrente|calendario di gioco|data canonica|data d'inizio/);
  });

  it('le regole del preset moderno impongono la coerenza temporale al modello', () => {
    const preset = loadPreset('modern_world_provinces')!;
    const rules = preset.simulation_rules || '';
    expect(rules).toContain('data canonica');
    expect(rules.toLowerCase()).toContain('baseline');
  });

  it('nessun preset dichiara un «anno corrente» diverso dalla propria data d’inizio', () => {
    for (const summary of listPresets()) {
      const preset = loadPreset(summary.id);
      if (!preset) continue;
      const startYear = preset.start_date.slice(0, 4);
      const text = [preset.lore, preset.base_prompt].filter(Boolean).join('\n');
      // Frasi che presentano esplicitamente il mondo in un anno preciso.
      const claims = [...text.matchAll(/(?:il\s+mondo|anno\s+corrente|siamo\s+nel|world\s+of|the\s+year)\D{0,12}(\d{4})/gi)];
      for (const claim of claims) {
        expect(claim[1], `${preset.id}: «${claim[0]}» non coincide con start_date ${preset.start_date}`)
          .toBe(startYear);
      }
    }
  });
});

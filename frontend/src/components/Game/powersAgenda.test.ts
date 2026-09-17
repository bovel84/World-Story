/**
 * Strategie delle potenze: il client traduce gli obiettivi del motore in
 * etichette e toni. Nessun dato stimato: se il motore non pubblica progresso o
 * data, la riga semplicemente non li mostra.
 */
import { describe, expect, it } from 'vitest';
import {
  agendaBriefingDetail, agendaBriefingLine, agendasWithObjectives, mostUrgentAgenda, formatAgendaDate, objectivePriorityLabel,
  objectivePriorityTone, objectiveProgressTone, objectiveSummary, rankPowerAgendas,
} from './powersAgenda';
import type { PowerAgenda, StrategicObjective } from '../../services/api';

const objective = (over: Partial<StrategicObjective> = {}): StrategicObjective => ({
  id: 'FRA:stabilize-economy:-:1',
  description: 'Rimettere in ordine i conti.',
  type: 'stabilize-economy',
  priority: 3,
  progress: 40,
  since: '1815-03-12',
  reviewDate: '1815-07-10',
  reason: 'saldo -2 mld',
  ...over,
});

const power = (name: string, objectives: StrategicObjective[]): PowerAgenda => ({
  polityId: name.slice(0, 3).toUpperCase(), name, objectives,
});

describe('GAMEPLAY-LONG — strategie delle potenze', () => {
  it('traduce priorità e progresso in etichette e toni', () => {
    expect(objectivePriorityLabel(3)).toBe('decisivo');
    expect(objectivePriorityLabel(2)).toBe('rilevante');
    expect(objectivePriorityLabel(1)).toBe('di contorno');
    expect(objectivePriorityTone(3)).toBe('critical');
    expect(objectivePriorityTone(1)).toBe('neutral');
    expect(objectiveProgressTone(90)).toBe('positive');
    expect(objectiveProgressTone(50)).toBe('neutral');
    expect(objectiveProgressTone(20)).toBe('warning');
    expect(objectiveProgressTone(5)).toBe('critical');
  });

  it('compone la riga dell’obiettivo con i dati del motore', () => {
    expect(objectiveSummary(objective())).toBe('decisivo · progresso 40% · dal 12 mar 1815');
    expect(objectiveSummary(objective({ since: '' }))).toBe('decisivo · progresso 40%');
  });

  it('formatta le date italiane e non inventa nulla se non è leggibile', () => {
    expect(formatAgendaDate('1815-09-08')).toBe('8 set 1815');
    expect(formatAgendaDate('non-una-data')).toBe('non-una-data');
    expect(formatAgendaDate('')).toBe('');
  });

  it('ordina le potenze per quanto la loro agenda pesa, senza casualità', () => {
    const ranked = rankPowerAgendas({
      powers: [
        power('Austria', [objective({ priority: 1 })]),
        power('Francia', [objective({ priority: 3 })]),
        power('Prussia', [objective({ priority: 2 })]),
      ],
    });
    expect(ranked.map(item => item.name)).toEqual(['Francia', 'Prussia', 'Austria']);
    // A parità di peso conta l'ordine alfabetico: nessun riordino arbitrario.
    const tied = rankPowerAgendas({ powers: [power('Zeta', [objective()]), power('Alfa', [objective()])] });
    expect(tied.map(item => item.name)).toEqual(['Alfa', 'Zeta']);
  });

  it('tiene solo le potenze con qualcosa in corso', () => {
    const list = agendasWithObjectives({
      powers: [power('Francia', [objective()]), power('Spagna', []), power('Austria', [objective({ priority: 1 })])],
    });
    expect(list.map(item => item.name)).toEqual(['Francia', 'Austria']);
    expect(agendasWithObjectives(null)).toEqual([]);
    expect(agendasWithObjectives({})).toEqual([]);
  });

  it('il briefing prende una sola potenza, e solo se ha una strategia decisiva', () => {
    const powers = [
      power('Austria', [objective({ priority: 2 })]),
      power('Francia', [objective({ priority: 3, description: 'Contenere l’ostilità di Austria.' })]),
    ];
    const urgent = mostUrgentAgenda({ powers }, 'ITA');
    expect(urgent?.name).toBe('Francia');
    expect(agendaBriefingDetail(urgent!)).toContain('Contenere l’ostilità di Austria.');
    expect(agendaBriefingDetail(urgent!)).toContain('motivo:');
    // Nessuna strategia decisiva: il briefing non aggiunge rumore.
    expect(mostUrgentAgenda({ powers: [power('Austria', [objective({ priority: 2 })])] })).toBeNull();
    expect(mostUrgentAgenda(null)).toBeNull();
  });

  it('la riga del briefing prende l’obiettivo più decisivo', () => {
    const line = agendaBriefingLine(power('Francia', [
      objective({ priority: 1, description: 'Ottenere accesso commerciale.' }),
      objective({ priority: 3, description: 'Contenere l’ostilità di Austria.' }),
    ]));
    expect(line).toContain('Francia:');
    expect(line).toContain('Contenere l’ostilità di Austria.');
    expect(line).toContain('(decisivo)');
  });
});

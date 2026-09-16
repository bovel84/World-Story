/**
 * LW01 — Briefing strategico: il read model è puro e deterministico.
 * Nessun LLM, nessun motore: solo la traduzione di dati già pubblicati.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deriveStrategicBriefing } from './strategicBriefing';
import type { CrisisSnapshot, GovernmentSnapshot, PeacetimePressure } from '../../services/api';

function pressure(over: Partial<PeacetimePressure>): PeacetimePressure {
  return {
    id: 'p1', kind: 'internal', template: 't', title: 'Sciopero nei porti',
    detail: 'd', severity: 3, source: 'Sindacati', options: [], status: 'active',
    createdDate: '1951-01-01', createdTurn: 1, resolvedOption: null, resolution: null,
    ...over,
  };
}

function crisis(level: 'calm' | 'watch' | 'critical'): CrisisSnapshot {
  return {
    state: {
      level,
      risks: [{ dimension: 'revolt', level, score: level === 'critical' ? 82 : level === 'watch' ? 55 : 12, title: 'Rischio di rivolta', detail: 'Consenso consumato.', drivers: [] }],
      headline: '', summary: '', streaks: { revolt: 0, insolvency: 0, invasion: 0 }, ending: null,
    },
    ending: null, finished: false, collapseStreak: 0,
  };
}

function government(over: Partial<GovernmentSnapshot> = {}): GovernmentSnapshot {
  return {
    factions: [],
    dominantId: null,
    angriestId: null,
    cohesion: 60,
    pressureIndex: 30,
    headline: 'Il consiglio è diviso.',
    budget: { currency: 'mld', revenue: [], expense: [], revenueTotal: 0, expenseTotal: 0, balance: 0, effectiveTaxRatePct: 10, defenceBurdenPct: 0, socialBurdenPct: 0, educationBurdenPct: 0 },
    ...over,
  };
}

describe('LW01 — deriveStrategicBriefing', () => {
  it('senza dati resta stabile e non inventa voci', () => {
    const b = deriveStrategicBriefing({});
    expect(b.level).toBe('stable');
    expect(b.statusLabel).toBe('SOTTO CONTROLLO');
    expect(b.items).toHaveLength(0);
  });

  it('una crisi critica alza il livello e finisce in testa', () => {
    const b = deriveStrategicBriefing({ crisis: crisis('critical'), account: { stability: 20, socialTension: 88 } });
    expect(b.level).toBe('critical');
    expect(b.statusLabel).toBe('RICHIEDE ATTENZIONE');
    expect(b.items[0].id).toBe('crisis-revolt');
    expect(b.items[0].icon).toBe('🔴');
  });

  it('segnala tensione, deficit e tesoreria in scoperto', () => {
    const b = deriveStrategicBriefing({ account: { money: -0.2, monthlyBalance: -3, socialTension: 70, stability: 30, debtRatioPct: 62 } });
    const ids = b.items.map(i => i.id);
    expect(ids).toContain('treasury-negative');
    expect(ids).toContain('balance-deficit');
    expect(ids).toContain('tension-high');
    expect(ids).toContain('stability-low');
    expect(ids).toContain('debt-high');
  });

  it('ordina le voci per gravità', () => {
    const b = deriveStrategicBriefing({
      account: { money: -1 },
      ongoingProcesses: [{ id: 'x', title: 'Acciaieria', progress: 90 }],
    });
    expect(b.items[0].severity).toBe('critical');
    expect(b.items[b.items.length - 1].severity).toBe('opportunity');
  });

  it('segnala solo i fabbisogni che il motore ha pubblicato', () => {
    const withNeeds = deriveStrategicBriefing({ resources: { food: 1, fuel: 5, needs: { food: 4, fuel: 5 } } as never });
    expect(withNeeds.items.map(i => i.id)).toEqual(['shortage-food']);
    const withoutNeeds = deriveStrategicBriefing({ resources: { food: 1 } as never });
    expect(withoutNeeds.items).toHaveLength(0);
  });

  it('include sfide, mandati e manutenzione', () => {
    const b = deriveStrategicBriefing({
      pressures: [pressure({})],
      mandateDecisions: [{ mandateId: 'm', kind: 'k', resourceId: 'acciaio', minStock: '10', availableStock: '4', shortfall: '6' }],
      maintenanceObligations: [{ facilityId: 'f', typeName: 'Altoforno', sufficient: false, resourceId: 'carbone', shortfall: '3' }],
    });
    const ids = b.items.map(i => i.id);
    expect(ids).toContain('pressure-p1');
    expect(ids).toContain('mandate-m-k');
    expect(ids).toContain('maintenance-f');
  });

  it('fa emergere la pressione del consiglio e l’alleato più scontento', () => {
    const b = deriveStrategicBriefing({
      government: government({
        pressureIndex: 78,
        dominantId: 'industriali',
        angriestId: 'militari',
        factions: [
          { id: 'industriali', name: 'Industriali', interest: 'industria', powerPct: 40, satisfaction: 60, stance: 'favorevole', pressure: 30, demand: { lever: 'infrastrutture', title: 'Più acciaio', detail: 'Servono acciaierie.', direction: 'alza', urgency: 2 }, footprint: '' },
          { id: 'militari', name: 'Militari', interest: 'difesa', powerPct: 30, satisfaction: 20, stance: 'ostile', pressure: 80, demand: { lever: 'difesa', title: 'Più fondi', detail: 'Servono cannoni.', direction: 'alza', urgency: 3 }, footprint: '' },
        ],
      }),
    });
    const ids = b.items.map(i => i.id);
    expect(ids).toContain('gov-pressure');
    expect(ids).toContain('gov-militari');
    expect(ids).toContain('gov-agenda');
  });

  it('integra fatti del mondo e quadro diplomatico', () => {
    const b = deriveStrategicBriefing({
      worldFacts: [{ id: 'w-turchia', severity: 'warning', label: 'La Turchia riarma lo stretto', detail: '3 divisioni' }],
      diplomacy: { allies: ['FRA'], hostiles: ['SUN', 'TUR'] },
    });
    const ids = b.items.map(i => i.id);
    expect(ids).toContain('w-turchia');
    expect(ids).toContain('diplo-hostile');
    expect(ids).toContain('diplo-ally');
  });

  it('il Dossier mostra la card del briefing nella Situazione', () => {
    const dock = fs.readFileSync(path.resolve(__dirname, 'NationDock.tsx'), 'utf8');
    expect(dock).toContain('deriveStrategicBriefing');
    expect(dock).toContain('<StrategicBriefingCard');
  });
});

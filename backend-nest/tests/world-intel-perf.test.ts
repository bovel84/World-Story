/**
 * WorldIntelService — identità di output del refactor prestazionale
 * ===============================================================
 * Il contesto di turno su mondi provinciali costava O(politie × regioni) per
 * ogni testo (indice proprietario→regioni e alias ricostruiti dentro il ciclo),
 * pagato più volte per turno. Il refactor costruisce l'indice una volta sola.
 *
 * Questi test NON misurano il tempo: verificano che il risultato sia identico
 * a quello della implementazione precedente, ricopiata qui sotto verbatim.
 */
import { describe, expect, it } from 'vitest';
import { WorldIntelService, type WorldIntelContext } from '../src/game/WorldIntelService';
import { normalizeName } from '../src/utils/name-resolver';
import { polityDisplayNameIt } from '../src/utils/country-facts';
import { countryRepository } from '../src/repositories/country.repository';
import { WorldStateEngine } from '../src/core/simulation/WorldStateEngine';
import { arsenalCombatFactor } from '../src/core/simulation/MilitaryIndustry';
import type { RegionState, TurnResultRecord } from '../src/game-session';

// ---------------------------------------------------------------------------
// Implementazione PRE-refactor, copiata verbatim da git HEAD.
// ---------------------------------------------------------------------------
function referenceMentionedNpcPolityIds(ctx: WorldIntelContext, texts: string[]): string[] {
  const owners = [...new Set(Array.from(ctx.regions().values()).map(region => region.owner))]
    .filter(owner => owner && owner !== 'neutral' && owner !== ctx.playerPolityId());
  const found: string[] = [];
  for (const text of texts) {
    const normalizedText = ` ${normalizeName(text)} `;
    for (const owner of owners) {
      if (found.includes(owner)) continue;
      const registeredName = countryRepository.findByCode(owner)?.name;
      const aliases = [
        registeredName,
        polityDisplayNameIt(owner, registeredName),
        ...Array.from(ctx.regions().values()).filter(region => region.owner === owner).map(region => region.name),
      ]
        .filter((name): name is string => !!name)
        .map(normalizeName)
        .filter(alias => alias.length >= 3);
      const words = normalizedText.trim().split(/\s+/);
      const named = aliases.some(alias =>
        normalizedText.includes(` ${alias} `)
        || (!alias.includes(' ') && alias.length >= 5 && words.some(word => word.startsWith(alias)))
        || (!alias.includes(' ') && alias.length >= 6
          && words.some(word => word.length >= 6 && word.startsWith(alias.slice(0, 6))))
      );
      const escapedOwner = owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const coded = new RegExp(`(^|[^A-Z])${escapedOwner}([^A-Z]|$)`).test(text);
      if (named || coded) found.push(owner);
    }
  }
  return found;
}

function referenceNationalMilitaryPower(ctx: WorldIntelContext, polityId: string): number {
  return Array.from(ctx.regions().values())
    .filter(region => region.owner === polityId)
    .reduce((total, region) => total + (Number(region.militaryPower) || 0), 0);
}

function referenceNationalEffectiveMilitaryPower(
  ctx: WorldIntelContext,
  polityId: string,
  accounts?: Record<string, unknown>,
): number {
  const base = referenceNationalMilitaryPower(ctx, polityId);
  const arsenal = ctx.arsenalUnits(polityId);
  const book = (accounts || WorldStateEngine.accounts(ctx.regions().values(), ctx.worldStateOptions())) as
    Record<string, { forces?: number; mobilized?: number }>;
  const forces = Number(book[polityId]?.forces || 0) + Number(book[polityId]?.mobilized || 0);
  return Math.round(base * arsenalCombatFactor(arsenal, forces) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Mondo sintetico: 40 politie × 30 province, codici noti e ignoti al registro.
// ---------------------------------------------------------------------------
const CODES = ['DEU', 'FRA', 'RUS', 'AUT', 'GBR', 'BEL', 'SRB', 'TUR', 'ZZZ', 'QQQ'];
const PROVINCES = ['Kärnten', 'Böhmen', 'Galizien', 'Transsylvanie', 'Posnanie', 'Dalmazia', 'Slesia'];

function buildWorld(): { regions: Map<string, RegionState>; relationships: Map<string, string> } {
  const regions = new Map<string, RegionState>();
  const relationships = new Map<string, string>();
  CODES.forEach((code, ci) => {
    for (let i = 0; i < 30; i++) {
      const name = i < PROVINCES.length ? PROVINCES[i] : `${code} provincia ${i}`;
      regions.set(`${code}_${i}`, {
        id: `${code}_${i}`,
        name,
        color: '#123456',
        owner: code,
        population: 1_000_000 + i,
        gdp: 100 + i,
        militaryPower: 10 + i,
        flag: '',
        borders: [`${CODES[(ci + 1) % CODES.length]}_${i}`],
      } as RegionState);
    }
    relationships.set(`${code}|PLAY`, ci % 3 === 0 ? 'hostile' : ci % 3 === 1 ? 'ally' : 'neutral');
  });
  return { regions, relationships };
}

function buildContext(): WorldIntelContext {
  const { regions, relationships } = buildWorld();
  return {
    gameId: 'test-game',
    regions: () => regions,
    playerPolityId: () => 'PLAY',
    publicPolityName: (id: string) => `Nome ${id}`,
    results: (): TurnResultRecord[] => [],
    relationship: (from: string, to: string) => relationships.get(`${from}|${to}`) || 'neutral',
    arsenalUnits: (id: string) => (id === 'DEU' ? { infantry: 3 } : {}),
    worldStateOptions: () => ({ modernFacts: false, startDate: '1914-01-01' }),
  };
}

const TEXTS = [
  'creare un esercito a dover',
  'mobilitare contro la Germania e l\'Austria-Ungheria',
  'offerta diplomatica a FRA e al Regno di Francia',
  'russia e serbia preparano la mobilitazione',
  'la Cecoslovacca chiede garanzie; ZZZ risponde',
  'nessuna menzione utile qui dentro',
  'TUR minaccia i Dardanelli',
  'QQQ e ZZZ insieme, più Böhmen e Galizien',
];

describe('WorldIntelService — refactor prestazionale senza cambi di output', () => {
  const ctx = buildContext();
  const service = new WorldIntelService(ctx);

  it('mentionedNpcPolityIds: stesso ordine e stesso insieme della versione precedente', () => {
    expect(service.mentionedNpcPolityIds(TEXTS)).toEqual(referenceMentionedNpcPolityIds(ctx, TEXTS));
  });

  it('mentionedNpcPolityIds: identico anche su singoli testi e su lista vuota', () => {
    expect(service.mentionedNpcPolityIds([])).toEqual(referenceMentionedNpcPolityIds(ctx, []));
    for (const text of TEXTS) {
      expect(service.mentionedNpcPolityIds([text])).toEqual(referenceMentionedNpcPolityIds(ctx, [text]));
    }
    // Il testo più lungo per primo non deve cambiare l'esito (short-circuit dei trovati).
    const reversed = [...TEXTS].reverse();
    expect(service.mentionedNpcPolityIds(reversed)).toEqual(referenceMentionedNpcPolityIds(ctx, reversed));
  });

  it('nationalMilitaryPower: identico con e senza indice condiviso', () => {
    for (const code of [...CODES, 'INESISTENTE']) {
      expect(service.nationalMilitaryPower(code)).toBe(referenceNationalMilitaryPower(ctx, code));
      const byOwner = new Map<string, RegionState[]>();
      for (const region of ctx.regions().values()) {
        const list = byOwner.get(region.owner) || [];
        list.push(region);
        byOwner.set(region.owner, list);
      }
      // Il parametro opzionale è un percorso interno: deve dare lo stesso numero.
      expect((service as unknown as { nationalMilitaryPower: (id: string, byOwner?: Map<string, RegionState[]>) => number })
        .nationalMilitaryPower(code, byOwner)).toBe(referenceNationalMilitaryPower(ctx, code));
    }
  });

  it('nationalEffectiveMilitaryPower: invariato con e senza indice condiviso', () => {
    const accounts = WorldStateEngine.accounts(ctx.regions().values(), ctx.worldStateOptions());
    const byOwner = new Map<string, RegionState[]>();
    for (const region of ctx.regions().values()) {
      const list = byOwner.get(region.owner) || [];
      list.push(region);
      byOwner.set(region.owner, list);
    }
    for (const code of CODES) {
      const expected = referenceNationalEffectiveMilitaryPower(ctx, code, accounts);
      expect(service.nationalEffectiveMilitaryPower(code, accounts)).toBe(expected);
      expect(service.nationalEffectiveMilitaryPower(code, accounts, byOwner)).toBe(expected);
      expect(service.nationalEffectiveMilitaryPower(code)).toBe(
        referenceNationalEffectiveMilitaryPower(ctx, code),
      );
    }
  });

  it('hostileNeighbourCount: identico alla versione precedente', () => {
    for (const code of CODES) {
      const reference = (() => {
        const hostile = new Set<string>();
        for (const region of ctx.regions().values()) {
          if (region.owner !== code) continue;
          for (const borderId of region.borders || []) {
            const other = ctx.regions().get(borderId)?.owner;
            if (other && other !== code && other !== 'neutral' && ctx.relationship(code, other) === 'hostile') hostile.add(other);
          }
        }
        return hostile.size;
      })();
      expect(service.hostileNeighbourCount(code)).toBe(reference);
    }
  });
});

/**
 * World Story — N01: il titolo del dossier è la nazione scelta
 * ===========================================================
 * Invariante **N5** («il nome della nazione giocata è quello della nazione, non
 * di una sua parte») e **N7** («nessun dato inventato per colmare un'assenza»).
 *
 * Il difetto che questo test difende, misurato: su un mondo provinciale
 * (`pax_modern_provinces`) le regioni di una polity si chiamano `Alaska`,
 * `Texas`, `Montana`…, quindi ricavare il nome del paese dalla geografia
 * produceva un **nome falso**. Altrove lo stesso campo restituiva il nome
 * **inglese** del registro («Italy» invece di «Italia»), ignorando la curatela
 * del preset che il motore applica già in cronaca e diplomazia.
 *
 * La regola: **una sola fonte**, i nomi pubblici del motore. Se la fonte tace,
 * il dossier dichiara l'assenza.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNKNOWN_POLITY_NAME, isNameUnknown, resolvePolityName } from './polityName';
import { deriveNationalContext } from './nationalContext';
import type { Game, Region } from '../../types';

const region = (over: Partial<Region>): Region => ({
  id: 'R1', name: 'Regione', owner: 'AAA', gdp: 100, population: 10,
  ...over,
} as Region);

const game = (over: Partial<Game> = {}): Game => ({
  id: 'g1', currentTurn: 1, currentDate: '1951-01-01',
  players: [{ id: 'p1', regionId: 'CAP', polityId: 'USA' } as any],
  ...over,
} as Game);

describe('N01 — il nome della nazione è quello che il motore pubblica', () => {
  it('usa il nome del motore quando c\'è', () => {
    expect(resolvePolityName({ polityId: 'ITA', authoritativeName: 'Regno d\'Italia' })).toBe('Regno d\'Italia');
  });

  it('un mondo provinciale non intitola il dossier col nome di una provincia', () => {
    // Le regioni della polity si chiamano come province: è il caso misurato.
    const regions = [
      region({ id: 'CAP', owner: 'USA', name: 'Alaska' }),
      region({ id: 'R2', owner: 'USA', name: 'Texas' }),
      region({ id: 'R3', owner: 'USA', name: 'Montana' }),
    ];
    const ctx = deriveNationalContext({
      regions,
      currentGame: game(),
      selectedRegion: null,
      nationalAccounts: {},
      relationshipNames: { USA: "Stati Uniti d'America" },
    });
    expect(ctx.nationalName).toBe("Stati Uniti d'America");
    // Il difetto da non reintrodurre: il nome di una provincia.
    expect(ctx.nationalName).not.toBe('Alaska');
    expect(ctx.nationalName).not.toBe('Texas');
  });

  it('senza il nome dal motore dichiara l\'assenza: mai la provincia, mai il codice', () => {
    const regions = [region({ id: 'CAP', owner: 'LKA', name: 'Colombo' })];
    const ctx = deriveNationalContext({
      regions,
      currentGame: game({ players: [{ id: 'p1', regionId: 'CAP', polityId: 'LKA' } as any] }),
      selectedRegion: null,
      nationalAccounts: {},
      // `LKA` è il caso misurato: una polity senza relazioni diplomatiche, quindi
      // assente dalla mappa `names` del motore.
      relationshipNames: {},
    });
    expect(ctx.nationalName).toBe(UNKNOWN_POLITY_NAME);
    expect(isNameUnknown(ctx.nationalName)).toBe(true);
    expect(ctx.nationalName).not.toBe('Colombo');
    expect(ctx.nationalName).not.toBe('LKA');
  });

  it('senza fonte di nomi (fonte caduta) non inventa: dichiara l\'assenza', () => {
    const regions = [region({ id: 'CAP', owner: 'USA', name: 'Alaska' })];
    const ctx = deriveNationalContext({
      regions, currentGame: game(), selectedRegion: null, nationalAccounts: {},
      relationshipNames: null,
    });
    expect(ctx.nationalName).toBe(UNKNOWN_POLITY_NAME);
  });

  it('un codice polity non è un nome, anche se il motore lo pubblicasse come tale', () => {
    expect(resolvePolityName({ polityId: 'ITA', authoritativeName: 'ITA' })).toBe(UNKNOWN_POLITY_NAME);
    expect(resolvePolityName({ polityId: 'ITA', authoritativeName: '  ' })).toBe(UNKNOWN_POLITY_NAME);
    expect(resolvePolityName({ polityId: 'ITA', authoritativeName: null })).toBe(UNKNOWN_POLITY_NAME);
  });

  it('il nome non viene più ricavato da `polityName` o `name` della regione', () => {
    // Guardia contro il falso verde: il test vede davvero il campo rimosso.
    const regions = [
      region({ id: 'CAP', owner: 'ITA', name: 'Aosta', polityName: 'Aosta' } as Partial<Region>),
    ];
    const ctx = deriveNationalContext({
      regions,
      currentGame: game({ players: [{ id: 'p1', regionId: 'CAP', polityId: 'ITA' } as any] }),
      selectedRegion: null,
      nationalAccounts: {},
      relationshipNames: { ITA: 'Italia' },
    });
    expect(ctx.nationalName).toBe('Italia');
    expect(ctx.nationalName).not.toBe('Aosta');
  });
});

describe('N01 — una sola fonte di nomi nel client', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

  it('`nationalContext` non contiene più una mappa di nomi di paese scritta a mano', () => {
    // Il difetto da non reintrodurre: `GOVERNMENT_TYPES`, otto paesi con la loro
    // forma di governo, e il default «Repubblica presidenziale» per tutti gli
    // altri. Una seconda verità parallela al registro del motore.
    const source = read('./nationalContext.ts');
    expect(source).not.toMatch(/GOVERNMENT_TYPES/);
    expect(source).not.toMatch(/Repubblica presidenziale/);
  });

  it('la forma di governo viene solo dal conto del motore, o dichiara l\'assenza', () => {
    const regions = [region({ id: 'CAP', owner: 'GBR' })];
    const senzaConto = deriveNationalContext({
      regions,
      currentGame: game({ players: [{ id: 'p1', regionId: 'CAP', polityId: 'GBR' } as any] }),
      selectedRegion: null,
      nationalAccounts: {},
    });
    // Nessun default inventato: il client non sa, e lo dice.
    expect(senzaConto.governmentType).toBe('');

    const conConto = deriveNationalContext({
      regions,
      currentGame: game({ players: [{ id: 'p1', regionId: 'CAP', polityId: 'GBR' } as any] }),
      selectedRegion: null,
      nationalAccounts: { GBR: { government: 'Monarchia parlamentare' } },
    });
    expect(conConto.governmentType).toBe('Monarchia parlamentare');
  });

  it('il dossier dichiara l\'assenza invece di mostrare un titolo vuoto', () => {
    // Guardia contro il falso verde: la stringa di assenza esiste davvero nel
    // componente, non solo nel read model.
    const desk = read('../Shell/DeskContent.tsx');
    expect(desk).toMatch(/Nome del paese non pubblicato/);
    expect(desk).not.toMatch(/\{nationalName \|\| 'Nazione'\}/);
  });

  it('i nomi pubblicati dal motore sono conservati dal hook, non scartati', () => {
    const snapshot = read('../../hooks/useNationSnapshot.ts');
    expect(snapshot).toMatch(/relationshipNames/);
    expect(snapshot).toMatch(/setRelationshipNames\(data\?\.names/);
  });
});

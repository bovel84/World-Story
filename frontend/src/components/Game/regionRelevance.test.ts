import { describe, expect, it } from 'vitest';
import type { Region } from '../../types';
import { MAX_NAMED_ZONES, MIN_NAME_CHARS, namedRegionIds, resolveRegionZones } from './regionRelevance';

/** Una regione canonica minima: nome, proprietario, adiacenza. */
const region = (id: string, name: string, borders: string[] = [], owner = 'A'): Region =>
  ({ id, name, owner, color: '#315f87', borders, objects: [], metadata: {} } as unknown as Region);

describe('MAP01 — le zone nominate nel testo', () => {
  const regions = [
    region('r1', 'Irbid'),
    region('r2', 'Sakib'),
    region('r3', 'Al Salt'),
    region('r4', 'Ulleungdo Island'),
  ];

  it('riconosce un nome nel testo, senza dipendere da maiuscole o accenti', () => {
    expect(namedRegionIds(regions, 'La situazione di Irbid è critica.')).toEqual(['r1']);
    expect(namedRegionIds(regions, 'parliamo di IRBID')).toEqual(['r1']);
  });

  it('riconosce un nome di più parole come sequenza di parole intere', () => {
    expect(namedRegionIds(regions, 'La provincia di Al Salt è in difficoltà.')).toEqual(['r3']);
    // «Salt» da solo non è un nome: la provincia si chiama «Al Salt».
    expect(namedRegionIds(regions, 'Il sale (salt) non c\'entra.')).toEqual([]);
  });

  it('non riconosce una sottostringa: «sakibullah» non è «Sakib»', () => {
    expect(namedRegionIds(regions, 'Il governatore Sakibullah ha parlato.')).toEqual([]);
  });

  it('un nome troppo corto non è un toponimo', () => {
    const short = [region('s1', 'Al'), region('s2', 'Ba'), region('s3', 'Delhi')];
    expect(MIN_NAME_CHARS).toBeGreaterThan(2);
    // «Al» e «Ba» non bastano; «Delhi» sì.
    expect(namedRegionIds(short, 'Al e Ba sono province, Delhi è una città.')).toEqual(['s3']);
  });

  it('un nome ambiguo non produce nulla (fail-closed)', () => {
    const ambiguous = [region('a1', 'Tripoli'), region('a2', 'Tripoli'), region('a3', 'Sidone')];
    expect(namedRegionIds(ambiguous, 'Tripoli è contesa, Sidone no.')).toEqual(['a3']);
  });

  it('un nome del testo che non è una regione non esiste per il motore', () => {
    expect(namedRegionIds(regions, 'Parlami di Sivas e di Kaliningrad.')).toEqual([]);
  });

  it('restituisce le zone nell\'ordine in cui compaiono, senza ripetizioni', () => {
    const text = 'Sakib, poi Irbid, poi di nuovo Sakib.';
    expect(namedRegionIds(regions, text)).toEqual(['r2', 'r1']);
  });

  it('rispetta il tetto delle zone nominate', () => {
    const many = Array.from({ length: MAX_NAMED_ZONES + 5 }, (_, i) => region(`m${i}`, `Provincia${i}`));
    const text = many.map((_, i) => `Provincia${i}`).join(' ');
    expect(namedRegionIds(many, text)).toHaveLength(MAX_NAMED_ZONES);
    expect(namedRegionIds(many, text, 2)).toHaveLength(2);
  });

  it('un nome con apostrofo o trattino resta una parola sola', () => {
    const odd = [region('o1', "Sant'Angelo"), region('o2', 'Aix-en-Provence')];
    // La normalizzazione spezza sull'apostrofo in due parole: il nome canonico
    // ripiegato è «sant angelo», e come tale va ritrovato nel testo.
    expect(namedRegionIds(odd, "La zona di Sant'Angelo è colpita.")).toEqual(['o1']);
    expect(namedRegionIds(odd, 'La zona di Aix-en-Provence è colpita.')).toEqual(['o2']);
  });

  it('un testo vuoto o assente non produce zone', () => {
    expect(namedRegionIds(regions, '')).toEqual([]);
    expect(namedRegionIds(regions, undefined)).toEqual([]);
  });
});

describe('MAP01 — i ruoli delle zone', () => {
  const regions = [
    region('r1', 'Irbid', ['r2', 'r9']),
    region('r2', 'Sakib', ['r1', 'r3']),
    region('r3', 'Al Salt', ['r2']),
    region('r4', 'Maan', []),
  ];

  it('senza un riferimento le zone nominate restano l\'unica primaria, il resto è contesto', () => {
    const roles = resolveRegionZones({ regions, text: 'La crisi di Irbid.' });
    expect(roles.primary).toEqual(['r1']);
    expect(roles.adjacent).toEqual(['r2']);
    expect(roles.context).toEqual(['r3', 'r4']);
  });

  it('le adiacenti si leggono dall\'adiacenza canonica e non includono mai una primaria', () => {
    const roles = resolveRegionZones({ regions, text: 'Irbid e Sakib insieme.' });
    expect(roles.primary).toEqual(['r1', 'r2']);
    // r3 è vicino di r2; r1-r2 sono primarie e non rientrano fra le adiacenti.
    expect(roles.adjacent).toEqual(['r3']);
    expect(roles.context).toEqual(['r4']);
  });

  it('un vicino che non è nella scheda viene omesso: l\'insieme non cresce di nascosto', () => {
    const roles = resolveRegionZones({ regions, text: 'Irbid.' });
    // r9 è adiacente di r1 ma non è fra le regioni candidate.
    expect(roles.adjacent).not.toContain('r9');
    expect([...roles.primary, ...roles.context, ...roles.adjacent].sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('un riferimento verificato ha la precedenza ed è una primaria', () => {
    const roles = resolveRegionZones({ regions, verified: ['r4'], text: 'La crisi di Irbid.' });
    expect(roles.primary).toEqual(['r4', 'r1']);
    expect(roles.adjacent).toEqual(['r2']);
    expect(roles.context).toEqual(['r3']);
  });

  it('senza primarie tutto è contesto (il comportamento di prima di questo modulo)', () => {
    const roles = resolveRegionZones({ regions, text: 'Nessun nome di provincia qui.' });
    expect(roles.primary).toEqual([]);
    expect(roles.adjacent).toEqual([]);
    expect(roles.context).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('un id verificato che non esiste fra le regioni viene scartato', () => {
    const roles = resolveRegionZones({ regions, verified: ['invented'], text: '' });
    expect(roles.primary).toEqual([]);
    expect(roles.context).toHaveLength(4);
  });

  it('nessun id restituito è fuori dall\'insieme candidato', () => {
    const roles = resolveRegionZones({ regions, verified: ['r1', 'invented'], text: 'Sakib e Maan.' });
    const available = new Set(regions.map(r => r.id));
    for (const id of [...roles.primary, ...roles.context, ...roles.adjacent]) {
      expect(available.has(id)).toBe(true);
    }
    // Ogni candidato compare una volta sola, in un ruolo solo.
    const all = [...roles.primary, ...roles.context, ...roles.adjacent];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(regions.length);
  });

  it('è deterministico: stesso input, stesso output', () => {
    const first = resolveRegionZones({ regions, text: 'Irbid e Sakib.' });
    const second = resolveRegionZones({ regions, text: 'Irbid e Sakib.' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

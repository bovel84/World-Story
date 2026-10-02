/**
 * WS-GOV-COUNCIL-HARDENING — La localizzazione canonica (punto 15, livello puro)
 * ==============================================================================
 * Difende la regola: un `regionId` nasce **solo** da una regione canonica della
 * partita il cui nome compare nel testo. Con più candidati non si sceglie: la
 * localizzazione resta ambigua e la riunione non è pronta.
 */
import { describe, expect, it } from 'vitest';
import { ambiguousLocationQuestion, regionMatchKeys, resolveMeetingLocation } from './meetingLocalization';

const REGIONS = [
  { id: 'SARAJEVO', name: 'Sarajevo' },
  { id: 'NOVI_SAD', name: 'Novi Sad' },
  { id: 'BANJA_LUKA', name: 'Banja Luka' },
  { id: 'ALFA', name: 'Alfa' },
];

describe('risoluzione della localizzazione (punto 15)', () => {
  it('risolve una regione nominata nel testo, con l’ID canonico', () => {
    const location = resolveMeetingLocation('Voglio costruire una fabbrica siderurgica a Sarajevo.', REGIONS);
    expect(location.status).toBe('resolved');
    expect(location.region).toEqual({ regionId: 'SARAJEVO', regionLabel: 'Sarajevo' });
  });

  it('riconosce il toponimo di un nome composto', () => {
    const location = resolveMeetingLocation('Costruiamo il porto a Novi Sad entro il 1930.', REGIONS);
    expect(location.region?.regionId).toBe('NOVI_SAD');
  });

  it('non inventa un ID quando nessuna regione è nominata', () => {
    const location = resolveMeetingLocation('Voglio costruire una fabbrica siderurgica.', REGIONS);
    expect(location.status).toBe('missing');
    expect(location.region).toBeNull();
    expect(location.candidates).toEqual([]);
  });

  it('non abbina una parola che contiene il nome di una regione', () => {
    // «Alfabeto» contiene «alfa» come sottostringa ma non è la regione Alfa.
    const location = resolveMeetingLocation('Riformiamo l’alfabeto nazionale.', REGIONS);
    expect(location.status).toBe('missing');
  });

  it('è ambigua quando il testo nomina più regioni: non sceglie a caso', () => {
    const location = resolveMeetingLocation('Colleghiamo Sarajevo e Novi Sad con una ferrovia.', REGIONS);
    expect(location.status).toBe('ambiguous');
    expect(location.region).toBeNull();
    expect(location.candidates.map(candidate => candidate.regionId).sort()).toEqual(['NOVI_SAD', 'SARAJEVO']);
    expect(ambiguousLocationQuestion(location.candidates)).toContain('Novi Sad');
  });

  it('le chiavi di confronto ignorano accenti e maiuscole', () => {
    expect(regionMatchKeys('Sarajevo')).toContain('sarajevo');
  });
});

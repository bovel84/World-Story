import { describe, expect, it } from 'vitest';
import { publicNarrativeText } from '../src/utils/public-narrative';

describe('filtro editoriale dei dispacci', () => {
  it('presenta il giocatore come la nazione controllata', () => {
    const text = publicNarrativeText(
      'Partecipanti: Player, Israele. Il giocatore presenta una proposta e la risposta dell’utente resta attesa.',
      'Palestina',
    );
    expect(text).toContain('Palestina');
    expect(text).toContain('Israele');
    expect(text).not.toMatch(/Player|giocatore|utente/i);
  });

  it('rende narrativa una vecchia intestazione di riunione', () => {
    const text = publicNarrativeText('Partecipanti: Player, Turkey. Turkey: apre il confronto.', 'Palestina');
    expect(text).toBe('Alla riunione prendono parte Palestina, Turchia. Turchia dichiara: apre il confronto.');
  });

  it('rimuove alias e identificativi tecnici senza cambiare il fatto narrato', () => {
    const text = publicNarrativeText(
      'Israele [ISR] opposed; actionId a91b2 e mapChanges confermano una misura partial.',
      'Palestina',
    );
    expect(text).toContain('Israele contraria');
    expect(text).toContain('cambiamenti territoriali');
    expect(text).toContain('parziale');
    expect(text).not.toMatch(/\[ISR\]|actionId|a91b2|mapChanges|partial|opposed/);
  });
});

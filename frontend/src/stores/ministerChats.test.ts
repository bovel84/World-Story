/**
 * P02-bis — La cronaca dei ministri è PER SEDIA, non mescolata
 * ===========================================================
 * Il difetto segnalato dall'autore: «io la vorrei come quella del consulente,
 * adesso è tutto mischiato». Due cose erano sbagliate, e questo file difende la
 * correzione di entrambe:
 *
 *  1. **La cronaca viveva nello stato locale del componente.** Cambiare ministro
 *     la cancellava, e nulla sopravviveva alla chiusura del pannello. Ora sta
 *     nello store, **per sedia**: ogni ministro ha il suo filo;
 *  2. **due sedie non si distinguevano.** Con una mappa per sedia, scrivere al
 *     Tesoro non tocca il dialogo con i Lavori — che è il senso di avere ministri
 *     diversi invece di un consulente solo.
 *
 * Guardia contro il falso verde: si verifica anche il caso opposto — che una
 * sedia DAVVERO non veda i messaggi di un'altra. Un test che si accontentasse di
 * «il messaggio c'è» passerebbe anche con una sola cronaca condivisa.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';

const store = () => useChatStore.getState();

describe('P02-bis — la cronaca dei ministri', () => {
  beforeEach(() => {
    useChatStore.setState({ ministerChats: {}, ministerStreamingSeat: null });
  });

  it('ogni sedia ha il suo filo: scrivere al Tesoro non tocca i Lavori', () => {
    store().addMinisterMessage('tesoro', { role: 'user', content: 'Quanto possiamo spendere?' });
    store().addMinisterMessage('lavori', { role: 'user', content: 'Che cantieri abbiamo?' });

    expect(store().ministerChats.tesoro).toHaveLength(1);
    expect(store().ministerChats.lavori).toHaveLength(1);
    expect(store().ministerChats.tesoro[0].content).toContain('spendere');
    // E il messaggio dei Lavori NON è in quello del Tesoro: è il difetto che
    // l'autore ha visto, e qui è la sua guardia.
    expect(store().ministerChats.tesoro.map(m => m.content).join(' ')).not.toContain('cantieri');
  });

  it('una sedia che non ha mai parlato non ha una cronaca inventata', () => {
    store().addMinisterMessage('tesoro', { role: 'user', content: 'x' });
    expect(store().ministerChats.guerra).toBeUndefined();
  });

  it('lo stream aggiunge token all’ULTIMO messaggio DELLA SEDIA giusta', () => {
    // Il caso che una mappa condivisa sbaglierebbe: due stream in corso su sedie
    // diverse non devono scrivere nello stesso posto.
    store().addMinisterMessage('tesoro', { role: 'assistant', content: '' });
    store().addMinisterMessage('lavori', { role: 'assistant', content: '' });
    store().appendToLastMinisterMessage('tesoro', 'Il bilancio');
    store().appendToLastMinisterMessage('tesoro', ' regge.');
    store().appendToLastMinisterMessage('lavori', 'Tre cantieri');

    expect(store().ministerChats.tesoro[0].content).toBe('Il bilancio regge.');
    expect(store().ministerChats.lavori[0].content).toBe('Tre cantieri');
  });

  it('appendersi a una sedia senza messaggi non crea spazzatura', () => {
    store().appendToLastMinisterMessage('esteri', 'ciao');
    expect(store().ministerChats.esteri).toBeUndefined();
  });

  it('cambiare ministro NON cancella il dialogo con il precedente', () => {
    // Il difetto esatto: prima la cronaca era locale al componente, quindi
    // cambiare sedia la perdeva. Nello store, il filo resta.
    store().addMinisterMessage('tesoro', { role: 'user', content: 'Prima domanda' });
    store().addMinisterMessage('interno', { role: 'user', content: 'Altra domanda' });
    // Tornando al Tesoro, il suo filo è ancora lì.
    expect(store().ministerChats.tesoro).toHaveLength(1);
    expect(store().ministerChats.tesoro[0].content).toBe('Prima domanda');
  });

  it('lo streaming è di UNA sedia alla volta, e si sa quale', () => {
    store().setMinisterStreaming('tesoro');
    expect(store().ministerStreamingSeat).toBe('tesoro');
    store().setMinisterStreaming(null);
    expect(store().ministerStreamingSeat).toBeNull();
  });

  it('la cronaca di un ministro si può azzerare senza toccare le altre', () => {
    store().addMinisterMessage('tesoro', { role: 'user', content: 'a' });
    store().addMinisterMessage('lavori', { role: 'user', content: 'b' });
    store().clearMinisterChat('tesoro');
    expect(store().ministerChats.tesoro).toBeUndefined();
    expect(store().ministerChats.lavori).toHaveLength(1);
  });

  it('la cronaca dei ministri è separata da quella del Consulente', () => {
    // Sono due dialoghi diversi con due interlocutori diversi: mescolarli
    // sarebbe lo stesso difetto a un livello più alto.
    store().addAdvisorMessage({ role: 'user', content: 'Domanda al Consulente' });
    store().addMinisterMessage('tesoro', { role: 'user', content: 'Domanda al Tesoro' });
    expect(store().advisorMessages.map(m => m.content)).toEqual(['Domanda al Consulente']);
    expect(store().ministerChats.tesoro[0].content).toBe('Domanda al Tesoro');
  });

  it('al cambio di partita le cronache si azzerano tutte', () => {
    store().addMinisterMessage('tesoro', { role: 'user', content: 'della vecchia partita' });
    store().setGameId('partita-nuova');
    expect(store().ministerChats).toEqual({});
    expect(store().ministerStreamingSeat).toBeNull();
  });
});

/**
 * DELETE SAVES — picker dei salvataggi: eliminazione con conferma.
 * ===============================================================
 * La cancellazione è distruttiva: qui si prova che
 *  - i salvataggi riservati (`__rewind__`, `__n__`, qualunque `__…__`) sono
 *    invisibili **e** senza pulsante di eliminazione (doppia difesa: il backend
 *    rifiuta comunque, vedi `tests/saves-delete.test.ts`);
 *  - il pulsante «Elimina» chiede la conferma e non cancella al primo clic;
 *  - l'item sparisce **dopo** la risposta del backend, mai prima;
 *  - l'etichetta accessibile è semantica e inizia con la parola visibile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DELETE_SAVE_ERROR,
  DELETE_SAVE_RESERVED_ERROR,
  SavePickerList,
  removeSaveFromList,
  saveDeleteConfirmText,
  saveDeleteLabel,
  saveDeletedNotice,
  visibleSaves,
  type SaveSummary,
} from './SavePickerModal';
import { isReservedSave } from './reservedSaves';

const source = fs.readFileSync(path.resolve(__dirname, 'SavePickerModal.tsx'), 'utf8');

const save = (id: string, name: string, savedAt: string, turn = 7): SaveSummary => ({
  id, game_id: 'game-1', name, current_turn: turn, current_date: '2026-03-01', saved_at: savedAt,
});

const USER_SAVE = save('save-user', 'Partita 15/09/2026', '2026-03-01T10:00:00.000Z');
const OLD_SAVE = save('save-old', 'Partita 12/09/2026', '2026-02-20T10:00:00.000Z', 5);
const REWIND_SAVE = save('save-rewind', '__rewind__', '2026-03-01T11:00:00.000Z');
const LEGACY_SAVE = save('save-n', '__n__', '2026-03-01T11:30:00.000Z');

describe('DELETE SAVES — regola dei salvataggi riservati', () => {
  it('riconosce gli snapshot interni del motore', () => {
    expect(isReservedSave(REWIND_SAVE)).toBe(true);
    expect(isReservedSave(LEGACY_SAVE)).toBe(true);
    expect(isReservedSave({ name: '  __rewind__  ' })).toBe(true);
    expect(isReservedSave({ name: '__qualunque__' })).toBe(true);
    expect(isReservedSave({ name: '' })).toBe(true);
    expect(isReservedSave(null)).toBe(true);
    expect(isReservedSave(USER_SAVE)).toBe(false);
    expect(isReservedSave({ name: '_rewind_' })).toBe(false);
  });

  it('l’elenco visibile non contiene snapshot interni ed è ordinato dal più recente', () => {
    const visible = visibleSaves([OLD_SAVE, REWIND_SAVE, USER_SAVE, LEGACY_SAVE, { id: '' } as SaveSummary]);
    expect(visible.map(item => item.id)).toEqual([USER_SAVE.id, OLD_SAVE.id]);
  });

  it('la rimozione locale è selettiva: sparisce solo l’id cancellato', () => {
    expect(removeSaveFromList([USER_SAVE, OLD_SAVE], USER_SAVE.id).map(item => item.id)).toEqual([OLD_SAVE.id]);
  });

  it('etichetta, conferma ed esito sono espliciti e non parlano di stato di gioco', () => {
    expect(saveDeleteLabel(USER_SAVE)).toBe('Elimina il salvataggio “Partita 15/09/2026”');
    expect(saveDeleteLabel(USER_SAVE).startsWith('Elimina')).toBe(true);
    const confirm = saveDeleteConfirmText(USER_SAVE);
    expect(confirm).toContain('Partita 15/09/2026');
    expect(confirm).toContain('Mossa 7');
    expect(confirm).toContain('1 mar 2026');
    expect(confirm).toContain('La partita in corso e il suo stato non vengono toccati.');
    expect(saveDeletedNotice(USER_SAVE)).toBe('Salvataggio “Partita 15/09/2026” eliminato.');
  });
});

describe('DELETE SAVES — lista di presentazione', () => {
  it('mostra un pulsante «Elimina» per ogni salvataggio, con aria-label semantica', () => {
    const html = renderToStaticMarkup(
      <SavePickerList
        saves={[USER_SAVE, OLD_SAVE]}
        currentGameId="game-1"
        onSelect={() => undefined}
        onRequestDelete={() => undefined}
      />,
    );
    expect(html).toContain('data-save-delete="save-user"');
    expect(html).toContain('data-save-delete="save-old"');
    expect(html).toContain('aria-label="Elimina il salvataggio “Partita 15/09/2026”"');
    expect(html.match(/>Elimina</g)?.length).toBe(2);
    // La selezione resta un'azione separata, con la sua etichetta.
    expect(html).toContain('Partita attuale');
  });

  it('non offre l’eliminazione per uno snapshot riservato, anche se arrivasse fin qui', () => {
    const html = renderToStaticMarkup(
      <SavePickerList
        saves={[REWIND_SAVE]}
        onSelect={() => undefined}
        onRequestDelete={() => undefined}
      />,
    );
    expect(html).not.toContain('data-save-delete');
    expect(html).not.toContain('>Elimina<');
    expect(html).toContain('__rewind__');
  });

  it('durante l’eliminazione la riga è occupata: pulsanti disabilitati', () => {
    const html = renderToStaticMarkup(
      <SavePickerList
        saves={[USER_SAVE, OLD_SAVE]}
        onSelect={() => undefined}
        onRequestDelete={() => undefined}
        deletingId={USER_SAVE.id}
      />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Eliminazione…');
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('data-save-delete="save-old"');
  });
});

describe('DELETE SAVES — la modale non cancella mai al primo clic', () => {
  it('il clic su «Elimina» chiede la conferma invece di chiamare il backend', () => {
    const requestHandler = source.slice(
      source.indexOf('onRequestDelete={(save)'),
      source.indexOf('deletingId={deletingId}'),
    );
    expect(requestHandler).toContain('setPendingDelete(save)');
    expect(requestHandler).not.toContain('savesApi.remove');
  });

  it('la conferma esplicita è una modale dedicata, con annulla come focus iniziale', () => {
    expect(source).toContain('Eliminare il salvataggio?');
    expect(source).toContain('Elimina definitivamente');
    expect(source).toContain('ariaLabel="Conferma eliminazione del salvataggio"');
    expect(source).toContain('initialFocusRef={cancelRef}');
    expect(source).toContain('data-save-delete-target');
  });

  it('l’item sparisce solo DOPO la risposta del backend (nessuna rimozione ottimistica)', () => {
    const confirm = source.slice(source.indexOf('const confirmDelete'), source.indexOf('const closeConfirm'));
    const callIndex = confirm.indexOf('await savesApi.remove(target.id)');
    const removeIndex = confirm.indexOf('removeSaveFromList(current, target.id)');
    expect(callIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(callIndex);
    expect(confirm.slice(0, callIndex)).not.toContain('setSaves');
    // In errore la lista NON viene toccata: solo un messaggio, l'item resta.
    const catchBlock = confirm.slice(confirm.indexOf('} catch (e)'));
    expect(catchBlock).not.toContain('setSaves');
    expect(catchBlock).toContain('DELETE_SAVE_ERROR');
    expect(catchBlock).toContain('DELETE_SAVE_RESERVED_ERROR');
  });

  it('messaggi di errore e di esito sono annunciati (role alert/status)', () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain('role="status"');
    expect(DELETE_SAVE_ERROR).toBe('Impossibile eliminare il salvataggio. Riprova.');
    expect(DELETE_SAVE_RESERVED_ERROR).toBe('Salvataggio riservato: non cancellabile.');
  });
});

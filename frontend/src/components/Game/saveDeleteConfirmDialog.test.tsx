/**
 * DELETE SAVES — dialogo di conferma condiviso
 * ============================================
 * Un'unica implementazione per la home e per l'archivio in-game: se la conferma
 * cambia, cambia per entrambe. Qui si prova il contratto del componente
 * (chiuso quando `save` è null, nessuna azione durante l'operazione, focus
 * iniziale sicuro) e che le due superfici lo usino davvero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveDeleteConfirmText, type SaveSummary } from './saveDeletion';

const dialog = fs.readFileSync(path.resolve(__dirname, 'SaveDeleteConfirmDialog.tsx'), 'utf8');
const landing = fs.readFileSync(path.resolve(__dirname, 'Landing.tsx'), 'utf8');
const picker = fs.readFileSync(path.resolve(__dirname, 'SavePickerModal.tsx'), 'utf8');

const SAVE: SaveSummary = {
  id: 'save-user', game_id: 'game-1', name: 'Partita 15/09/2026',
  current_turn: 7, current_date: '2026-03-01', saved_at: '2026-03-01T10:00:00.000Z',
};

describe('DELETE SAVES — dialogo di conferma condiviso', () => {
  it('è chiuso quando non c’è nulla da confermare', () => {
    expect(dialog).toContain('open={save !== null}');
  });

  it('annulla è il focus iniziale e durante l’operazione nulla è disponibile', () => {
    expect(dialog).toContain('initialFocusRef={cancelRef}');
    expect(dialog).toContain('disabled={busy}');
    expect(dialog).toContain('closeOnBackdrop={!busy}');
    expect(dialog).toContain('closeOnEscape={!busy}');
    expect(dialog).toContain("busy ? 'Eliminazione…' : 'Elimina definitivamente'");
  });

  it('non cancella e non conosce l’API: la decisione è solo un evento', () => {
    expect(dialog).not.toContain('savesApi');
    expect(dialog).not.toContain('deleteSave');
    expect(dialog).toContain('onClick={onCancel}');
    expect(dialog).toContain('onClick={onConfirm}');
  });

  it('dice cosa succede e cosa NON succede', () => {
    const text = saveDeleteConfirmText(SAVE);
    expect(text).toContain('Partita 15/09/2026');
    expect(text).toContain('Mossa 7');
    expect(text).toContain('1 mar 2026');
    expect(text).toContain('La partita in corso e il suo stato non vengono toccati.');
    expect(dialog).toContain('data-save-delete-target={save.id}');
  });

  it('home e archivio in-game usano lo stesso dialogo', () => {
    for (const surface of [landing, picker]) {
      expect(surface).toContain("import { SaveDeleteConfirmDialog } from './SaveDeleteConfirmDialog'");
      expect(surface).toContain('<SaveDeleteConfirmDialog');
      expect(surface).toContain('onCancel={deletion.cancel}');
      expect(surface).toContain('onConfirm={deletion.confirm}');
    }
    // …e nessuna delle due reimplementa la conferma.
    expect(landing).not.toContain('ariaLabel="Conferma eliminazione del salvataggio"');
    expect(picker).not.toContain('ariaLabel="Conferma eliminazione del salvataggio"');
  });
});

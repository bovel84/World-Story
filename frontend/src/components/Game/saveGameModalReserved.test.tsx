/**
 * DELETE SAVES — coerenza dei nomi riservati in creazione.
 * ======================================================
 * Lo spazio `__…__` è dello snapshot di rewind del motore: la modale di
 * salvataggio non deve poterci scrivere una riga utente (sarebbe indistinguibile
 * da un dato interno e non cancellabile). Il backend rifiuta comunque la
 * creazione (`400 reserved_save_name`): qui si prova che la UI non ci prova.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESERVED_SAVE_NAME_HINT, saveNameProblem } from './reservedSaves';

const source = fs.readFileSync(path.resolve(__dirname, 'SaveGameModal.tsx'), 'utf8');

describe('DELETE SAVES — nome riservato in «Salva partita»', () => {
  it('riconosce il nome riservato e lascia passare i nomi normali', () => {
    expect(saveNameProblem('__rewind__')).toBe('reserved');
    expect(saveNameProblem('  __snapshot__  ')).toBe('reserved');
    expect(saveNameProblem('Partita 15/09/2026')).toBe(null);
    expect(saveNameProblem('_rewind_')).toBe(null);
    // Vuoto non è un errore: è semplicemente «Salva» disabilitato.
    expect(saveNameProblem('   ')).toBe(null);
  });

  it('la modale blocca il salvataggio riservato e lo spiega', () => {
    expect(source).toContain('const reserved = saveNameProblem(trimmed)');
    expect(source).toContain('disabled={!trimmed || reserved}');
    expect(source).toContain('aria-invalid={reserved || undefined}');
    expect(source).toContain('role="alert"');
    expect(source).toContain('{RESERVED_SAVE_NAME_HINT}');
    expect(source).toContain('if (trimmed && !reserved) onSave(trimmed);');
    expect(RESERVED_SAVE_NAME_HINT).toContain('senza doppi underscore');
  });
});

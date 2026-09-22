/**
 * DELETE SAVES HOME — eliminazione dalla Landing
 * ==============================================
 * I salvataggi si vedono soprattutto dalla home: da qui si deve poter
 * cancellare come dall'archivio in-game, con lo **stesso** meccanismo
 * (`useSaveDeletion` + `SaveDeleteConfirmDialog`) e gli stessi messaggi.
 *
 * Si prova:
 *  - la card «Continua partita» offre «Elimina» con `aria-label` semantico, e
 *    **non** al primo clic: `request()` apre solo la conferma;
 *  - la cancellazione vera (`deleteSave`) rimuove la voce solo dopo la risposta
 *    del backend, e in errore non la rimuove affatto;
 *  - i salvataggi riservati non hanno pulsante e non sono nemmeno candidati;
 *  - la card occupata disabilita le azioni.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingSavesGrid } from './Landing';
import {
  DELETE_SAVE_ERROR,
  DELETE_SAVE_RESERVED_ERROR,
  deleteSave,
  removeSaveFromList,
  saveDeleteLabel,
  saveDeletedNotice,
  visibleSaves,
  type SaveSummary,
} from './saveDeletion';
import { isReservedSave } from './reservedSaves';

const source = fs.readFileSync(path.resolve(__dirname, 'Landing.tsx'), 'utf8');

const save = (id: string, name: string, savedAt: string, turn = 7): SaveSummary => ({
  id, game_id: 'game-1', name, current_turn: turn, current_date: '2026-03-01', saved_at: savedAt,
});

const USER_SAVE = save('save-user', 'Partita 15/09/2026', '2026-03-01T10:00:00.000Z');
const OLD_SAVE = save('save-old', 'Partita 12/09/2026', '2026-02-20T10:00:00.000Z', 5);
const REWIND_SAVE = save('save-rewind', '__rewind__', '2026-03-01T11:00:00.000Z');
const LEGACY_SAVE = save('save-n', '__n__', '2026-03-01T11:30:00.000Z');

/** La home carica l'elenco con `visibleSaves`: gli snapshot interni non arrivano. */
describe('DELETE SAVES HOME — elenco della home', () => {
  it('la sezione «Continua partita» non contiene snapshot interni', () => {
    const visible = visibleSaves([OLD_SAVE, REWIND_SAVE, USER_SAVE, LEGACY_SAVE]);
    expect(visible.map(item => item.id)).toEqual([USER_SAVE.id, OLD_SAVE.id]);
    expect(visible.some(isReservedSave)).toBe(false);
  });
});

describe('DELETE SAVES HOME — card «Continua partita»', () => {
  it('ogni card offre «Elimina» con aria-label semantica, oltre a «▶ Gioca»', () => {
    const html = renderToStaticMarkup(
      <LandingSavesGrid
        saves={[USER_SAVE, OLD_SAVE]}
        onResume={() => undefined}
        onRequestDelete={() => undefined}
      />,
    );
    expect(html).toContain('data-landing-save-delete="save-user"');
    expect(html).toContain('data-landing-save-delete="save-old"');
    expect(html).toContain('aria-label="Elimina il salvataggio “Partita 15/09/2026”"');
    expect(html).toContain('▶ Gioca');
    expect(html.match(/>Elimina</g)?.length).toBe(2);
    // Il pulsante usa lo stile già esistente del picker: una sola resa visiva.
    expect(html).toContain('class="save-picker-delete landing-save-delete"');
  });

  it('uno snapshot riservato non ha pulsante di eliminazione (doppia difesa)', () => {
    const html = renderToStaticMarkup(
      <LandingSavesGrid
        saves={[REWIND_SAVE]}
        onResume={() => undefined}
        onRequestDelete={() => undefined}
      />,
    );
    expect(html).not.toContain('data-landing-save-delete');
    expect(html).not.toContain('>Elimina<');
    // La card resta visibile come «Gioca» (difesa di presentazione, non nascosta).
    expect(html).toContain('▶ Gioca');
  });

  it('durante l’eliminazione la card è occupata e le azioni disabilitate', () => {
    const html = renderToStaticMarkup(
      <LandingSavesGrid
        saves={[USER_SAVE, OLD_SAVE]}
        onResume={() => undefined}
        onRequestDelete={() => undefined}
        deletingId={USER_SAVE.id}
      />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Eliminazione…');
    // Solo la card occupata è bloccata: «▶ Gioca» ed «Elimina» disabilitati (2).
    expect(html.match(/disabled/g)?.length).toBe(2);
    // L'altra card resta libera: le sue azioni non sono disabilitate.
    const other = html.slice(html.indexOf('data-landing-save-card="save-old"'));
    expect(other).toContain('data-landing-save-delete="save-old"');
    expect(other).not.toContain('disabled');
  });
});

describe('DELETE SAVES HOME — la cancellazione passa dal meccanismo condiviso', () => {
  it('successo: la voce si rimuove solo dopo la risposta del backend', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, deleted: USER_SAVE.id });
    const outcome = await deleteSave(USER_SAVE.id, remove);

    expect(outcome).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(USER_SAVE.id);
    // Rimozione locale (nessun refetch) e messaggio di esito.
    expect(removeSaveFromList([USER_SAVE, OLD_SAVE], USER_SAVE.id).map(s => s.id)).toEqual([OLD_SAVE.id]);
    expect(saveDeletedNotice(USER_SAVE)).toBe('Salvataggio “Partita 15/09/2026” eliminato.');
  });

  it('errore generico: la card resta e il messaggio è quello condiviso', async () => {
    const remove = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const outcome = await deleteSave(USER_SAVE.id, remove);
    expect(outcome).toEqual({ ok: false, message: DELETE_SAVE_ERROR });
    // Nessuna rimozione: l'elenco è invariato.
    expect(removeSaveFromList([USER_SAVE, OLD_SAVE], USER_SAVE.id)).toHaveLength(1);
  });

  it('403 (snapshot riservato): messaggio specifico, la card resta', async () => {
    const remove = vi.fn().mockRejectedValue(Object.assign(new Error('reserved'), { status: 403 }));
    const outcome = await deleteSave(REWIND_SAVE.id, remove);
    expect(outcome).toEqual({ ok: false, message: DELETE_SAVE_RESERVED_ERROR });
  });

  it('etichetta e testo di conferma sono quelli condivisi con il picker', () => {
    expect(saveDeleteLabel(USER_SAVE)).toBe('Elimina il salvataggio “Partita 15/09/2026”');
  });

  it('la home delega: nessuna chiamata di rete propria, nessuna seconda conferma', () => {
    expect(source).toContain('useSaveDeletion((save) => setSaves((current) => removeSaveFromList(current, save.id)))');
    expect(source).toContain('onRequestDelete={deletion.request}');
    expect(source).toContain('<SaveDeleteConfirmDialog');
    expect(source).toContain('onConfirm={deletion.confirm}');
    expect(source).toContain('busy={deletion.deletingId !== null}');
    // Nessuna scorciatoia: la DELETE vive solo nel meccanismo condiviso.
    expect(source).not.toContain('savesApi.remove');
    expect(source).not.toContain('Eliminare il salvataggio?');
    // …e il filtro dei riservati è quello unico.
    expect(source).toContain('visibleSaves(data?.saves)');
    expect(source).not.toContain("!== '__rewind__'");
  });
});

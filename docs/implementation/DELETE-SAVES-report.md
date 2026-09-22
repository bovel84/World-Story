# DELETE SAVES — cancellazione delle partite salvate

Base: `main = 2323e36` (MAP P6 mergiata). Branch: `feat/delete-saves`.
Nessuna migrazione, nessun nuovo endpoint oltre `DELETE /api/saves/:id`, nessuna
modifica a motore di simulazione, `GamePersistenceService`/rewind, schema DB,
playback, branching, checkpoint, MAP P1–P6, MILITARY P4–P6.

## 1. Endpoint aggiunto

`backend-nest/src/routes/saves.routes.ts` — `DELETE /api/saves/:id`:

| Caso | Risposta |
|---|---|
| save esistente e cancellabile | **200** `{ ok: true, deleted: "<id>" }` |
| id inesistente (o già cancellato) | **404** `{ error: 'Save not found' }` |
| snapshot interno del motore | **403** `{ error: 'Salvataggio riservato: non cancellabile', code: 'reserved_save' }` |

Inventario endpoint aggiornato di conseguenza: `docs/implementation/q02-endpoint-inventory.json`
**107 → 108** totali, **57 → 58** mutanti (`saves.routes.ts` 2 → 3).

Implementazione volutamente minima: una `SELECT id, name` (per la guardia), **una
sola** istruzione di scrittura `DELETE FROM saves WHERE id = ?` e la
discriminazione del 404 tramite `changes`. Nessuna transazione, nessun cascade,
nessuna scrittura su `games`, `game_regions`, `game_operational_objects`: cancellare
un salvataggio non tocca la partita attiva né lo stato di gioco.

## 2. Protezione dei salvataggi riservati (fail-closed)

Nuovo modulo puro `backend-nest/src/game/SaveReservations.ts` — **una sola
nozione** di «riservato», riusata da due percorsi:

```
RESERVED_SAVE_NAMES = ['__rewind__', '__n__']
RESERVED_SAVE_NAME_PATTERN = /^__.+__$/
isReservedSaveName(name) // '' e nomi assenti = riservati
```

- **cancellazione** (`saves.routes.ts`): un record con nome `__…__` è rifiutato
  con `403 reserved_save` **anche se la richiesta arriva a mano** — la riga resta
  nel DB. Il rewind della partita non può essere rotto da una `DELETE`.
- **creazione** (`routes/games/save.routes.ts`, `POST /:id/save`): un nome
  `__…__` è rifiutato con **400** `{ code: 'reserved_save_name' }`, così un utente
  non può creare una riga indistinguibile da uno snapshot interno (che sarebbe
  poi non cancellabile). La guardia è **prima** del lookup di sessione: risponde
  400 anche senza partita caricata.

Nessun elenco da mantenere a mano: un futuro snapshot interno con nome `__…__` è
già protetto dal pattern.

## 3. API frontend

`frontend/src/services/api.ts` → `savesApi.remove`:

```ts
remove: (saveId: string): Promise<{ ok: boolean; deleted: string }> =>
  fetchApi(`/saves/${encodeURIComponent(saveId)}`, { method: 'DELETE' })
```

Stesso stile di `savesApi.list`/`gameApi`. Nessuna eccezione lato client: gli
errori del backend (403/404/500) salgono come `ApiError` e la UI li traduce.

## 4. UI: eliminazione con conferma

`frontend/src/components/Game/SavePickerModal.tsx`:

- `SavePickerList` (presentazione, esportata per i test): per ogni salvataggio
  dell'utente una **riga** con la selezione (comportamento invariato) e il
  pulsante **«Elimina»**; gli snapshot riservati non hanno pulsante (doppia
  difesa: sono già filtrati da `visibleSaves`).
- **Conferma esplicita**: il clic su «Elimina» apre una modale di conferma
  (`AccessibleDialog` annidata, «Eliminare il salvataggio?» con nome, mossa e
  data) — **nulla** parte al primo clic. Mentre la conferma è aperta, `Esc` e il
  clic sullo sfondo appartengono alla conferma: il picker non si chiude sotto.
- **Stato occupato**: durante la chiamata la riga è `aria-busy`, i pulsanti
  (selezione, «Elimina», conferma, «Annulla») sono disabilitati, l'etichetta
  diventa «Eliminazione…».
- **Successo**: l'item viene rimosso **dopo** la risposta del backend (nessuna
  rimozione ottimistica: il test confronta gli indici di `await savesApi.remove`
  e di `removeSaveFromList`), compare l'esito
  «Salvataggio “…” eliminato.» (`role="status"`) e non si ricarica la modale.
- **Errore**: messaggio «Impossibile eliminare il salvataggio. Riprova.»
  (`role="alert"`), l'item **resta**. Su `403` il messaggio è specifico
  («Salvataggio riservato: non cancellabile.»).
- Coerenza in creazione: `SaveGameModal` blocca i nomi riservati
  (`saveNameProblem`, hint `role="alert"`, `aria-invalid`, «Salva» disabilitato).
  La regola client vive in `frontend/src/components/Game/reservedSaves.ts`,
  specchio di quella backend (il backend resta l'autorità).

### Accessibilità

- `<button>` reali (`type="button"`), mai `div` cliccabili.
- `aria-label` semantico che **inizia** con la parola visibile:
  `Elimina il salvataggio “Partita 15/09/2026”` (WCAG 2.5.3 «Label in Name»).
- Conferma con focus gestito da `AccessibleDialog`: focus iniziale su **Annulla**
  (scelta sicura) e ripristino del focus sul pulsante «Elimina» alla chiusura.
- Messaggi annunciati: `role="status"` per l'esito, `role="alert"` per l'errore.
- Target di tocco: 44 px (48 px con `pointer: coarse`), `:focus-visible` con
  outline dedicato (`.save-picker-delete`, `.save-delete-*`).

## 5. Test

| Test | Copertura |
|---|---|
| `backend-nest/tests/saves-delete.test.ts` (**8**) | regola `isReservedSaveName`; `DELETE` su save esistente → 200 + riga rimossa; secondo `DELETE` → 404; id inesistente → 404; `__rewind__` → **403 fail-closed** con riga ancora presente; `__n__` → 403; **cancellare un salvataggio non tocca `games`/`game_regions`/`game_operational_objects`** (impronta sha256 del contenuto, non solo i conteggi); creazione con nome riservato → 400 `reserved_save_name` |
| `frontend/src/components/Game/savePickerDelete.test.tsx` (**10**) | regola riservati; elenco visibile filtrato e ordinato; rimozione locale selettiva; etichetta/conferma/esito; `SavePickerList` con pulsante e `aria-label`, **senza** pulsante per il riservato, riga occupata durante l'eliminazione; il clic chiede la conferma e **non** chiama il backend; la conferma è una modale dedicata con focus su «Annulla»; nessuna rimozione ottimistica; nessuna modifica della lista in errore |
| `frontend/src/components/Game/saveGameModalReserved.test.tsx` (**2**) | `saveNameProblem` (riservato/normale/vuoto) e blocco della creazione nella modale |
| `frontend/src/services/savesApiDelete.test.ts` (**3**) | `DELETE /api/saves/<id>`, id codificato (`a/b c` → `a%2Fb%20c`), propagazione del 403 |
| `e2e/tests/saves-delete.spec.mjs` (**5**, mock) | elenco senza rewind; primo clic = conferma, `deletes === []`; conferma → `DELETE` reale + item rimosso + esito; errore 500 → item presente + `role="alert"`; elenco «sporco» con solo rewind → nessun pulsante di eliminazione |

## 6. Gate

| Gate | Esito |
|---|---|
| `backend: npx tsc --noEmit` | ✅ |
| `backend: npx vitest run` | ✅ **168 file / 1758 test** (+8) |
| `backend: npm run build` | ✅ |
| `frontend: npx tsc --noEmit` | ✅ |
| `frontend: npx vitest run` | ✅ **79 file / 646 test** (+16) |
| `frontend: npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **141/141** (+5) |
| `npm run test:a11y` | ✅ 3/3 |
| `npm run test:perf` | ✅ 2.24 MB |

## 7. Limiti residui

1. **Salvataggi orfani** (`game_id` di una partita non più esistente): restano
   nell'elenco perché la `GET /api/saves` non fa join con `games`; con questo
   lavoro **diventano cancellabili** dalla UI, che è il rimedio naturale. La FK
   `saves.game_id → games(id) ON DELETE CASCADE` è attiva (`PRAGMA foreign_keys = ON`)
   e scatta solo se la riga `games` viene rimossa davvero: nessun endpoint lo fa,
   quindi gli orfani si creano solo per intervento esterno sul DB.
2. **Nessuna cancellazione multipla / «svuota archivio»**: una riga per volta, con
   conferma. Scelta deliberata per un'azione distruttiva.
3. **Nessun undo**: la cancellazione è definitiva (nessun cestino, nessuno
   snapshot preventivo). Il salvataggio è un dato utente, non uno stato di gioco:
   il motore non ne ha bisogno.
4. **`saves` non distingue** un salvataggio dell'utente da uno snapshot interno
   per schema: la distinzione è la convenzione sul nome (`__…__`). È la stessa
   che il motore già usa; il pattern rende la regola generale anziché un elenco.
5. **Nomi riservati digitati dall'utente**: ora rifiutati (400 + blocco UI). Resta
   il caso di un salvataggio storico creato **prima** di questa modifica con un
   nome `__…__`: non è cancellabile dalla UI (per scelta fail-closed) e va
   eventualmente rinominato a mano sul DB.
6. **`DELETE` non notifica la Timeline**: la cancellazione non genera un evento di
   gioco (è un'operazione d'archivio, non di mondo).

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

---

# DELETE SAVES HOME — eliminazione dalla Landing

Base: `main = 5098f8f` (DELETE SAVES mergiata). Branch: `feat/delete-saves-home`.
Nessuna nuova API, nessuna migrazione, **nessuna modifica al backend**: `DELETE
/api/saves/:id` e la protezione dei riservati esistono già e non sono toccati.
Nessun intervento su motore/rewind/schema/playback/branching/checkpoint, MAP
P1–P6, MILITARY P4–P6, né sulla parte selezione/caricamento del picker.

## 1. Il problema

I salvataggi si vedono soprattutto dalla **home** (sezione «📂 Continua
partita»), ma lì la cancellazione non c'era: bisognava avviare una partita →
⚙ → 📂 Carica. La feature esisteva, la superficie principale no.

## 2. Dove è stato aggiunto

`frontend/src/components/Game/Landing.tsx`:

- ogni card di `LandingSavesGrid` (componente di presentazione, esportato) ha ora
  **«Elimina»** accanto a **«▶ Gioca»**:
  `class="save-picker-delete landing-save-delete"` (`data-landing-save-delete`,
  `aria-label={saveDeleteLabel(save)}`), `disabled` quando la card è occupata con
  etichetta «Eliminazione…»;
- l'elenco della home usa lo stesso filtro dell'archivio
  (`visibleSaves(data?.saves)`): prima escludeva a mano solo `__rewind__`, ora
  esclude **tutti** gli snapshot interni del motore e ordina dal più recente;
- l'esito dell'eliminazione (`landing-save-status ok/error`, `role="status"` /
  `role="alert"`) sta **fuori** dalla sezione: se si cancella l'ultimo
  salvataggio la sezione sparisce, ma la conferma resta visibile (comportamento
  trovato mancante dalla E2E a backend reale, non dai test unitari);
- dopo una cancellazione riuscita la card sparisce **senza refetch**: la lista
  locale è aggiornata con `removeSaveFromList`, quindi anche il pulsante
  «Continua» sopra la piega passa da sé al salvataggio precedente.

CSS (`frontend/src/index.css`): la resa visiva del pulsante è **quella già
esistente** (`.save-picker-delete`, incluso il target 48 px su `pointer: coarse`
e `:focus-visible`); `.landing-save-delete` aggiunge solo il layout nella card
(larghezza piena sotto «▶ Gioca») e `.landing-save-status` dà colore ai messaggi.

## 3. Un solo meccanismo (nessuna duplicazione)

Il percorso distruttivo del picker è stato **estratto** in due moduli condivisi,
e ora entrambe le superfici usano gli stessi:

| Modulo | Contenuto |
|---|---|
| `Game/saveDeletion.ts` | helper puri (`visibleSaves`, `removeSaveFromList`, `saveTitle`, `saveDeleteLabel`, `saveDeleteConfirmText`, `saveDeletedNotice`, `DELETE_SAVE_ERROR`, `DELETE_SAVE_RESERVED_ERROR`), `deleteSave(saveId, remove?)` (una sola chiamata, esito tradotto: `403 → DELETE_SAVE_RESERVED_ERROR`, altrimenti errore generico) e l'hook `useSaveDeletion(onDeleted)` |
| `Game/SaveDeleteConfirmDialog.tsx` | il dialogo di conferma (`Eliminare il salvataggio?`, focus iniziale su **Annulla**, `data-save-delete-target`, entrambi i pulsanti disabilitati durante l'operazione) |

`SavePickerModal.tsx` ora **delega** (`useSaveDeletion` +
`<SaveDeleteConfirmDialog>`) e **ri-esporta** gli helper dai nomi precedenti, così
gli import storici (`SaveSummary`) continuano a funzionare. La cancellazione —
`DELETE` e traduzione degli errori inclusi — esiste in un punto solo: né la home
né il picker contengono `savesApi.remove`, e nessuna delle due reimplementa il
dialogo.

Garanzie del meccanismo, invariate e valide per entrambe le superfici:

- `request(save)` **non cancella**: apre solo la conferma (e ignora gli snapshot
  interni e le voci senza id);
- `confirm()` chiama `deleteSave` e invoca `onDeleted(save)` **dopo** la risposta
  del backend: nessuna rimozione ottimistica;
- in errore `onDeleted` non viene mai invocato: la card/riga resta e si mostra il
  messaggio.

## 4. Doppia difesa dei riservati

1. **Presentazione**: `visibleSaves` esclude gli `__…__` dalla home, e
   `LandingSavesGrid` non rende il pulsante se `isReservedSave(save)` è vero
   (stessa difesa in `SavePickerList`);
2. **Backend** (già in produzione): `DELETE /api/saves/:id` risponde
   `403 reserved_save` anche su richiesta costruita a mano. La E2E reale lo
   verifica sul lato creazione (`POST /games/:id/save` con nome `__rewind__` →
   `400 reserved_save_name`).

## 5. Accessibilità

`<button type="button">` reali (mai `div` cliccabili) · `aria-label` semantico
che inizia con la parola visibile («Elimina il salvataggio “…”», WCAG 2.5.3) ·
`aria-busy` sulla card durante l'operazione, azioni disabilitate · dialog di
conferma con focus iniziale su **Annulla**, focus ripristinato alla chiusura e
`Esc`/backdrop che non chiudono durante l'operazione (`AccessibleDialog`) ·
esiti annunciati (`role="status"`/`role="alert"`) · target 44 px (48 px su touch)
e `:focus-visible` ereditati da `.save-picker-delete`.

## 6. Test

| Test | Copertura |
|---|---|
| `frontend/src/components/Game/landingDeleteSave.test.tsx` (**9**) | elenco della home senza snapshot interni; card con «Elimina» + `aria-label` + stile condiviso; riservato **senza** pulsante; card occupata con azioni disabilitate e l'altra libera; `deleteSave` successo/500/403 (messaggi, una sola chiamata, nessuna rimozione in errore); rimozione locale selettiva e messaggio di esito; la home delega (`useSaveDeletion`, `SaveDeleteConfirmDialog`, `visibleSaves`) e **non** contiene `savesApi.remove` né il testo della conferma |
| `frontend/src/components/Game/saveDeleteConfirmDialog.test.tsx` (**5**) | dialog chiuso con `save===null`; focus iniziale su Annulla; `disabled`/`closeOnBackdrop`/`closeOnEscape` durante l'operazione; non conosce l'API (`onCancel`/`onConfirm` soltanto); home **e** picker importano e usano lo stesso dialog, e nessuna delle due lo reimplementa |
| `frontend/src/components/Game/savePickerDelete.test.tsx` (**11**, aggiornato) | le garanzie restano ma puntano al punto unico: il picker delega, il dialogo vive in `SaveDeleteConfirmDialog.tsx`, l'ordine «DELETE → `onDeleted`» è verificato in `saveDeletion.ts` (e il ramo d'errore non tocca la lista) |
| `e2e/tests/saves-delete.spec.mjs` (**8**, mock: 5 archivio + 3 home) | home: nessuna DELETE al primo clic, Annulla non cancella, conferma → DELETE reale + card rimossa + esito, il pulsante «Continua» passa al salvataggio precedente, nessuna partita avviata; errore 500 → card presente + alert; elenco «sporco» con solo rewind → non compare e non è cancellabile; **cancellando anche l'ultimo salvataggio la sezione sparisce ma l'esito resta annunciato** |
| `e2e/tests/saves-delete-home.real.spec.mjs` (**1**, backend reale) | percorso utente completo contro il backend vero: scenario provinciale → USA → mondo generato (job+polling) → `POST /games` → ⚙ 💾 Salva (`POST /games/:id/save`) → ritorno alla home → card con «Elimina» → conferma → `DELETE /api/saves/:id` → **`GET /api/saves` non contiene più il salvataggio** → seconda `DELETE` → **404** reale → `GET /api/games/:id` con lo **stesso `currentTurn`** (la partita è intatta); in più `POST /games/:id/save` con `__rewind__` → **400 `reserved_save_name`**. Nessun mock di `/api/saves`; l'unica finzione è il provider LLM (stub) |
| `frontend/src/components/Game/landingPromise.test.ts` (aggiornato) | la promessa «la home non mostra gli snapshot di rewind» è ora verificata sul filtro unico (`visibleSaves`) invece che sulla stringa `s.name !== '__rewind__'` |

## 7. Gate

| Gate | Esito |
|---|---|
| `frontend: npx tsc --noEmit` | ✅ |
| `frontend: npx vitest run` | ✅ **81 file / 660 test** (+2 file / +14 test) |
| `frontend: npm run build` | ✅ |
| `backend: npx tsc --noEmit` | ✅ |
| `backend: npx vitest run` | ✅ **168 file / 1758 test** (invariati: nessuna modifica backend) |
| `backend: npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **144/144** (+3) |
| `npm run test:e2e:real` | ✅ 1/1 (`saves-delete-home.real.spec.mjs`, 2,1 min, DB fresco) |
| `npm run test:a11y` | ✅ 3/3 |
| `npm run test:perf` | ✅ **2,25 MB** (baseline rispettata) |

## 8. Limiti residui

1. **Nessuna cancellazione multipla dalla home**: una card per volta, con
   conferma (come nell'archivio).
2. **Nessun undo**: la cancellazione è definitiva; l'esito è annunciato ma non
   reversibile (nessun cestino). Vale anche per la home.
3. Se il **fetch iniziale** dei salvataggi fallisce, la home non mostra la
   sezione (comportamento preesistente, invariato): nessun errore esplicito in
   home, a differenza dell'archivio che lo mostra nella modale.
4. Restano validi i limiti della feature base (orfani cancellabili dalla UI,
   nessun «svuota archivio», salvataggi storici con nome `__…__` non
   cancellabili se non a mano sul DB, `DELETE` senza evento di Timeline).
5. La card della home mostra «Elimina» anche su un salvataggio di **un'altra
   partita** (come già faceva l'archivio): è intenzionale — è l'archivio, non la
   partita corrente.
6. Il percorso distruttivo **non** è coperto da test di interazione DOM nel
   frontend (il progetto non ha jsdom/testing-library): il comportamento è
   provato con funzioni pure + asserzioni di sorgente + E2E (mock e reale). La
   E2E reale è la prova end-to-end che il DB cambia davvero.

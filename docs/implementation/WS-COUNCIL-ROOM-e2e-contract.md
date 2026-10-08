# Sala del Consiglio — contratto E2E per la migrazione delle spec

Il modulo Governo è stato riprogettato: da colloquio 1:1 con un ministro a
**seduta condivisa** del Consiglio. Le spec E2E della vecchia UI a due pannelli
vanno migrate alla nuova, **preservando l'intento comportamentale** di ciascuna.

Regola generale: non si cancellano garanzie. Se una verifica non è più
rappresentabile nella nuova UI, si asserisce l'equivalente nuovo più vicino e si
adatta il nome del test. Non si modificano i componenti frontend né il motore:
si migrano le **spec** (e, se serve, si aggiungono route mock locali alla spec).

## Come eseguire una spec

```bash
cd "e2e"
npx playwright test -c playwright.config.mjs tests/NOME.spec.mjs
```

Il dev server Vite viene avviato dal `webServer` del config. Un test alla volta
con `--grep`. I mock sono in `e2e/mock-api.mjs` (`installMockApi(page, opts)`).

## Helper condiviso

`e2e/tests/helpers/government.mjs` centralizza il percorso. Usare sempre:

- `reachHud(page)` — landing → HUD. **Chiamarla dopo `installMockApi`** e prima
  di aprire il Governo (l'helper non naviga da sé).
- `openGovernment(page)` — rail «Governo» → `.government-office`.
- `openCouncilRoom(page, seat)` / `openCouncilRoomByLabel(page, label)` — apre la
  seduta con quella sedia come **relatore**; attende `.council-room`.
- `composer(page)`, `thread(page)`, `replies(page)`, `presidentMessages(page)`.
- `send(page, text, { seat })`, `ask(page, text)`, `askRound(page, text, { replies })`,
  `waitIdle(page)`, `interrupt(page)`.
- `openBoard(page)` / `closeBoard(page)` / `boardIsOpen(page)`.
- `measures(page)` — `.council-board-measure`.
- `convene(page, seat)` — convocazione esplicita dal foglio «Convoca».
- `conveneFromInvitation(page, seat)` — convoca da un invito in linea.
- `prepareCommonDraft(page)` — «Prepara bozza comune» → `.act-draft`.
- `waitSignEnabled(page)`, `sign(page)`.
- `backToPicker(page)`.
- `participants(page)`, `threadText(page)`, `seatLabel(seat)`.

## Nuova UI — selettori stabili

Scelta (`.government-office`):
- registro: `.order-register`, `.order-register-act`, `.order-register-withdraw`,
  `.order-register-signature-office`, testo «Nessun atto firmato».
- agenda: `.council-agenda-summary`, `.cabinet-pick.cabinet-pick-alive[data-seat]`
  con `data-state` (`disponibile` / `discussione-aperta` / `richiede-attenzione`
  / `in-attesa-di-decisione`), `.cabinet-pick-alive-name`, testo «Riprendi il
  colloquio · N scambi».
- `.cabinet-pick[data-seat]` (anche per le schede senza agenda).
- sedute riprendibili: `.council-room-resume`.

Seduta (`.council-room`, `[data-room-id]`, `[data-board-open]`):
- intestazione: `.council-room-back` («← Governo»), `#government-office-title`
  «Seduta del Consiglio», `.council-room-topic`, `.council-room-rapporteur`,
  `.council-room-close` (aria «Chiudi il Governo»).
- partecipanti: `.council-room-participants`, `.council-room-chip[data-seat]`,
  `.council-room-convene` («+ Convoca»).
- filo: `.council-room-thread`; messaggi `.council-room-message.user` /
  `.council-room-message.assistant` (streaming: `.council-room-stream`);
  `.council-room-speaker`, `.council-room-prose`; eventi `.council-room-event`.
- inviti: `.council-room-invitation` con pulsante «Convoca …».
- evidenza in linea: `.council-room-evidence-link` («Apri … sulla Tavola ↗»).
- composer: `.council-room-compose`, `#council-recipient` (select),
  `textarea[aria-label="Messaggio del Presidente"]`, pulsanti «Invia»/«Interrompi».
- badge non letti: `.council-room-unread` («↓ Nuovo messaggio»).
- barra: `.council-room-summary`, `.council-room-board-toggle` («Tavola ↑/↓»),
  `.council-room-conclude` («Chiudi seduta»).
- errore: `.council-room-error`; avviso: `.council-room-notice`.

Tavola (`.council-room-board`; su desktop dentro `.council-room-drawer`, su
mobile dentro il bottom sheet `role=dialog` nome «Tavola del Consiglio»):
- sezioni `.council-board-section` con h3: `QUESTIONE`, `PROPOSTA ATTUALE`,
  `ACCORDI DICHIARATI`, `QUESTIONI APERTE`, `POSIZIONI`.
- misure: `.council-board-measure[data-status][data-source]`,
  `.council-board-measure-label`, `.council-board-measure-value`,
  `.council-board-provenance`, pulsante `.council-board-exclude` («Escludi»).
  `data-status`: `proposed|accepted|rejected|unresolved`;
  `data-source`: `minister|president|engine`.
- posizioni: `.council-board-position[data-seat][data-status][data-stale]`.
- inviti: `.council-board-invitation[data-minister]`, `.council-board-convene`.
- azioni: `.council-board-confirm` («Conferma proposta»),
  `.council-board-prepare` («Prepara bozza comune», con `aria-describedby` di
  `.council-board-action-reason` quando disabilitato),
  avvisi `.council-board-warning`.
- evidenza focalizzata: `.council-board-focus-evidence` + `[data-block-id]`.
- fascicoli: `<details class="council-board-evidence">` con `.council-board-dossier`.

Bozza d'atto (`ActDraftPanel`): `.act-draft[data-state]`, `.act-draft-capability`,
`.act-draft-text`, `.act-draft-state`, `.act-draft-sign`, `.act-draft-cancel`,
`.act-draft-edit-toggle` (solo mobile), `.act-draft-text-view` (mobile),
`.consequence-board` (con `.consequence-group[data-group]`,
`.consequence-not-estimable`, `.consequence-refresh`).

## Percorsi canonici

**Aprire una seduta:** `reachHud` → `openCouncilRoom(page, 'tesoro')`. Il saluto
del relatore arriva come primo `.council-room-message.assistant` (testo
`address.opening`, es. «La cassa regge, ma il margine si assottiglia.»).

**Chiedere qualcosa:** `ask(page, 'testo')` invia al Consiglio; di norma parla il
relatore. Con più partecipanti il round interessa tutti: usare `askRound`.

**Ottenere una misura:** il mock risponde con un blocco `decision` in base al
testo (vedi sotto). La misura entra come **proposta del ministro** (`minister` /
`proposed`): il client non si fida di un modello che si dichiara «presidente».
Per concordarla serve l'atto esplicito del Presidente: pulsante «Conferma
proposta» (`.council-board-confirm`) sulla Tavola.

**Preparare e firmare l'atto:** la Tavola deve avere almeno una misura
`proposed|accepted` → `.council-board-prepare` («Prepara bozza comune») apre un
breve giro di redazione con tutti i partecipanti e produce `.act-draft`. La firma
`.act-draft-sign` è abilitata solo dopo la verifica del motore (`check-feasibility`)
e se la bozza è supportata. Firmare accoda via `actions/queue` (idempotente).

**Chiudere:** `.council-room-conclude` («Chiudi seduta») archivia la seduta e
torna alla scelta. `.council-room-back` torna alla scelta lasciando la seduta
riprendibile (`.council-room-resume`). Chiudere l'Ufficio e riaprirlo **riprende
la seduta attiva**.

**Turno:** avanzando il turno la seduta riparte da zero (nessuna misura, nessuna
bozza) e la discussione precedente diventa memoria. La memoria non ha una UI
dedicata: si verifica **sul filo** (`memory` nel body POST di
`government/minister/:seat/stream`).

## Comportamento del mock (`e2e/mock-api.mjs`)

`POST government/minister/:seat` risponde in base al testo del messaggio
(prima corrispondenza vince, in quest'ordine):
- `90` → misure Infrastrutture 90 / Debito 10 (`source: president`).
- `80` → Infrastrutture 80 / Debito 20.
- `avanzo` o `useresti` → Infrastrutture 70 / Debito 30 + domanda «ripartizione».
- `infrastruttur` → obiettivo «Investire l’avanzo nelle infrastrutture».
- `orientali` → obiettivo + misure «Province orientali» 60 / Debito 40.
- `fabbrica` o `siderurgic` → obiettivo «Costruire una fabbrica siderurgica» +
  misura `work` «Fabbrica siderurgica» + domanda «localizzazione».
- `sarajevo` → misura `region` «Sarajevo» + vincolo «acciaio mancante» +
  risolve «localizzazione».
- `copertura` o `finanziar` → misura `target` «Copertura finanziaria» 2,00 mld.
- `materiali` → misura `work` «Materiali del cantiere».
- `confronta` → blocco `tavola` `{"op":"compare"}`.
- `spesa` → blocco `tavola` `{"op":"focus","evidence":"spesa"}`.
- `province` o `mappa` → `{"op":"focus","evidence":"mappa","regionIds":["ALPHA"]}`.
Altrimenti: «Il ministro (seat) ha preso nota del problema.»

`GET/POST actions/queue` gestisce coda e idempotenza; `actions/check-feasibility`
restituisce costi (12,40 mld) e, se il testo contiene
`fabbrica|siderurgic|acciaieria|costru|infrastruttur`, una `workDeclaration`
(`work-fabbrica`), **scoperta** se il testo contiene `manc|insufficient|scopert`.
La regione canonica `SARAJEVO` esiste nel mock: un atto che nomina «Sarajevo»
risolve il luogo.

Lo `/stream` ministeriale risponde **404** di proposito: `askStream` ripiega sul
POST normale. Le spec che vogliono controllare lo streaming devono intercettare
`**/government/minister/*/stream` da sé.

## Adattamenti semantici obbligatori

1. **Nessuna fonte «presidente» dal modello.** Le misure che il mock etichetta
   `president` vengono declassate a `minister`/`proposed`: per renderle
   concordate usare «Conferma proposta».
2. **Memoria senza UI.** Verificare la memoria sul body della richiesta
   successiva (`memory`), non su un pannello.
3. **Niente tab mobile, niente due pannelli.** La Tavola è un drawer/sheet: si
   apre con `.council-room-board-toggle`.
4. **Niente `.minister-chat`, `.minister-compose`, `.gov-mobile-*`,
   `.seat-table`, `.decision-board`, `.treasury-act-*`, `.cabinet-nothing`,
   `.minister-evidence-card`, `.seat-brief-memory`.** Usare gli equivalenti sopra.
5. **«Nulla di fatto»** non esiste più: la seduta si chiude con «Chiudi seduta»,
   che archivia senza accodare. Verificare che il registro resti vuoto.
6. **Evidenza in linea** = `.council-room-evidence-link` che apre la Tavola e
   mostra `.council-board-focus-evidence [data-block-id]`.
7. **Screenshot**: se la spec salva screenshot nei report, aggiornare i selettori
   ma mantenere i percorsi solo se le cartelle esistono; altrimenti rimuovere lo
   screenshot (non è un'asserzione).

## Verifica finale richiesta

- La spec migrata passa: `npx playwright test -c playwright.config.mjs tests/NOME.spec.mjs`.
- Nessuna modifica a `frontend/` o `backend-nest/`.
- Riportare: file toccati, test passati, e ogni intento che non era
  rappresentabile con la motivazione.

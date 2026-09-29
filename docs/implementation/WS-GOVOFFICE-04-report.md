# WS-GOVOFFICE-04 — Il layout mobile dell'Ufficio del Governo

**Base**: `main` = `833fef9` (merge PR #138) · **Branch**: `feat/ws-govoffice-04-mobile`
**Perimetro**: solo presentazione (CSS/layout della schermata *Ufficio del Governo* su
viewport stretto). Nessuna modifica al motore.

Il difetto è stato **riprodotto prima di modificare** a `390×844` (dev server locale
sullo stesso bundle `833fef9`) e misurato con l'harness di diagnostica: i pannelli si
accavallavano davvero. Tutte le prove «prima/dopo» sono in
`docs/implementation/assets/ws-govoffice-04/`.

---

## 1. Problemi trovati (causa reale)

### 1.1 La seduta a due pannelli non collassava e veniva compressa dal flex
- `.government-office` è il modale con classi `suggestions-content government-office`:
  eredita `display: flex; flex-direction: column` da `.suggestions-content`
  (`frontend/src/index.css:3481`).
- `.government-office-split` (`frontend/src/editorial.css:1279`) è un **figlio flex**
  (`flex: 0 1 auto`, il default) con `min-height: 0`, e la media query mobile
  (`@media (max-width: 767px)`, `frontend/src/editorial.css:1467`) non lo mandava a
  colonna singola: restava la griglia a due colonne.
- Su mobile i pannelli avevano `min-height: 0; max-height: none; overflow-y: visible`:
  l'altezza residua del modale (`height: 94dvh`) veniva **divisa** fra le due righe
  della griglia. Le righe risultavano compresse a ~`310 px` mentre il contenuto era
  `699 px` / `747 px` → i pannelli **sbordavano** uno sull'altro e sul piede.

Misure a 390 px **prima** della correzione (da `/tmp/g04-before-390.json`):

| Elemento | Altezza contenuto | Riga griglia |
|---|---|---|
| `.government-office-pane-chat` | 699 px | 310.67 px |
| `.government-office-pane-dossier` | 747 px | 310.69 px |

Sovrapposizioni rilevate (`overlaps`): `chatPane × dossierPane` (oy 374),
`chatPane × footer` (oy 49), `dossierPane × footer` (oy 115).

### 1.2 Titolo della sedia ripetuto (doppio render)
La stessa etichetta compariva in **tre** punti, resi contemporaneamente:
- `.council-title` (`h2#government-office-title`, che è anche l'etichetta del dialogo) —
  l'unico titolo legittimo della schermata;
- `.cabinet-seat-name` dentro `CabinetSession variant="full" onlySeat` (la testata della
  scheda-seduta, `frontend/src/components/Game/CabinetSession.tsx`);
- `.minister-name` dentro `MinisterChat` (testata della chat);
- `.minister-dossier-name` dentro `MinisterDossier` (testata del pannello dati,
  `frontend/src/components/Game/MinisterDossier.tsx`).

A 390 px l'harness contava **3 intestazioni visibili** con lo stesso testo
(`headingCount: 3`).

### 1.3 «Chiudi ufficio» fuori dal proprio blocco
`.suggestions-footer` (`frontend/src/index.css:3748`) è una riga `flex-wrap`;
`.btn-submit-actions` (`frontend/src/index.css:3760`) ha `width: auto`. A 390 px il
pulsante restava largo `111 px` mentre il contenuto scorreva sotto/sopra → copriva la
fascia «…NAZIONALE…» e parte del pannello.

### 1.4 «INVIA» è un pulsante legittimo (non un residuo)
Il pulsante in basso **non** è un residuo del compositore libero rimosso in
WS-GOVOFFICE-03: è il pulsante di invio di `MinisterChat`
(`.minister-compose button`, `frontend/src/components/Game/MinisterChat.tsx`). Il
compositore libero (`ActionsPanel` / `#free-player-order`) **non è renderizzato** da
nessuna parte. Il pulsante è quindi **mantenuto**: è stato solo vincolato al proprio
blocco (l'input cede spazio, il pulsante non va a capo), come già fatto per «Ritira».

### 1.5 Il registro non era tagliato nel markup
La prima schermata (registro + riquadri dei ministri) era **già leggibile** a 390 px:
l'OCR di `before-390-1-schermata1.png` mostra «Registro degli atti» integro. Il taglio
segnalato dipendeva dalla sovrapposizione del modale, non da un titolo troncato: si
risolve con la 1.1.

---

## 2. Correzioni applicate

Tutte in `frontend/src/editorial.css`, **derivate** dal precedente `.action-desk`
(`frontend/src/editorial.css:487-489`). Nessun nuovo sistema di layout, nessun
`!important`.

### 2.1 Nel blocco `@media (max-width: 767px)` (`frontend/src/editorial.css:1467`)
```css
.government-office-split { grid-template-columns: minmax(0, 1fr); flex: 0 0 auto; min-height: auto; }
.government-office-pane { max-height: none; overflow-y: visible; min-height: auto; }
.government-office-pane-dossier { position: static; }
.minister-dossier-name { display: none; }
.minister-name { display: none; }
.cabinet-seat-name { display: none; }
.government-office .suggestions-footer { flex-direction: column; align-items: stretch; }
.government-office .btn-submit-actions { width: 100%; }
.government-office { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
```
- `flex: 0 0 auto` sullo split: non viene più schiacciato per far posto al piede; a
  scorrere è il modale. Le righe della griglia tornano all'altezza del contenuto
  (`678.67 px` / `726.45 px`), quindi niente più overlap.
- I pannelli rilasciano limiti/scroll interne e il pannello dati perde lo `sticky`.
- **Una sola** intestazione visibile: le tre copie (chat, pannello dati, testata
  scheda) si spengono; resta `.council-title`. La copia della scheda-seduta resta nel
  markup (serve all'`aria-labelledby` della sezione) ma è nascosta visivamente.
- Il piede si impila e «Chiudi ufficio» prende tutta la larghezza **dentro** il proprio
  blocco (`closeBtnInsideFooter: true`).

### 2.2 Irrobustimento del compositore del ministro (regole base, valide a ogni viewport)
```css
.minister-compose input    { min-width: 0; }
.minister-compose textarea { min-width: 0; }
.minister-compose button   { flex: 0 0 auto; white-space: nowrap; }
```
Stesso criterio del pulsante «Ritira» (`OrderRegister`): il testo cedevole cede, il
pulsante resta su una riga. A desktop è un no-op (verificato: PNG identici prima/dopo).

### 2.3 Classificazione A/B/C/D/E
- **A** — CSS/layout della schermata (`editorial.css`): è il cuore della correzione.
- **B** — harness visivo `e2e/govoffice-shot.mjs` reso parametrico sul viewport: non
  tocca il gioco, serve solo a fotografare anche a 390 px.
- **C** — test mirati (`governmentOfficeMobile.test.tsx`).
- **D** — questo report + gli screenshot.
- **E** — *nessuna*. Nessuna migrazione, nessun tocco al freeze.

---

## 3. File modificati

| File | Tipo |
|---|---|
| `frontend/src/editorial.css` | modifica (blocco mobile + compositore) |
| `e2e/govoffice-shot.mjs` | modifica (parametro viewport `[larghezza] [altezza]`, default 1440×960) |
| `frontend/src/components/Game/governmentOfficeMobile.test.tsx` | nuovo (test mirati) |
| `docs/implementation/WS-GOVOFFICE-04-report.md` | nuovo (questo documento) |
| `docs/implementation/assets/ws-govoffice-04/*.png` | nuovi (prove visive prima/dopo) |

Nessun file di gioco, di motore, di schema o di backend è stato toccato.

---

## 4. Conferma CORE ENGINE FREEZE

**Il freeze è intatto.** Non sono stati toccati:
`backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, schema/database, repository, semantica
checkpoint/simulation run/`useSimulationPlayback`, pipeline di avanzamento del tempo.
Non è stato introdotto alcun motore nuovo e nessuna dipendenza frontend nuova. Non è
servita alcuna migrazione: **nessun blocco**.

---

## 5. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| `npm --prefix backend-nest test` | ✅ **200 file / 2083 test** passati |
| `cd frontend && ../node_modules/.bin/vitest run` | ✅ **105 file / 887 test** passati (880 + 7 nuovi) |
| `frontend: tsc --noEmit` | ✅ pulito |
| `backend-nest: tsc --noEmit` | ✅ pulito |
| `npm run build` (frontend + backend) | ✅ verde |
| `npm run test:e2e:mock` | ✅ 149 test passati (mock offline) |
| `npm run test:a11y` | ✅ passati |

Test flaky noti (`military-warfront-integrity.test.ts` #50,
`op-objects-time-step.test.ts` #42): **non si sono presentati** in questa esecuzione,
nessuna soglia è stata alzata o rilassata.

### Test mirati aggiunti — `governmentOfficeMobile.test.tsx` (7 test)
1. lo split mobile è a **colonna singola** (`grid-template-columns: minmax(0, 1fr)`) e
   non compresso (`flex: 0 0 auto`, `min-height: auto`);
2. i pannelli rilasciano `max-height`/`overflow-y` e il pannello dati non è `sticky`;
3. a ≤767 px le **tre copie** del titolo si spengono (`display: none`) **e** la stessa
   regola a desktop **non** nasconde nulla;
4. il piede si impila e «Chiudi ufficio» è a tutta larghezza;
5. il compositore cede spazio (`min-width: 0`) e «Invia» resta su una riga;
6. la seduta rende **una sola** `.cabinet-seat-name` nel markup (nessun doppio render);
7. il pannello dati rende **una sola** `.minister-dossier-name`.

I test leggono il CSS come sorgente (stesso pattern di `hudMobileLayout.test.ts` /
`ordersModuleTheme.test.ts`) e usano `renderToStaticMarkup` (stesso pattern di
`CabinetSession.test.tsx`): nessun framework nuovo, nessuno snapshot.

---

## 6. Risultati (compresa la verifica visiva a 390 px)

**La verifica è stata fatta a 390 px.** Ecco i numeri misurati dall'harness:

| Metrica | PRIMA (390 px) | DOPO (390 px) |
|---|---|---|
| Intestazioni visibili | 3 | **1** (`Ministro del Tesoro`, il solo `h2`) |
| Righe griglia split | 310.67 / 310.69 px | **678.67 / 726.45 px** (altezza contenuto) |
| Sovrapposizioni | 3 (`chat×dossier`, `chat×footer`, `dossier×footer`) | **0** |
| Overflow orizzontale | 0 | **0** |
| «Chiudi ufficio» dentro il piede | sì | sì |
| «Chiudi ufficio» a tutta larghezza | **no** (`111 px`) | **sì** (`338 px`) |
| Pulsante «Invia» dentro il compositore | sì | sì |

**Desktop 1440 px: nessuna regressione.** `before-1440-2-seduta.png` e
`after-1440-2-seduta.png` sono **byte-identici** (md5
`3728065160b6b4ca2ce8649a0381f0cc`); anche a 1440 px 0 sovrapposizioni e 3 intestazioni
(layout a due pannelli invariato).

**Tablet 768 px**: la media query mobile è `max-width: 767px`, quindi 768 px usa il
layout desktop a due pannelli. Misurato **0 sovrapposizioni**, 0 overflow: nessuna
regressione.

### Prova visiva — OCR prima/dopo (seduta, 390 px)
- **PRIMA** (`before-390-2-seduta.png`): testo accavallato e illeggibile —
  «…spende**vagni** mese.», «**Nelizum bato nel registro: conclaRa seduta**…», «chiudi
  ufficio» **in mezzo** al pannello dati.
- **DOPO** (`after-390-2-seduta.png`): righe separate e leggibili — una sola volta
  «Ministro del Tesoro», poi «CASSA, DEBITO E BILANCIO», «Signor Presidente, …»; il
  registro chiude in fondo con «Nulla di fatto — chiudi senza ordine» e «chiudi
  ufficio» contenuto.
- **Flusso completo anche a 390 px**: l'harness esteso completa l'intero percorso
  (registro vuoto → seduta → dialogo con «Invia» → firma dell'atto → registro firmato)
  a 390 px senza toccare il desktop.

### Artefatti (in `docs/implementation/assets/ws-govoffice-04/`)
- `before-390-{1-schermata1,2-seduta,3-seduta-fondo}.png` — difetto riprodotto;
- `after-390-{1-schermata1,2-seduta,3-seduta-fondo}.png` — correzione;
- `before-1440-*.png` / `after-1440-*.png` — prova di non regressione desktop;
- `after-768-*.png` — tablet;
- `harness-390-*.png` / `harness-1440-*.png` — i 4 stati prodotti da
  `e2e/govoffice-shot.mjs` ai due viewport.

---

## 7. Limiti residui

1. **Contenuto duplicato tra scheda-seduta e pannello dati** (per progetto, non è una
   regressione mobile): `CabinetSession variant="full" onlySeat` mostra apertura, item
   e cifre, mentre `MinisterDossier` ripete cifre e «Sul tavolo». Succede anche a
   desktop; su mobile allunga la pagina ma **non si accavalla più**. Ridurlo è una
   scelta di prodotto fuori dal perimetro «solo layout».
2. **Attribuzione dei messaggi**: `.entry-meta` continua a mostrare «MINISTRO DEL
   TESORO» come autore di ogni messaggio. È legittima (non è un titolo): il criterio
   «una sola intestazione» riguarda i titoli di pannello.
3. Lo **scroll mobile** è dell'intero modale (`.government-office`): è la scelta
   dichiarata dalla correzione (vedi commento in `editorial.css`), non un artefatto.
4. La soglia è fissata a `767 px`: tra 768 px e ~900 px il layout resta a due colonne
   (nessun overlap misurato), quindi non è stato toccato.

---

## 8. Proposte per la fase successiva

1. **Unificare la scheda-seduta e il pannello dati**: una sola superficie per apertura,
   item e cifre, così il mobile non ripete contenuto già presente altrove.
2. **Portare la misura degli overlap in CI**: `e2e/govoffice-shot.mjs` oggi fotografa;
   si può aggiungere (senza snapshot) un'asserzione geometrica sugli `overlaps` come
   per `hud-mobile.spec.mjs`, così il difetto non può tornare silenziosamente.
3. **Breakpoint tablet**: valutare una colonna singola anche fra 768 e ~900 px, dove la
   colonna dati (`minmax(320px, .9fr)`) è stretta.
4. Rendere esplicita, in un commento di `MinisterChat`, che «Invia» è il compositore
   *della chat del ministro* e non il compositore libero rimosso in WS-GOVOFFICE-03.

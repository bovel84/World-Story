# WS-GOVOFFICE-05 — Due sedie nuove, dialogo raccontato, pannello dati a scomparsa

**Base**: `main` = `a71f3fe` (merge PR #139) · **Branch**: `feat/ws-govoffice-05-cabinet`
**Perimetro**: governo (presentazione + agenda delle sedie). **CORE ENGINE FREEZE intatto**:
nessuna modifica a `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, schema/database, repository, semantica di
checkpoint/simulation-run/`useSimulationPlayback`, pipeline di avanzamento del tempo.

Lavoro svolto: (1) due sedie nuove — **Istruzione** e **Sanità** — che leggono un dato
del motore, con la regola *senza dato la sedia tace* e **senza riassegnare** le voci
esistenti; (2) il **pannello dati a scomparsa, chiuso di default**; (3) il **dialogo del
ministro più raccontato**, ma solo con dati del motore, con il rimando al **collega
giusto** per nome e competenza.

Le prove «prima/dopo» sono in `docs/implementation/assets/ws-govoffice-05/`.

---

## 1. Il dato: da dove viene, e perché è dichiarato una stima

### 1.1 Onestà del dato (il punto più delicato)
Il motore **non misura direttamente** la spesa per istruzione né per la sanità. In
`backend-nest/src/core/simulation/NationalBudget.ts`:
- `defenceBurdenPct` è **esatta**: la quota la dichiara il conto nazionale (`:119`,
  `:160`);
- `educationBurdenPct` e `socialBurdenPct` sono una **ripartizione** delle uscite civili
  sui pesi reali (`civilWeights`, `:130-141`): istruzione pesa `10 + atenei×2.6`,
  sanità `16 + √(popolazione_milioni)×4`, sostegno `12 + mobilitati×1.5`. Il dettaglio
  le converte in quota di PIL (`:159-162`).

Non sono quindi misure: sono **stime ripartite da grandezze misurate**. Le due sedie lo
dichiarano, e questo è il punto:
- ogni cifra di **quota di spesa** è etichettata `estimated` con il metodo esplicito
  («ripartizione delle uscite civili su …», vedi `GovernmentAgenda.ts:220`, `:561-570`,
  `:595-604`);
- ogni cifra di **grandezza diretta** (atenei, popolazione, stabilità, tensione sociale)
  è etichettata `measured` («conto nazionale»).

In UI questo appare come «stimato · ripartizione delle uscite civili su …» accanto ai
valori «misurato · conto nazionale», **nella stessa riga** (vedi §6.2). Il giocatore può
contestare la stima come stima, non scambiarla per un dato esatto.

### 1.2 Sanità = sanità **+ sostegno** (dichiarato, non taciuto)
`socialBurdenPct` è `(healthShare + socialShare) × 12 / gdp` (`NationalBudget.ts:161`):
è **sanità + sostegno sociale**, non la sola sanità. La competenza della sedia lo dice a
parole: `SEAT_READS.sanita = 'spesa sociale (sanità e sostegno), popolazione, stabilità'`
(`Cabinet.ts:52-54`), e la voce dell'agenda ricalca la dicitura nella `because` («sanità e
sostegno insieme, non la sola sanità»). Nessuno spaccia il dato per ciò che non è.

### 1.3 «Senza dato la sedia tace»
Il silenzio è implementato in tre punti coerenti, senza inventare nulla:
1. `GovernmentReadings.ts:289-293`: `education`/`health` vengono passati **solo** se
   `account && burdenPct > 0`;
2. `GovernmentAgenda.ts:560`, `:594`: la voce viene emessa **solo** se `input.education` /
   `input.health` esistono;
3. `Cabinet.ts`: una sedia compare **solo** se ha voci (`items`).

Quindi, come il Tesoro e la Guerra senza il loro conto, Istruzione e Sanità **non
compaiono** a vuoto. Il test `SENZA il dato, le due sedie TACCIONO` lo blocca.

### 1.4 Nessuna sedia in più di quelle chieste
- **Nessuna sedia Infrastrutture**: i Lavori la coprono già (`SEAT_READS.lavori`).
- **Nessuna sedia Ambiente**: il motore **non misura nulla di ambientale**; inventarne una
  sarebbe disonesto. Non esiste un campo ambientale nel conto nazionale.

---

## 2. Backend — le due sedie

### 2.1 `backend-nest/src/core/government/Cabinet.ts`
- `CABINET_SEATS` da 5 a **7**: `['tesoro','lavori','istruzione','sanita','esteri','interno','guerra']`
  (`:33`);
- `SEAT_LABEL` (`:36`) e `SEAT_READS` (`:47`) per le due sedie nuove — etichette e
  competenze **dichiarate**;
- `seatOfVoice` (`:82-83`): `education_condition → istruzione`, `health_condition → sanita`.
  I rami **preesistenti** (`deficit_*`, `build_*`, `faction_*`, `treasury_condition`,
  `debt_service`, `defence_condition`) restano identici: **nessuna voce riassegnata**;
- `SEAT_ORDER` (`:148`): le due sedie stanno fra i **fatti materiali** (dopo Lavori,
  prima di Esteri).

### 2.2 `backend-nest/src/core/government/GovernmentAgenda.ts`
- `GovernmentAgendaInput` guadagna `education?` (`:184`) e `health?` (`:199`), entrambi
  opzionali;
- helper `estimated(source, method)` (`:220`) accanto a `measured`;
- due voci nuove (`education_condition` `:561`, `health_condition` `:595`), con due
  strade ciascuna, urgenza `ordinaria`, `factionId: null`.

### 2.3 `backend-nest/src/game/GovernmentReadings.ts`
- il tipo `account` viene esteso con `universities`, `population`, `stability`,
  `socialTension` (campi **già presenti** in `NationalAccount`, qui solo dichiarati);
- legge `educationBurdenPct`/`socialBurdenPct` da `input.government.budget` (`:252-253`) —
  la fotografia del governo **espone già** `budget: NationalBudgetDetail`
  (`GovernmentFactions.ts:86`), quindi **nessun tocco al motore**;
- passa `education`/`health` a `buildAgenda` solo con conto e quota > 0 (`:289-293`).

---

## 3. Backend — il dialogo raccontato e il collega giusto

`backend-nest/src/core/government/MinisterChat.ts`:
- **`SEAT_TOPICS`** (`:72`) — mappa «argomento → sedia», parole chiave prese dalle stesse
  competenze di `SEAT_READS`;
- **`seatForQuestion`** (`:83`) e **`colleagueRedirect`** (`:104`) — quando la domanda è
  fuori competenza, il ministro **nomina** il collega con nome e competenza
  («Non è la mia materia: *Ministro dei Lavori* se ne occupa, e legge *cantieri, deficit
  misurati, opere del catalogo*»), invece di rimbalzare in modo secco;
- **briefing** (`:127-141`): regole di narrazione («COME PARLI») + directory dei colleghi
  («I TUOI COLLEGHI»), che **non include sé stesso** e usa solo `SEAT_LABEL`/`SEAT_READS`;
- **`openingMessage`** (`:189`): chiude **ponendo la scelta** con i titoli delle strade
  già dichiarate (`paths[].title`), e **solo se ce ne sono almeno due** — non finge
  un'alternativa inesistente.

Nessun dato inventato: ogni frase poggia su un campo del briefing o su `SEAT_LABEL`/
`SEAT_READS`.

---

## 4. Frontend — tipi, domini, pannello a scomparsa

| File | Modifica |
|---|---|
| `frontend/src/services/api.ts:1022` | unione `seat` estesa con `'istruzione'` e `'sanita'` |
| `frontend/src/components/Game/CabinetSession.tsx:35` | `SEAT_SHORT` con le due etichette brevi |
| `frontend/src/components/Game/seatDomains.ts` | `istruzione: ['popolo']`, `sanita: ['popolo']` (il dominio «popolo» esiste già; **nessun dominio nuovo inventato**) |
| `frontend/src/components/Game/MinisterDossier.tsx` | pannello **a scomparsa** |
| `frontend/src/components/Game/GovernmentOffice.tsx:299` | `key={address?.seat ?? 'nessuna-sedia'}`: cambiando sedia il pannello **riparte chiuso** |
| `frontend/src/editorial.css:1307-1334` | stile del controllo e del corpo |

### 4.1 Il pannello a scomparsa (`MinisterDossier.tsx`)
- controllo **`<button className="minister-dossier-toggle">`** con **`aria-expanded`** e
  **`aria-controls="minister-dossier-body"`** (`:93-95`), `aria-label` che dice
  «Mostra/Nascondi i dati di *<sedia>*»;
- stato iniziale **chiuso** (`useState(false)`, `:67`); la prop `defaultOpen` (`:40`)
  serve solo a rendere lo stato «aperto» verificabile con un render statico, **senza
  jsdom**;
- il corpo (`#minister-dossier-body`, `:106`) è nel DOM ma `hidden` da chiuso, e il
  **contenuto è reso solo da aperto** (`{open && (…)}`): da chiuso non pesa sul dialogo;
- da **aperto** mostra **esattamente** ciò che mostrava prima: nome
  (`.minister-dossier-name`), competenza, cifre con provenienza, «Sul tavolo», dominio.

### 4.2 CSS (`editorial.css`) — nessun `!important`
Deriva dalle classi già presenti (`.minister-dossier-*`), con `.minister-dossier-body[hidden]{display:none}`
esplicito per non farsi sovrascrivere dal `display:flex` del corpo (`:1334`). Il test di
disciplina `cssDiscipline.test.ts` (che vieta `!important` su `.cabinet`/`.minister-`) resta
verde.

---

## 5. Adeguamenti ai test **esistenti** (motivati, non rilassati)

Il comportamento è cambiato **di proposito**, quindi due test che davano per scontato il
pannello sempre aperto sono stati **adeguati**, mantenendo le stesse asserzioni:

1. `frontend/src/components/Game/governmentOfficeMobile.test.tsx` (WS-04) — l'asserzione
   «il pannello dati rende **una** `.minister-dossier-name`» ora rende con
   `defaultOpen`, perché da chiuso il nome **non è reso**. L'invariante è identica.
2. `e2e/tests/modules.spec.mjs` (P04) — le asserzioni sul contenuto del pannello
   (`ministro`, `misurato · Tesoro`, `.op-domain` ×2) ora **aprono prima il controllo**.
   In più si verifica il contratto del toggle (`aria-expanded` `false → true`): il test
   **si rafforza**, non si indebolisce.

Nessuna soglia alzata, nessun test disabilitato, nessuno snapshot.

---

## 6. Test mirati aggiunti

### 6.1 Backend (`+17` test)
- `p01-cabinet.test.ts`: `CABINET_SEATS` **da 5 a 7** + describe *«Istruzione e Sanità nel
  gabinetto»* (compaiono con la voce; **tacciono** senza; `seatOfVoice` assegna le voci
  nuove **senza riassegnare** le esistenti; ordine delle sedie).
- `mg05-government-agenda.test.ts`: describe *«Istruzione e Sanità nell'agenda»* (la
  spesa è dichiarata **stima**; Sanità **dichiara** sanità+sostegno; **senza dato**
  tacciono; **le sedie preesistenti non cambiano**).
- `mg05-agenda-reading.test.ts`: test di cablaggio *«col conto, Istruzione e Sanità
  portano le cifre del conto»* (costruisce `government`/`account`).
- `p02b-minister-chat.test.ts`: describe *«il dialogo raccontato e il collega giusto»*
  (briefing elenca i colleghi **senza sé stesso**; regola che impone di **nominare**;
  fuori competenza nomina il collega; in competenza **non** rimanda; la mappa riconosce
  le due sedie nuove; l'apertura chiude **ponendo la scelta**; senza ≥2 strade non finge
  una scelta).

> **Limite della fixture**: il conto economico della fixture P04 ha `expenseTotal: 0`,
> quindi le quote (`educationBurdenPct`/`socialBurdenPct`) sono `0` e le due sedie
> **tacciono** per la regola stessa. Per questo il test di cablaggio costruisce
> `government`/`account` a mano, e il test «P04 col conto» **non** asserisce
> education/health. Non è un buco: è la regola «senza dato tace» che si vede in azione.

### 6.2 Frontend (`+3` test) — `governmentOfficeMobile.test.tsx`
Describe *«WS-GOVOFFICE-05 — il pannello dati a scomparsa»*:
1. da **chiuso**: controllo `<button>`, `aria-expanded="false"`,
   `aria-controls="minister-dossier-body"`, corpo `hidden`;
2. da **chiuso** il contenuto **non è reso** (nessun nome/cifra/«Sul tavolo»);
3. da **aperto** mostra nome, cifre con provenienza e «Sul tavolo» (nessuna perdita).

Il clic reale è coperto dall'E2E (sotto), non simulato senza DOM.

---

## 7. File modificati

| File | Tipo |
|---|---|
| `backend-nest/src/core/government/Cabinet.ts` | modifica |
| `backend-nest/src/core/government/GovernmentAgenda.ts` | modifica |
| `backend-nest/src/core/government/MinisterChat.ts` | modifica |
| `backend-nest/src/game/GovernmentReadings.ts` | modifica |
| `backend-nest/tests/{p01-cabinet,mg05-government-agenda,mg05-agenda-reading,p02b-minister-chat}.test.ts` | modifica (test) |
| `frontend/src/services/api.ts` | modifica |
| `frontend/src/components/Game/{CabinetSession,MinisterDossier,GovernmentOffice}.tsx` | modifica |
| `frontend/src/components/Game/seatDomains.ts` | modifica |
| `frontend/src/editorial.css` | modifica |
| `frontend/src/components/Game/governmentOfficeMobile.test.tsx` | modifica (test) |
| `e2e/mock-api.mjs` | modifica (fixture `MOCK_CABINET_MULTI` + `opts.cabinet`) |
| `e2e/govoffice-shot.mjs` | modifica (viewport/env, sedie nuove, pannello aperto) |
| `e2e/tests/modules.spec.mjs` | modifica (apre il toggle: P04) |
| `docs/implementation/WS-GOVOFFICE-05-report.md` | nuovo (questo documento) |
| `docs/implementation/assets/ws-govoffice-05/*.png` | nuovi (prove visive) |

`MOCK_CABINET` **non** è stato toccato: le suite esistenti continuano a contare **2**
sedie. Il gabinetto a 4 sedie è la nuova fixture `MOCK_CABINET_MULTI`, usata solo dalla
prova visiva.

---

## 8. Conferma CORE ENGINE FREEZE

**Il freeze è intatto.** Non sono stati toccati: `backend-nest/src/core/simulation/**`,
`GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
schema/database, repository, semantica checkpoint/`useSimulationPlayback`, pipeline di
avanzamento del tempo. Le quote `educationBurdenPct`/`socialBurdenPct` erano **già
pubblicate** dalla fotografia del governo (`GovernmentFactions.ts:86`): sono state
**lette**, non ricalcolate. Nessun motore nuovo, nessuna dipendenza frontend nuova,
nessuna migrazione: **nessun blocco**.

---

## 9. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| `npm --prefix backend-nest test` | ✅ **200 file / 2100 test** passati (2083 + 17) |
| `cd frontend && ../node_modules/.bin/vitest run` | ✅ **105 file / 890 test** passati (887 + 3) |
| `frontend: tsc --noEmit` | ✅ pulito |
| `backend-nest: tsc --noEmit` | ✅ pulito |
| `npm run build` (frontend + backend) | ✅ verde |
| `npm run test:e2e:mock` | ✅ **149** test passati (mock offline, 17.4 m) |
| `npm run test:a11y` | ✅ **3** test passati |

Test flaky noti (`military-warfront-integrity.test.ts` #50,
`op-objects-time-step.test.ts` #42): **non si sono presentati**; nessuna soglia alzata o
rilassata.

---

## 10. Prova visiva (390 px, controllo 1440 px)

Prodotta con `e2e/govoffice-shot.mjs` (`GOVOFFICE_MULTI=1`) contro l'albero di lavoro, e
col «prima» da un worktree **alla revisione base `a71f3fe`** (`GOVOFFICE_BASE_URL`).
Verifica dei numeri con script DOM temporaneo (poi rimosso), non a occhio.

### 10.1 Le due sedie nuove compaiono e dicono ciò che leggono
```
[390] PICKS (4) → tesoro, lavori, istruzione, sanita
  istruzione → «Ministro dell'Istruzione», legge «scuole e atenei, spesa per istruzione e ricerca, tensione sociale»
  sanita     → «Ministro della Sanità»,    legge «spesa sociale (sanità e sostegno), popolazione, stabilità»
```

### 10.2 Il pannello è chiuso di default e si apre su richiesta (390 e 1440 identici)
| Stato | `aria-expanded` | corpo `hidden` | nome nel DOM | cifre |
|---|---|---|---|---|
| chiuso (default) | `false` | `true` | **no** | **0** |
| aperto | `true` | `false` | **sì** | 3 |

Da aperto, le cifre con la **provenienza dichiarata** (Istruzione):
```
Spesa per istruzione e ricerca  3,8 % del PIL   stimato · ripartizione delle uscite civili su atenei e ricerca
Atenei                          42 atenei       misurato · conto nazionale
Tensione sociale                58 /100         misurato · conto nazionale
```
e (Sanità), con la dicitura **sanità + sostegno**:
```
Spesa sociale (sanità e sostegno)  9,1 % del PIL  stimato · ripartizione … su sanità, popolazione e sostegno
Popolazione                        61.000.000     misurato · conto nazionale
Stabilità                          64 /100        misurato · conto nazionale
```

### 10.3 Nessuna regressione di layout
| Metrica | 390 px | 1440 px |
|---|---|---|
| Sovrapposizioni (`chat×dossier`, `chat×footer`, `dossier×footer`) | **0 / 0 / 0** | **0 / 0 / 0** |
| Overflow orizzontale | **0** | **0** |
| Schermate invariate (registro) | — | `before-1440-1` = `after-1440-1`; `before-1440-4` = `after-1440-4` |

### 10.4 Artefatti (in `docs/implementation/assets/ws-govoffice-05/`)
- **390 prima/dopo**: `before-390-2-seduta-due-pannelli`, `before-390-2c-{istruzione,sanita}`
  (pannello **sempre aperto**, comportamento vecchio) vs `after-390-2-seduta-due-pannelli`
  (chiuso), `after-390-2b-pannello-aperto`, `after-390-2c-{istruzione,sanita}` (chat con le
  sedie nuove) e `after-390-2d-{istruzione,sanita}-dati` (cifre con provenienza);
- **1440 non regressione**: `before-/after-1440-1-registro-vuoto` e
  `before-/after-1440-4-registro-firmato`, più `after-1440-2b`, `after-1440-2d-*`.

---

## 11. Limiti residui

1. **Le quote sono stime ripartite**, non misure dirette (difesa è l'unica esatta). È
   dichiarato (`estimated` + metodo) ma resta una stima: se il motore cambia i pesi,
   cambiano le quote. I pesi sono nel motore; le sedie non li duplicano.
2. **`socialBurdenPct` = sanità + sostegno**: la sedia dichiara la somma. Separare la sola
   sanità richiederebbe un campo nuovo nel conto — **fuori dal freeze**, non fatto.
3. **Il rimando al collega è deterministico** (parole chiave in `SEAT_TOPICS`), non capito
   dal modello: copre i casi lessicali, non le parafrasi rare. Il modello riceve comunque
   la directory dei colleghi nel briefing.
4. **`defaultOpen` esiste per i test** (render statico senza DOM). Non è usato in
   produzione: `GovernmentOffice` non lo passa (default `false`).
5. Il **testo del dialogo** (narrazione) è guidato dal briefing e verificato sui suoi
   vincoli; la resa finale dipende dal modello e non è asserita bit per bit.

---

## 12. Proposte per la fase successiva

1. **Un campo di conto separato per la sanità** (oltre a `socialBurdenPct`), così la
   sedia Sanità può leggere la sola sanità senza sommarla al sostegno — richiede però un
   intervento sul motore (fuori dal freeze attuale).
2. **Rendere espliciti i pesi delle quote** in un'unica sede consultabile, così il
   giocatore (e il report) possono risalire dalla stima al suo metodo senza leggere
   `NationalBudget.ts`.
3. **Un test di non-regressione E2E** che apra/chiuda il pannello e asserisca
   `aria-expanded`, come già fatto per altri controlli a11y.
4. **Estendere `SEAT_TOPICS`** con le parafrasi emerse dall'uso reale, restando dentro le
   competenze dichiarate in `SEAT_READS`.

# WS-GOVOFFICE-05B — Il saldo leggibile e il refuso del Presidente

**Base**: `main` = `cfc0a08` (merge PR #140, WS-GOVOFFICE-05) · **Branch**: `feat/ws-govoffice-05b-cifre`
**Perimetro**: **solo presentazione** (decisione A dell'autore). **CORE ENGINE FREEZE
intatto**: nessuna modifica a `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, schema/database, repository, semantica di
checkpoint/simulation run/`useSimulationPlayback`, pipeline di avanzamento del tempo.
In più, come richiesto da questo task, **i valori numerici di
`backend-nest/src/core/government/GovernmentAgenda.ts` non sono stati toccati**: le
cifre restano piene alla fonte; cambia soltanto la loro **resa**.

Lavoro svolto: (1) **un solo helper di formato** condiviso, applicato a **tutte** le
cifre del ministro (griglia, testo narrato, barre); (2) **indagine sul refuso «Ho l
cosa»**, con la causa dichiarata; (3) **prova visiva prima/dopo a 390 px** e controllo
a 1440 px.

Le prove «prima/dopo» sono in `docs/implementation/assets/ws-govoffice-05b/`, con il
dettaglio misurato in `verifica-dom.json`.

---

## 1. Problemi trovati (causa reale)

### 1.1 Le cifre piene del motore finivano a video (confermato)

Il motore produce `Figure.value` come stringa piena, senza arrotondare — ed è giusto
così: è la sorgente di verità per i calcoli. La resa però mostrava quella stringa
**così com'era**:

| etichetta | valore del motore | prima (a video) | dopo (a video) |
|---|---|---|---|
| Saldo di bilancio | `0.06241708333333345` | `0.06241708333333345 mld` | **`0,06 mld`** |
| Saldo su PIL | `0.2` | `0.2 %` | **`0,2 %`** |
| Debito su PIL | `29.4` | `29.4 %` | **`29,4 %`** |
| Interessi su entrate | `3.2` | `3.2 %` | **`3,2 %`** |
| Prelievo effettivo | `9.1` | `9.1 %` | **`9,1 %`** |

Causa: nessuna funzione di resa condivisa applicata alle cifre del ministro.
`CabinetSession.tsx` e `MinisterDossier.tsx` (griglia + `FigureBar`) e `MinisterChat.tsx`
mostravano `figure.value` o `figure.unit` grezzi, e i valori **dentro la prosa** del
motore (il «perché», i bisogni, la frase d'apertura) restavano con il punto decimale
inglese.

### 1.2 Il refuso «Ho l cosa»: **il difetto non esiste nel codice**

**Dichiarazione richiesta dal task.** Ho verificato **prima** di correggere. Esito:

> **Il refuso è un artefatto di leggibilità/resa (caso *a*: nasce a valle, nella
> resa), NON un errore di testo alla fonte (caso *b*).**

Prove raccolte sulla **revisione base `cfc0a08`** (la stessa che il sito pubblica:
`https://world-story.bovel-cannas.workers.dev/build-id.txt` = `cfc0a08`):

1. **La stringa alla fonte è corretta.** In
   `backend-nest/src/core/government/Cabinet.ts:200-205`, `openingFor()` compone
   `` const things = `${count} ${count === 1 ? 'cosa da portare' : 'cose da portare'} al consiglio` ``
   e `` return `Ho ${things}${urgent}.` ``: il conteggio è **una cifra interpolata**
   (`${count}`), mai una lettera. `git blame` attribuisce quelle righe a `64674748`
   (la nascita del gabinetto) e **non sono mai cambiate**.
2. **Il DOM rende «1», non «l».** Sulla base `cfc0a08`, con il gabinetto reale del
   backend, `innerText` **e** `textContent` del saluto sono entrambi
   `"Ho 1 cosa da portare al consiglio. Chiedi quello che vuoi: i numeri che vedi
   sono quelli del motore."` — la cifra è nel testo del nodo.
3. **I glifi sono diversi.** Nel font corrente (Literata, **corsivo**, 12.5 px, colore
   tenue `rgb(195, 206, 194)`), misurati con `canvas.measureText`:
   `«1»` = 5.37 px, `«l»` = 3.56 px; `«Ho 1 cosa»` = 53.23 px ≠ `«Ho l cosa»` = 51.43 px.
   La frase a video è quella con la cifra.
4. **Il «prima» della prova visiva lo mostra.** In
   `assets/ws-govoffice-05b/05-before-390-apertura.png` (base `cfc0a08`) l'apertura si
   legge già `Ho 1 cosa`.

Conclusione: **il testo è sempre stato giusto**. Il «refuso» è nato dalla resa del
numero **in corsivo, piccolo e a basso contrasto** — un `1` sottile che a occhio si
confonde con `l`. La correzione pertinente è quindi **alla resa**, non alla stringa:
si rendono le cifre **diritte (non corsive)** e con cifre lineari/tabulari, così il
numero è inequivocabile. La copia del testo resta **intatta**.

### 1.3 Esisteva già un helper condiviso: esteso, non duplicato (confermato)

`frontend/src/utils/format.ts` conteneva già `groupThousands` (raggruppamento
**deterministico**, `,` decimale e `.` per le migliaia) più
`formatNumber/Money/Percent/Date/Period`. Come da regola «se esiste, usalo», **l'ho
esteso** invece di introdurre un secondo percorso di formato. Vedi §2.1 per la scelta
di non usare `Intl.NumberFormat` e perché resta «un solo punto di verità».

---

## 2. Correzioni applicate

### 2.1 `frontend/src/utils/format.ts` — un solo helper di formato

Quattro funzioni pure, tutte appoggiate all'unico `groupThousands` già esistente:

- `decimalsForUnit(unit)` → **1 decimale** se l'unità contiene `%`, **2** per tutto il
  resto;
- `formatDecimal(value, decimals=2)` → cifre fisse, `,` decimale, `.` per le migliaia,
  segno conservato; `null/undefined/non-finito` → `'—'` (**mai** uno zero inventato);
- `formatFigureValue(value, unit)` → il valore pieno del motore reso leggibile con
  l'unità accanto (`''`, stringhe non numeriche come `'n/d'` restano invariate);
- `formatNarratedDecimals(text)` → formatta **solo i decimali dentro la prosa**
  (2 cifre, 1 se seguiti da `%`); gli **interi non si toccano** (`Ho 1 cosa` resta
  `Ho 1 cosa`, un anno non diventa `2.000`) e un numero **già raggruppato**
  (`61.000.000`) non si spezza. Il punto di fine frase **non** blocca la formattazione
  (caso `..., al 30.4%.` che altrimenti restava a punto).

**Scelta dichiarata**: ho riusato `groupThousands` (che usa un solo `toFixed`, in un
solo punto) invece di `Intl.NumberFormat('it-IT')`. Motivo: è **già** la convenzione di
formato italiano dell'app (deterministica, indipendente dall'ICU del runtime), e la
regola «se esiste, usalo» prevale; il risultato è identico a quello richiesto
(`0,06`, `1.234,50`, `29,4 %`). Un solo punto di verità, nessun `toFixed` sparso.

### 2.2 `frontend/src/components/Game/EngineText.tsx` (nuovo)

Componente minimo che rende un testo del motore: (1) applica
`formatNarratedDecimals`, (2) avvolge **ogni numero** in
`<span class="op-numeral">`. È il punto unico per la prosa del ministro.

### 2.3 Applicazione a **tutte** le cifre del ministro

| superficie | prima | dopo |
|---|---|---|
| griglia dei dati (`MinisterDossier`) | `figure.value` grezzo | `formatFigureValue` |
| barra (`FigureBar`, `MinisterDossier` e `MinisterChat`) | `figure.value` grezzo | `formatFigureValue` |
| testo narrato — frase d'apertura, bisogni, «perché», dettagli/esiti delle strade | testo grezzo | `EngineText` |
| chat del ministro (`MinisterChat`) — saluto e cifre | testo grezzo | `EngineText` / `formatFigureValue` |
| seduta (`CabinetSession`) — apertura del presidente, sedie, bisogni, «perché», cifre, strade | testo grezzo | `EngineText` / `formatFigureValue` |

Le cifre `unknown` continuano a passare da `isUnknown(...)` → `—` **prima** della
formattazione: la regola esistente è rispettata, nessuno `0` al posto di un dato
mancante, nessuna barra.

### 2.4 `frontend/src/editorial.css` — la cifra diritta

```css
.op-numeral { font-style: normal; font-variant-numeric: lining-nums tabular-nums; }
```

Rende i numeri **non corsivi** e a cifre allineate: è la correzione del §1.2, e vale
in ogni contesto (chat, seduta, griglia). Nessun `!important`, nessuna selettore
vietato dal test di disciplina CSS (`.cabinet`/`.minister-`).

### 2.5 Il refuso: nessuna modifica al testo

Come dichiarato (§1.2), la stringa non è stata toccata — sarebbe stata la correzione
sbagliata. La prova visiva mostra l'apertura `Ho 1 cosa` **prima e dopo**.

---

## 3. File modificati

**Codice**
- `frontend/src/utils/format.ts` — helper di formato (+72 righe)
- `frontend/src/components/Game/EngineText.tsx` — **nuovo**
- `frontend/src/components/Game/CabinetSession.tsx` — `EngineText`/`formatFigureValue`
- `frontend/src/components/Game/MinisterDossier.tsx` — `EngineText`/`formatFigureValue`
- `frontend/src/components/Game/MinisterChat.tsx` — `EngineText`/`formatFigureValue`
- `frontend/src/editorial.css` — `.op-numeral`

**Test**
- `frontend/src/utils/format.test.ts` — `describe('WS-GOVOFFICE-05B — le cifre del ministro')`
- `frontend/src/components/Game/CabinetSession.test.tsx` — `describe('WS-GOVOFFICE-05B — le cifre del ministro')` + 2 asserzioni esistenti aggiornate
- `backend-nest/tests/p01-cabinet.test.ts` — `describe('WS-GOVOFFICE-05B — la frase d’apertura')`
- `e2e/tests/modules.spec.mjs` — P04: asserzioni di formato (griglia + testo)

**E2E / prove**
- `e2e/govoffice-shot.mjs` — nuova modalità `GOVOFFICE_CABINET=raw` + pannello dati sempre aperto
- `e2e/mock-api.mjs` — valori del mock resi **fedeli al motore** (decimali col punto)
- `e2e/fixtures/ws-govoffice-05b-tesoro-raw.json` — **nuovo**: snapshot reale del motore
- `docs/implementation/assets/ws-govoffice-05b/` — **nuovo**: 8 PNG + `verifica-dom.json`
- `docs/implementation/WS-GOVOFFICE-05B-report.md` — questo documento

---

## 4. I valori del motore NON sono cambiati — CORE ENGINE FREEZE intatto

**Nessuna** modifica a `GovernmentAgenda.ts`, a `Cabinet.ts`, a `MinisterChat.ts` né a
`core/simulation/**`. In particolare `measured(...)` e `Figure.value` restano
**pieni**. Le cifre `0.06241708333333345`, `29.4`, `3.2`, `9.1` sono ancora quelle che
il backend consegna: la formattazione vive **solo** nel frontend, al momento della
resa.

**Dimostrazione — test dedicato** (`p01-cabinet.test.ts`, describe *«WS-GOVOFFICE-05B —
la frase d’apertura»*, caso *«i valori pieni del motore restano INTATTI»*):

```ts
const raw = '0.06575272084693667';
const session = composeCabinet(agenda([{ ...voice('treasury_condition'),
  figures: [{ label: 'Saldo di bilancio', value: raw, unit: 'mld', ... }] }]));
const tesoro = session.addresses.find(a => a.seat === 'tesoro')!;
expect(tesoro.items[0].figures[0].value).toBe(raw);            // identico, non arrotondato
expect(tesoro.items[0].figures[0].value).not.toContain(',');   // non è una stringa «italiana»
```

**Dimostrazione — prova visiva**: il «prima» (`01`, `03`) mostra a video la stringa
piena `0.06241708333333345 mld`; il «dopo» (`02`, `04`) mostra `0,06 mld`. Il valore
pieno è presente **prima** ed è **assente dopo** solo perché non viene più *stampato* —
non perché sia stato cambiato.

---

## 5. Test eseguiti (esito reale)

| comando | esito |
|---|---|
| backend `vitest run` | **200 file / 2104 test passati** (+4) |
| frontend `vitest run` | **105 file / 898 test passati** (+8) |
| `tsc --noEmit` (frontend) | pulito |
| `tsc --noEmit` (backend) | pulito |
| `npm run build` (frontend + backend) | verde |
| `npm run test:e2e:mock` | **149 passati** |
| `npm run test:a11y` | **3 passati** |

Nuovi test mirati:
- **formato** (`format.test.ts`): valore a 17 decimali → `0,06`; migliaia `1.234,50`;
  percentuale a 1 decimale; `unknown` resta `—` (mai `0`); **negativi** (`-12,35`);
  non-numerici invariati;
- **testo narrato** (`format.test.ts` + `CabinetSession.test.tsx`): il «perché» con 17
  decimali si formatta a virgola; gli interi non si toccano (`Ho 1 cosa`);
  `61.000.000` non si spezza;
- **frase d'apertura** (`p01-cabinet.test.ts`): singolare esatto `Ho 1 cosa da portare
  al consiglio, 1 urgente.`; plurale esatto `Ho 2 cose…`; nessuna `l` al posto di una
  cifra; **immutabilità del motore** (sopra);
- **E2E** (`modules.spec.mjs` P04): la griglia mostra `12,40 mld`, il testo narrato
  `6,50 mld`, e il valore a punto `6.5 mld` **non** compare.

Nessun test rilassato, nessun timeout alzato, nessuna dipendenza aggiunta. I flaky noti
(`military-warfront-integrity.test.ts` #50, `op-objects-time-step.test.ts` #42) **non
sono falliti**.

---

## 6. Risultati — prova visiva (390 px) e controllo (1440 px)

Metodo: `e2e/govoffice-shot.mjs` con `GOVOFFICE_CABINET=raw` monta lo **snapshot reale
del motore** (`e2e/fixtures/ws-govoffice-05b-tesoro-raw.json`, i valori della fotografia
di WS-05B). Il «prima» gira sull'albero alla revisione `cfc0a08` (porta 5174), il «dopo»
sull'albero di lavoro (porta 5173). La misurazione del DOM è in
`assets/ws-govoffice-05b/verifica-dom.json`.

| metrica (390 px) | prima `cfc0a08` | dopo |
|---|---|---|
| saldo a video | `0.06241708333333345 mld` | **`0,06 mld`** |
| percentuali | `0.2 %` · `29.4 %` · `3.2 %` · `9.1 %` | **`0,2 %` · `29,4 %` · `3,2 %` · `9,1 %`** |
| frase d'apertura | `Ho 1 cosa da portare al consiglio.` | `Ho 1 cosa da portare al consiglio.` |
| cifra nel suo `<span>` lineare (`op-numeral`) | `[]` | `["1"]` |
| valore pieno nel DOM | **presente** | **assente** |
| traboccamento orizzontale | 0 | 0 |
| sovrapposizione chat/dati | no | no |

Le stesse misure a **1440 px** confermano: formato corretto, `0` traboccamenti, nessuna
sovrapposizione — nessuna regressione di layout.

Artefatti citati (in `docs/implementation/assets/ws-govoffice-05b/`):
- `01-before-390-cifre-grezze.png` / `02-after-390-cifre-formattate.png` — la scheda del
  Tesoro, pannello dati aperto: il saldo passa da `0.06241708333333345 mld` a `0,06 mld`;
- `03-before-1440-cifre-grezze.png` / `04-after-1440-cifre-formattate.png` — controllo a
  1440 px;
- `05-before-390-apertura.png` / `06-after-390-apertura.png` — la frase d'apertura
  `Ho 1 cosa…` (già corretta prima; cifra ora diritta);
- `07-before-390-seduta.png` / `08-after-390-seduta.png` — la seduta a pannello chiuso;
- `verifica-dom.json` — l'estratto misurato (prima/dopo, 390 e 1440).

---

## 7. Limiti residui

1. **Il «quadro nazionale» della sedia** (`LA MATERIA, DAL QUADRO NAZIONALE`) mostra
   numeri propri (`PIL 100 mld`, `+0,8 mld`, `19%`) che **non** sono le `Figure` del
   ministro: arrivano già formattati dal contratto del dominio e restano come sono.
   Non rientrano nel perimetro «cifre del ministro» di questo task.
2. **`formatNarratedDecimals` è euristico**: formatta ogni `\d+\.\d+` di prosa, con
   guardie per non toccare i numeri raggruppati. È robusto per i testi reali del
   motore (che non usano il punto per le migliaia), ma un ipotetico `1.234` inteso
   come *migliaia* verrebbe letto come decimale. Il motore non produce mai quel caso.
3. **Il refuso non era nel codice**: non c'è una «correzione di stringa» da mostrare in
   un diff, perché non c'era una stringa sbagliata. La correzione è di resa
   (`op-numeral`) ed è provata a video.

---

## 8. Proposte per la fase successiva

1. **Un test E2E di non-regressione sul formato**: fissare in `modules.spec.mjs` anche
   `aria-expanded` e una cifra formattata dopo riapertura, così il contratto di resa è
   coperto dall'end-to-end oltre che dall'unit.
2. **Un `Intl.NumberFormat('it-IT')` memoizzato** come unica primitiva, se in futuro si
   vuole eliminare del tutto `toFixed`: oggi l’helper condiviso è coerente, ma
   converge tutto su un'unica API standard.
3. **Formattare anche il quadro nazionale** con lo stesso helper, quando/se il
   contratto di dominio passerà i valori grezzi invece che pre-formattati.
4. **Estendere `formatNarratedDecimals`** con un riconoscimento esplicito delle
   migliaia (`1.234` italiano) se in futuro la prosa del motore le introdurrà.

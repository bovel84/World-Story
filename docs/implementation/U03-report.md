# U03 — Dossier Nazione, chat/accordi e lettore causale

## µ1 — Dossier a sezioni (maestro §10.3), default «decisioni richieste», formattazione (passo 1)

**Stato:** completata, da revisione indipendente.

### Fotografia iniziale
- HEAD `384dac7`, working tree con tutto il lavoro F00–M07/U01/U02 NON committato (riorganizzazione `docs/` dell'utente intoccata).
- Backend 60 file / 447 test verdi; frontend 33 test verdi; build OK.
- Il pannello Nazione era **inline in `App.tsx`** (blocco `nation-desk`): un unico bollettino monolitico (popolazione/PIL/entrate/uscite) senza sezioni, senza navigazione, senza default «decisioni richieste». La formattazione usava `toLocaleString('it-IT')` (dipendente dai dati ICU del runtime, che in Node non raggruppano i numeri a 4 cifre) e `toFixed` per entrate/uscite.

### Requisiti audit / invarianti / test
- **UI01** (ingresso/refresh/ritorno: Nazione chiusa all'ingresso, un solo modulo attivo) — già coperto da U01 µ1; qui il dossier resta un modulo su richiesta.
- **UI04** (notizia storica e checkpoint selezionato: lettura non mutante) — la navigazione a sezioni è solo presentazione, nessuna mutazione del mondo.
- Piano U03 passo 1: «Dossier sezioni maestro §10.3, default «decisioni richieste». Selezione provincia non rinominare la nazione; denaro/unità/periodi formattati.»
- Maestro §10.3: sei sezioni progressive (Situazione, Progetti, Bilancio, Risorse, Conoscenze, Politiche); ogni sintesi ha «Da cosa dipende?» e un dettaglio con fonte/data.

### File letti e modificati
- **Letti:** `App.tsx` (blocco `nation-desk` inline), `stores/moduleState.ts`/`uiStore.ts` (pattern U01), `DiplomacyPanel.tsx`/`ChatsPanel.tsx` (pattern componenti), `backend-nest/src/core/simulation/WorldStateEngine.ts` (shape `NationalAccount`), `backend-nest/src/game-session.ts` (`getNationalAccounts`), maestro §10.3, `docs/implementation/U02-report.md`.
- **Nuovi:** `frontend/src/stores/nationDock.ts` (reducer puro sezioni), `frontend/src/stores/nationDock.test.ts` (7 prove, UI01/UI04), `frontend/src/utils/format.ts` (formattazione condivisa), `frontend/src/utils/format.test.ts` (11 prove), `frontend/src/components/Game/NationDock.tsx` (componente a sezioni).
- **Modificati:** `frontend/src/App.tsx` (import + uso di `NationDock` al posto del bollettino inline), `frontend/src/index.css` (regole scoped `.nation-dock-*`).

### Comportamento prima (test rosso o prova statica)
- Nessun test per le sezioni del dossier né per la formattazione. Prova statica: `grep -n "nation-bulletin-card" App.tsx` → bollettino monolitico inline senza sezioni; `grep -n "toLocaleString('it-IT')" App.tsx` → formattazione dipendente da ICU. In Node `(1000).toLocaleString('it-IT')` restituisce `"1000"` (non `"1.000"`): la formattazione non era deterministica.

### Contratto API/schema e compatibilità
- **`NationSection`** (puro): `'situazione' | 'progetti' | 'bilancio' | 'risorse' | 'conoscenze' | 'politiche'`.
- **`NationDockState`** (puro): `{ activeSection }`, default `'situazione'` (decisioni richieste). Reducer `setSection` (solo navigazione, nessuna mutazione del mondo). `NATION_SECTIONS` (ordine canonico) e `NATION_SECTION_LABEL` (etichette italiane).
- **`utils/format.ts`** (puro): `formatNumber`, `formatMoney` (valuta/decimale/segno opzionali), `formatPercent`, `formatDate`, `formatPeriod`. Raggruppamento migliaia DETERMINISTICO (`.`), decimale `,`; valori non validi → `—`.
- **`NationDock`** (componente): props `nationalName` (polity), `governmentType`, `account` (shape `NationalAccount`), `campaignProgress`, `latestNarration`. Renderizza le schede delle 6 sezioni + il contenuto della sezione attiva.
- **Compatibilità:** nessun cambiamento di contratto API/backend. Il bollettino usa le stesse classi CSS esistenti (`nation-bulletin-card`, `nation-ledger`, `nation-progress`, `nation-narration`) così lo stile è preservato; le nuove regole `.nation-dock-*` sono scoped.

### Algoritmo e invarianti mantenute
- All'apertura del dossier la sezione attiva è `'situazione'` (decisioni richieste), mai una sezione di dettaglio (UI01/UI04).
- Una sola sezione attiva alla volta; cambiare sezione è solo navigazione (nessuna mutazione del mondo).
- La nazione mostrata è la **polity** del giocatore (`nationalName`), mai rinominata dalla provincia selezionata sulla mappa (già garantito in App: `nationalReference?.polityName || nationalReference?.name || playerPolityId`).
- Denaro/unità/periodi formattati con gli helper condivisi (deterministici, non dipendenti da ICU).
- Le sezioni oltre «Situazione» mostrano uno stato «Da cosa dipende?» con fonte dichiarata (M02/M04/M05/M01/M07): i dati reali arrivano nelle µ successive.

### Migrazioni eseguite solo su copie
- Nessuna migrazione DB. Solo refactor frontend (nessun dato toccato).

### Comandi test e risultato completo
- `cd frontend && ../node_modules/.bin/vitest run` → **5 file, 51 test verdi** (33 preesistenti + 18 nuovi: 7 `nationDock.test.ts` + 11 `format.test.ts`).
- `npm --prefix frontend run build` → OK (tsc + vite).
- `npm --prefix backend-nest test` → **60 file, 447/447 verdi** (regressione intatta).
- `git diff --check` → pulito.

### Screenshot/trace se UI
- Nessuno in questa µ: refactor di stato puro + estrazione componente + navigazione a sezioni. Gli screenshot degli stati (chiuso/aperto/loading/empty/error/disabled) e la shell grid sono previsti nelle µ successive (passo 1 completo + shell grid U01 µ2).

### Cosa NON è implementato / dipendenze mancanti
- Passo 2 (disponibile/impegnato/previsto separati; progetti con fase/lavoro/ostacoli/data condizionata; ledger filtrato tramite causal refs) — richiede M02/M05 per i dati reali.
- Passo 3 (chat accessibile con card accordo strutturata; nessun bottone conversa che sottoscrive condizioni senza preview/consenso) — µ successiva.
- Passo 4 (lettore checkpoint con data e ancora, cause/effetti, Save/Intervieni/Continua; archivio separato read-only) — µ successiva.
- Passo 5 (esperienza touch/tastiera/landscape: un foglio alla volta, lista risorse, compositore sopra tastiera, ritorno focus) — µ successiva.
- Sezioni Progetti/Bilancio/Risorse/Conoscenze/Politiche: solo placeholder «Da cosa dipende?» (dati reali da M02/M04/M05/M01/M07).
- Test UI04–UI12/UI14/UI15 e C03/C05/C06/C12 — richiedono harness Q01/browser e/o dati M02/M05, non in questa µ.

### Decisione revisore
- **Da revisionare** (revisore ≠ implementatore): l'estrazione del bollettino inline in `NationDock` (nessun cambiamento di comportamento atteso, ma è una modifica di struttura del componente) e l'introduzione della formattazione deterministica `utils/format` (sostituisce `toLocaleString`/`toFixed` nel bollettino).

---

## Prossima micro-consegna (µ2)
- **Passo 2:** disponibile/impegnato/previsto separati; progetti con fase, lavoro, ostacoli e data condizionata; ledger filtrato tramite causal refs. Dipende da M02/M05 per i dati reali; in assenza, mock congelati dichiarati.
- Oppure **passo 3:** chat accessibile con card accordo strutturata; nessun bottone conversa che sottoscrive condizioni senza preview/consenso.

# WS-JEV-W6 — Memoria narrativa delle fazioni interne

## 1. Perimetro ed esito

Fase **W6** del piano JEV (memoria narrativa), su base `main@8412d8d` (W1–W5 già
in `main`), ramo `feat/ws-jev-w6-factions`.

Obiettivo: dare alle **fazioni interne al governo** una memoria narrativa JEV che
ricordi **come sono state trattate** (favori, torti, promesse, silenzi) e che
entri nel briefing esistente dove la fazione è considerata o parla.

La memoria **non sostituisce i numeri**: la soddisfazione resta derivata dal
bilancio (`GovernmentFactions`), la pressione resta del motore. JEV aggiunge il
*perché* politico. Nessun valore dello stato deterministico è calcolato o
modificato da JEV.

Esito: implementato, verificato e consegnato come **sola PR verso `main`**
(nessun merge/deploy in autonomia).

## 2. File toccati (estensioni, nessun nuovo sistema)

| File | Intervento |
| --- | --- |
| `src/core/government/jev/jev.config.ts` | nuovo `maxFactionContextTokens` (default **1200**), documentato |
| `src/core/government/jev/jev-memory.service.ts` | adapter `factionMemoryInputs` (scope canonico `faction:<id>`, id `faction:<id>:<source>`) e retrieval `getFactionMemory` (budget, pertinenza con ripiego, `touch` opzionale) |
| `src/game/NationStateService.ts` | sidecar: la stessa decisione entra in `government` (W2) **e** nella memoria della singola fazione (W6) |
| `src/game/GameDataService.ts` | `buildFactionNarrativeMemory`: memoria composta nel read model (`worldState.factionMemory`), tetto **globale**, nessuna scrittura |
| `src/prompts/government.ts` | innesto in `buildGovernmentStateBlock` e `buildGovernmentVoicePrompt` (parametro opzionale) |
| `src/prompt-builder.ts` | passthrough di `worldState.factionMemory` nei due punti di briefing |
| `tests/ws-jev-w6-factions.test.ts` | **17 test** (adapter, retrieval, innesto, read model) |

Vincoli rispettati: **nessuna** duplicazione di `src/core/simulation/FactionMemory.ts`
(che resta il modulo deterministico esistente); ogni query filtra `game_id` **e**
`branch_id`; niente vector DB/embeddings; flag spento ⇒ prompt e comportamento
invariati e **zero accessi al repository**; nessuna route API nuova (W1 non ne
aveva aperte).

## 3. Design

- **Adapter**: `factionMemoryInputs(events, ctx)` traduce i `FactionMemoryEvent`
  già prodotti dal motore. Il testo è quello narrativo di `FactionMemory.ts`
  (nessun testo inventato, nessun valore interno come `weight`); `kind` mappa sui
  tipi di governo già noti al classificatore (`government_favor`, `...grievance`,
  `...promise`, `...kept`, `...broken`). Id namespaziato `faction:<id>:<source>`,
  con le parti codificate: nessuna collisione con la memoria di governo.
- **Doppia memoria, store unico**: la decisione si registra sia nello scope
  `government` (W2, trasversale) sia nello scope `faction` (W6, per fazione),
  nello **stesso** `jev_memory`. Nessuna fusione: chiavi `scope_key` distinte.
- **Retrieval**: `getFactionMemory` legge una sola fazione, filtra il futuro,
  esclude archiviate/superate (`eligibleOnly`), ordina con la formula condivisa
  `jevMemoryScore` e ripiega sui fatti salienti quando la query non tocca nulla.
  `maxFactionContextTokens` è il tetto della sezione; `touch` è attivo per i
  retrieval mirati, spento per il read model ampio.
- **Innesto nel briefing esistente** (non un prompt parallelo): la memoria entra
  in `worldState.factionMemory`, viene usata da `buildGovernmentStateBlock`
  (variabile `GOVERNMENT_STATE` della simulazione/consulente) e da
  `buildGovernmentVoicePrompt` (la voce delle fazioni in consiglio). **Tetto
  globale** sul blocco: la somma delle voci non supera `maxFactionContextTokens`,
  quindi il briefing non cresce di N volte il budget per fazione.
- **Best-effort**: qualunque errore (flag malformato, DB, singola fazione) non fa
  fallire la risposta; con il flag spento il blocco è **byte-identico** a prima.

## 4. Prove e gate

| Gate | Comando | Esito |
| --- | --- | --- |
| Focused W6 | `vitest run tests/ws-jev-w6-factions.test.ts` | **17/17** |
| Compatibilità JEV | `vitest run tests/ws-jev-w{1..6}*.test.ts` | **99/99** |
| Backend completo | `npm --prefix backend-nest test` | **214 file / 2280 test** |
| Type-check backend | `tsc --noEmit` | exit 0 |
| Build backend | `npm run build` | exit 0 |

Log in `/tmp/jev-w6-gate/`. Nota: il full-suite locale va eseguito con `dist/`
assente — una build precedente lascia copie `dist/**/*.test.js` che vitest
raccoglie come falsi fallimenti di caricamento (`require()` di vitest). La CI
esegue i test **prima** della build e non è toccata. W6 è backend-only: nessun
frontend, nessun E2E (l'E2E completo 160 va eseguito una sola volta a fine blocco).

## 5. Revisione indipendente — rilievi e chiusure

- **Report mancante** (§5): **chiuso** — questo documento.
- **`getJevConfig`/`getHeadBranch` fuori dal try/catch** (un flag malformato o un
  errore DB facevano fallire l'intero read model): **chiuso** — l'intero helper è
  avvolto in try/catch con `{}` di ripiego.
- **Scritture nel percorso di lettura** (`touch` a ogni `build()`):
  **chiuso** — `getFactionMemory` accetta `touch?: boolean` (default `true`);
  il read model ampio passa `touch: false`. Nessuna scrittura sui GET/read.
- **Budget per fazione senza tetto globale**: **chiuso** — il read model applica
  un tetto **globale** decrescente sull'intero blocco, non N×1200.
- **Forma dell'id** non allineata a `faction:<id>:<source>`: **chiuso** —
  `faction:<factionId>:<source>` con parti codificate.
- **Test**: **chiusi** — uguaglianza byte a byte del blocco senza memoria, tetto
  di default, esclusione delle memorie archiviate, tetto globale verificato.
- **Iniezione nel prompt**: contenuta — `factionLine` serializza con
  `JSON.stringify` (newline/quote escapati) e `memoryExcerpt`/`narrativeText`
  pongono un limite alla lunghezza; il testo arriva comunque solo dal motore.

## 6. Limiti espliciti

- Ogni decisione è registrata in due scope (`government` + `faction`): scelta
  deliberata per non regredire W2 e per dare alla fazione il proprio *perché*.
  Non è un secondo store: stesso `jev_memory`, chiavi distinte.
- `maxFactionContextTokens` è il tetto del **blocco narrativo** nel briefing, non
  di ogni singola memoria; la memoria non consolidata cresce (W7).
- Nessuna UI dedicata: la memoria è nel prompt e ispezionabile via repository/API
  debug esistenti (nessuna route nuova aperta).
- Stress multi-processo e provider reale non provati (come W1–W5).
- Localmente il full-suite su Node 22 resta bloccato dal nativo `better-sqlite3`
  compilato per Node 26; il risultato Node 22 autorevole è quello della CI.

## 7. Consegna

- Ramo `feat/ws-jev-w6-factions` — **sola PR verso `main`**, nessun merge/deploy.
- Nessuna scrittura su `main`, nessuna credenziale esposta, nessun tocco allo
  stato deterministico.

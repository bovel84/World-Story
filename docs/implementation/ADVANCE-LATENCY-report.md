# REPORT — Perché «avanti» è lento (ADVANCE-LATENCY)

Base: `df71557` (MAP-COMPLETE). Ambito: diagnosi del tempo di avanzamento turno +
intervento sul collo di bottiglia CPU non congelato.

---

## 1. Problema

Su **Europa 1914 — La Polveriera** (mondo `00afc7e439ce`: **4475 regioni / 224 politie**,
creato dopo MAP-COMPLETE) un AVANZA richiede **87–126 s**; sullo stesso scenario prima di
MAP-COMPLETE (`a8b901663d69`: 1943 regioni / 21 politie) ne richiedeva **43–71 s**, e su
Europa 1815 (243 regioni) **28–30 s**. Inoltre circa **1 avanzamento su 4-5 fallisce** dopo
attesa piena: l'utente vede la rotella lunga e poi nessun risultato.

Evidenza (`backend-nest/data/open-pax.db`, tabella `simulation_jobs`, durate da
`created_at`/`updated_at`):

| Partita | Mondo | Regioni/Politie | Durata AVANZA |
|---|---|---|---|
| `f811e1dd4162` | `00afc7e439ce` 1914 (nuovo) | 4475 / 224 | **126.0 s, 114.8 s (FAILED), 87.4 s** |
| `61d3e198f2fc` | `a8b901663d69` 1914 (vecchio) | 1943 / 21 | 71 s, 43 s |
| `2467cae94a4c` | `496e7ca606f1` 1815 | 243 / 15 | 30 s, 28 s |

## 2. Causa (diagnosi, con misure)

**A) Dominante — catena LLM sequenziale + repair quasi sempre necessario.**
Un AVANZA non è una chiamata ma **3–7 chiamate sequenziali** allo stesso provider:
`converter` (1) → `jump` (1) → **`repair reactions` (0–1)** → chat NPC di reazione (0–4).
Il modello configurato è **`glm-5.3-flash` su `https://ollama.com/v1`** (`llm.config.json`,
`timeoutMs` 240–300 s, `retries: 2`): la latenza per chiamata è del provider (misurata
25–30 s sul mondo nuovo, ~10 s sul vecchio) e va moltiplicata per il numero di chiamate.

Nell'ultima finestra di log (20 000 righe): **25 batch processati, 34 conversioni, 13 repair
richiesti, 7 fallimenti** (`Error processing action batch`) → ~22% di avanzamenti persi.
La causa dei repair è sistematica e leggibile nel log: il modello **omette `optionId` e
spesso `actorId`** nelle `reactions`
(`Repair reactions richiesto: missing_option_id, missing_option_id, missing_actor_id, …`).
Quando anche il repair non ricompone gli attori ammessi dal motore, il turno è **fail-closed**:

```
LLMContractError: llm_contract_error: reaction repair: evento 0 ha perso la reazione
di un attore ammesso dal motore (AUT, RUS, SRB → AUT, DEU, RUS, SRB)
```

**B) Secondaria ma reale — costo CPU per turno cresciuto col mondo (e fixabile ora).**
Il costo CPU non è nella simulazione (`WorldStateEngine.accounts(4475 regioni)` = **43 ms**),
ma nei **costruttori di contesto** chiamati più volte per turno
(`buildGameData` da `TurnPipelineService` e da `getSuggestions`/`getAdvisor`/`getGovernmentVoices`).
Misura diretta su `GameDataService.build()`:

| | 1914 nuovo (4475/224) | 1914 vecchio (1943/21) |
|---|---|---|
| `buildGameData()` completo | **~2500 ms** | ~500 ms |
| di cui `buildNpcStrategicDossiers` | **3361 ms** | 419 ms |
| di cui `buildReactionContext` (core) | 762 ms | 61 ms |
| Caricamento sessione | 2–7 s caldo / 34 s freddo | — |
| Tick live (30 s) | 175–193 ms | 43–70 ms |

Causa esatta: pattern **O(politie × regioni) per ogni testo**.
`WorldIntelService.mentionedNpcPolityIds()` ricostruiva, **dentro** il doppio ciclo
testi × proprietari, sia l'elenco delle regioni di quel proprietario
(`Array.from(regions.values()).filter(...)` = 4475 elementi) sia la lista di alias
normalizzati, sia una `new RegExp` per proprietario. Su 224 politie × più testi ×
più chiamate per turno diventano decine di milioni di operazioni per turno.
`buildNpcStrategicDossiers` lo chiamava poi una volta **per evento e per politia**
(`recentStrategicMemory`), moltiplicando ancora il costo.
Dimensione del prompt: **non** è la causa — 64 721 caratteri (nuovo) vs 61 319 (vecchio),
solo **+5%**.

## 3. Intervento

Refactor **prestazionale puro** in codice **non congelato** (`src/game/WorldIntelService.ts`),
**senza alcun cambio di semantica**:

1. nuovo `groupRegionsByOwner()` — indice regioni→proprietario costruito in **un solo passaggio**;
2. `mentionedNpcPolityIds()` ora costruisce **una volta** i `PolityMatcher`
   (`{ id, aliases, coded }`: nome registro + nome italiano curato + nomi delle regioni +
   regex del codice stato) e li riusa per tutti i testi; `matchesText()` conserva
   le stesse identiche regole (incluso il fallback aggettivale «cecoslovacca»);
3. `recentStrategicMemory(polityId, limit, matcher?)` usa **il solo matcher di quella politia**
   invece di riesaminare tutte le politie per ogni evento;
4. `nationalMilitaryPower`/`nationalEffectiveMilitaryPower`/`hostileNeighbourCount`
   accettano l'indice condiviso opzionale; `buildNpcStrategicDossiers` lo passa e condivide
   anche la cache di `frontierOwnerIds` fra le ancore.

## 4. File

- `backend-nest/src/game/WorldIntelService.ts` — indice + matcher riusabili (unico file di codice toccato).
- `backend-nest/tests/world-intel-perf.test.ts` — **nuovo**: identità di output contro la
  versione pre-refactor copiata *verbatim* da `git HEAD`.

## 5. CORE ENGINE FREEZE

`core/simulation/**` **non toccato**. Resta però un collo di bottiglia **dentro il congelato**,
documentato e **non applicato** — `core/simulation/ReactionContext.ts`, funzione
`mentionedPolityIds()` (righe ~169-190) e il filtro a riga ~316:
stesso identico pattern (`Object.values(input.regions).filter(...)` e `new RegExp` costruiti
**dentro** il ciclo testi × proprietari). Misurato: **762 ms** per `buildReactionContext`
(1914 nuovo) contro 61 ms (vecchio), ed è chiamato in `GameDataService.build()` →
**~3 s di CPU per turno** solo da qui.

**Proposta pronta (da approvare prima di toccare il congelato):** applicare in
`ReactionContext.ts` la stessa tecnica — indice `regionsByOwner` costruito una volta e
matcher/alias precompilati fuori dal ciclo dei testi. Nessuna modifica a decisioni,
contratti, `reactions` o stato: output identico, verificabile con lo stesso test di identità.
Atteso: 762 ms → decine di ms. **STOP qui come da vincolo: attendo l'autorizzazione.**

## 6. Test

- **Nuovo** `tests/world-intel-perf.test.ts` — 5 test: `mentionedNpcPolityIds` (multi-testo,
  singolo testo, lista vuota, ordine invertito), `nationalMilitaryPower`,
  `nationalEffectiveMilitaryPower`, `hostileNeighbourCount`: tutti confrontati con la
  implementazione precedente su un mondo sintetico (40 politie × 30 province, codici noti e
  ignoti al registro, forme aggettivali, codici stato).
- **Quality gate:** backend **1159/136** file verdi (1154 + 5 nuovi), frontend **318/49**,
  `tsc --noEmit` 0 su backend e frontend, build backend e frontend OK,
  **e2e mock 23 passed**.

## 7. Prima → dopo

| Misura (1914 nuovo, 4475/224) | Prima | Dopo |
|---|---|---|
| `buildNpcStrategicDossiers` | **3361 ms** | **249 ms** (13.5×) |
| `buildGameData()` completo | ~2500 ms | ~1000 ms (2.5×) |
| `mentionedNpcPolityIds` (5 testi) | 510 ms | 118 ms |
| `mentionedNpcPolityIds` (1 testo) | 40 ms | 7 ms |
| CPU per turno (≈4 build/turno) | ~10 s | ~4 s |

Su 1914 vecchio (1943/21): dossier 419 → 107 ms, `buildGameData` ~500 → ~185 ms.
Su 1815 (243/15): 5 → 4 ms (irrilevante, come atteso).

## 8. Limiti (dichiarati, non aggirati)

- **La latenza dominante resta il provider.** Il tempo di AVANZA (87–126 s) è per la
  maggior parte **attesa di rete verso `ollama.com`** moltiplicata per 3–7 chiamate
  sequenziali. Il fix CPU toglie ~6 s su ~100 s: migliora, non risolve.
- **Il vero moltiplicatore è il repair delle reactions**: il modello omette `optionId`/`actorId`
  quasi a ogni turno → una chiamata LLM in più (25–30 s) e, quando il repair non è
  ricomponibile, il turno **fallisce** (7 su ~32 nell'ultima finestra).
  Le due vie — (a) completamento **deterministico** di `actorId`/`optionId` dal contesto
  ammesso invece di una seconda chiamata LLM, (b) tolleranza *fail-closed* con messaggio
  all'utente invece della perdita del turno — vivono in `core/simulation/ReactionDecisions.ts`
  e `prompts/simulation/**`: **congelate**, quindi solo proposte, con evidenza, in attesa di autorizzazione.
- Restano pattern O(politie × regioni) minori e **limitati** (non fixati qui) in
  `DiplomacyService.chatParticipantVarsFor` (per chat, 1–4 per turno) e nel filtro
  `allRelations`; e il caricamento sessione (34 s a freddo su 4475 regioni) che dipende da
  `world.repository.getRegions` (idratazione una tantum).
- Non ho toccato: caching di `buildGameData` per turno, dimensionamento dei dossier,
  numero di chat NPC per turno, timeout/retry del provider, modello LLM.
- Le mappe provinciali restano geometricamente moderne (limite già dichiarato in MAP-COMPLETE):
  su 1914 il mondo ha 224 politie contro 21 curate, quindi più attori ammessi alle reazioni.

# REPORT — MILITARY-REACTION (i paesi devono reagire alle mosse militari)

Base: `main` = `3a11c26`. Riferimento utente: turno 6 / 05/1816, Confederazione Germanica —
«Poi ho creato un esercito: i paesi devono reagire.»

---

## 1. Problema trovato (causa reale sul codice)

Il contesto di reazione (`buildReactionContext`) decide attori e opzioni materialmente ammesse.
Sul gioco reale dell'utente (`246c9cda8b8f`, mondo `9b3407c2572c`, 243 regioni) una mossa
**materiale** — creare/mobilitare forze — non produceva **nessun attore politico** a cui reagire.

Misura diretta (probe sul DB dell'utente, copia di sola lettura):

| Caso (testi del turno 6 e varianti materiali) | Trigger | Attori politici nel contesto |
|---|---|---|
| 9 ordini reali del turno 6 | `player_action` | `MCO, CHE, DNK, ESP, FRA, GBR, NLD, NOR` — **nessun vicino reale** |
| «Creiamo un esercito permanente a Francoforte…» (nessun nome) | `player_action` | **nessuno** (solo fazioni interne) → `maxReactions: 1` |
| «Mobilitiamo il battaglione… e spostiamolo al confine» | `player_action` | **nessuno** (solo fazioni interne) |

Due cause concrete, entrambe verificate:

**A) Le regioni di sessione avevano perso l'adiacenza.** `session-registry.ts` costruiva
`regionStates` copiando id/nome/colore/owner/popolazione/PIL/forze/oggetti/svgPath ma
**non `borders`** (né `status`, né `coastal`). Misura: nel database `167/243` regioni hanno
bordi validi (la Confederazione Germanica ne ha 9), nella sessione caricata **`0/243`**.
Conseguenza a catena: `frontierOwnerIds(input)` (che usa `region.borders`) restituiva
l'insieme vuoto → nessun vicino → il tetto di 8 attori veniva riempito da
`Object.keys(relationships)`, cioè dalla **matrice diplomatica completa** (ogni politia con un
rapporto registrato *con chiunque*): da lì MCO, ESP, NOR… cioè esattamente gli «attori lontani»
che il piano vieta. La stessa mappa di regioni esisteva già corretta nel fallback di
`SessionBootstrapService`, quindi era una **duplicazione** che aveva dimenticato il campo.

**B) La postura militare materiale non entrava nel contesto.** `ReactionContextInput` non ha
alcun campo per fatti materiali: l'unica causa possibile è il **testo**
(`currentActions` → `focusTexts` → processi → pressioni → evento precedente). Una unità creata,
una mobilitazione avviata o un reparto spostato esistono solo in `region.objects` e non erano
mai letti. Verifica puntuale: `TriggerKind` dichiara `military_development`, ma **nessun codice
lo produce** (`grep` su `src/`: l'unica occorrenza è la definizione del tipo).
Le `mapChanges` militari del turno **non sono disponibili** quando il contesto viene costruito:
il contesto è un *input* del run (`TurnPipelineService` ~riga 190, `buildGameData(...)` prima di
`promptEngine.runSimulation`), quindi le mosse materiali del turno corrente non possono esistere
ancora; ciò che è disponibile è la postura materiale **già a terra** all'inizio del turno.

## 2. Correzione applicata (fuori dal freeze)

1. **Adiacenza ripristinata** — `src/session-registry.ts`: la mappa delle regioni è ora
   costruita da un'unica funzione `regionStatesFromDb(worldId, gameId)` che trasferisce
   `borders`, `status` e `coastal`; le due copie duplicate sono state unificate.
2. **Solo i rapporti del giocatore entrano nel contesto** — nuovo modulo puro
   `src/game/reactionInputs.ts` (`playerCentricRelationships`), usato da `GameDataService`
   al posto della matrice completa. La matrice è simmetrica, quindi lo stance della controparte
   verso il giocatore resta leggibile anche se registrato nel verso opposto; i rapporti fra
   **terze** politie non creano più attori. Il motore continua a decidere ruolo e opzioni.
3. **Postura militare materiale nel contesto** — nuovo read model puro
   `src/game/MilitaryPosture.ts` (`playerMilitaryPosture` + `renderMilitaryPosture`):
   elenca le formazioni realmente presenti del giocatore (tipo, stato `in formazione`/`operativo`,
   regione), le più fragili per prime, max 6, **nessun numero inventato** (ogni riga è un oggetto
   di `region.objects`). `GameDataService` lo appende al **testo** del contesto di reazione,
   accanto ad attori e opzioni: la forma strutturata `reactionContextData` **non cambia**, quindi
   contratto `actorId`/`optionId` e validator restano intatti.

Effetto osservabile sul caso reale (probe): con i bordi ripristinati e i rapporti filtrati, una
mossa militare senza nomi produce come attori i **vicini reali** (AUT, FRA, POL…) con le opzioni
di motore `:mobilize`, `:counter`, `:negotiate`, `:reject`, `:condition`, `:mediate`, `:embargo`;
nessun attore lontano con rapporto estraneo.

## 3. File modificati

- `backend-nest/src/session-registry.ts` — `regionStatesFromDb` (borders/status/coastal), dedup.
- `backend-nest/src/game/reactionInputs.ts` — **nuovo**, puro: `playerCentricRelationships`.
- `backend-nest/src/game/MilitaryPosture.ts` — **nuovo**, puro: postura materiale + rendering.
- `backend-nest/src/game/GameDataService.ts` — rapporti player-centric + blocco postura nel contesto.
- `backend-nest/tests/military-reaction.test.ts` — **nuovo**, 5 test.

## 4. CORE ENGINE FREEZE

`core/simulation/**` **non toccato**: `ReactionContext.ts` resta invariato (letto e riusato).
La correzione agisce solo sul punto di **alimentazione** del contesto, come previsto dal piano.

**Proposta documentata (non applicata, richiede autorizzazione perché modifica il congelato):**
1. `ReactionContextInput` accolga i fatti materiali (`militaryFacts?: TriggerInput[]`) e
   `buildReactionContext` produca `trigger.kind = 'military_development'` quando non esiste un
   ordine testuale ma esiste una mossa militare materiale del turno precedente. Oggi
   `military_development` è un tipo **dichiarato e mai prodotto** (codice morto).
2. La stessa normalizzazione di alias/regex ora presente in `WorldIntelService` va applicata a
   `mentionedPolityIds()` (762 ms per build misurati, ~3 s/turno): stessa identica tecnica,
   output identico.
Evidenze: sezione 1 (A/B) e `docs/implementation/ADVANCE-LATENCY-report.md`.

## 5. Test eseguiti (esito reale)

Nuovo `backend-nest/tests/military-reaction.test.ts`:
1. `playerCentricRelationships`: tiene solo i rapporti del giocatore, rispecchia lo stance,
   non sovrascrive valori reali, gestisce `undefined`;
2. mossa militare **senza nomi** → attori = vicini reali (AUT, FRA, POL) con `:mobilize`/`:counter`,
   rottura esplicita = 'confina', **nessun** RUS/GBR; la stessa costruzione con la matrice completa
   (comportamento precedente) **contiene** RUS e GBR → prova del bug;
3. `playerMilitaryPosture`: solo le formazioni del giocatore, `mobilization` → `forming` e primo in
   elenco, `plannedType` → tipo effettivo, rendering vuoto senza formazioni;
4. limiti: max 6 formazioni, mondo senza unità;
5. bootstrap di sessione da DB: `borders` e `status` presenti dopo la ricostruzione, vicini
   reali leggibili (fallirebbe con la mappatura precedente, che perdeva `borders`).

Suite completa backend: **137 file / 1164 test verdi** (erano 136/1159). Frontend non toccato in
questa PR. Quality gate completo (frontend, tsc, build, e2e) eseguito a livello di branch prima
del merge.

## 6. Limiti residui

- Il `trigger.kind` resta `player_action` (il testo dell'ordine) finché non si applica la proposta
  al punto 4.1: il **gancio materiale** è nel contesto (postura + attori + opzioni), non nel
  vocabolario del trigger.
- La postura elenca al massimo 6 formazioni e solo quelle **del giocatore**: non descrive gli
  arsenali né le forze NPC (fuori ambito).
- I fatti materiali entrano nel **testo** del contesto, non nella forma strutturata: il validator
  non li vede (scelta deliberata: nessun cambio di contratto).
- Il ripristino di `borders`/`status`/`coastal` migliora anche altre letture di adiacenza
  (`hostileNeighbourCount`, piazzamenti di frontiera, vicini nelle pressioni): effetto positivo
  atteso, ma coperto dai test esistenti solo indirettamente.
- Resta vero che la reazione nasce da un giudizio dell'LLM fra le opzioni ammesse: il motore
  garantisce **chi** e **cosa è possibile**, non che il modello risponda sempre (il repair delle
  `reactions` è un tema separato, documentato in `ADVANCE-LATENCY-report.md`).

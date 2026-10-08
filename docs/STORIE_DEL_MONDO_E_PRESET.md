# I Filoni del Preset — uno standard per ogni mondo (H00–H11)

> **Stato:** diagnosi + piano. **Nessun codice scritto.** Le fasi attendono l'ok dell'autore.
> **Base misurata:** `main` @ `7dc6525` (8 ottobre 2026).
> **Prefisso di fase:** `H` (libero).

---

## 0. La richiesta e le decisioni

L'autore ha scritto:

> «Il consulente deve generare proposte come fa paxhistoria, il sistema deve conoscere il contesto
> dato dal preset e narrare la storia. Adesso è troppo deterministico e si basa solo sui dati del
> dossier nazionale. Esempio: la Palestina nel Millennium (2000) aveva conflitti interni, Israele
> e USA che pressano per il disarmo di Hamas, politica religiosa, la questione Gerusalemme ecc.
> Adesso tutto questo non c'è.»

E poi, decisivo per questo piano:

> «**L'importante è che deve funzionare con tutti i preset presenti e futuri. Creiamo uno
> standard.**»

Tre decisioni prese dall'autore:

1. **Priorità:** il *mondo che conosce il preset* (non il Consulente propositivo, non la
   narrazione: sono tre sintomi di una causa sola).
2. **Il contesto del preset è una timeline scritta** (`storylines.json` autoriale), non generata
   dall'IA.
3. **Deve essere uno standard:** vale per ogni preset, presente e futuro — non una feature per
   Millennium.

Questo terzo punto è il requisito che comanda il resto: lo standard non è «un nuovo file», è un
**contratto** che il loader, il trasporto (zip), l'autoring e la verifica devono tutti conoscere.
Un file che il loader accetta ma che lo zip scarta non è uno standard: è una trappola.

---

## 1. Diagnosi misurata

### 1.1 Il preset non ha alcun modello del mondo

Il «preset» ha **solo campi testuali**. Verificato in `backend-nest/src/utils/preset-loader.ts`
(interfaccia `PresetPackage` righe 42-92, validazione 115-194):

`id`, `name`, `description`, `start_date`, `country_codes`, `base_prompt` (obbligatorio),
`historical_accuracy`, `countries[]`, `country_colors`, `prompts{}`, `simulation_rules` (da
`rules.md`), `lore` (da `lore.md`), `map_detail`, `map_grouping`, `map_base`, `fixture`,
`author`, `version` (più i campi calcolati al caricamento `has_custom_map`, `flags`, `source`).

**Non esiste**, come **campo del preset**, alcun `storylines`, `context_events`,
`scenario_events`, `factions`, `issues` o `narrative_context` (grep: zero occorrenze **fra i
campi del preset**). Nota: «fazioni» e «questioni» esistono come **sottosistemi a runtime**
(`game_faction_memory`, le `CouncilIssue`), ma **non** come conoscenza dichiarata nel preset. Il
mondo può descrivere il proprio passato **solo come prosa** dentro `base_prompt`/`lore.md`.

Conseguenze sull'esempio dell'autore:

- `millennium_dawn` **non ha né `lore.md` né `rules.md`**, ha `"prompts": {}`, e la sua prosa di
  scenario sta nei **1462 caratteri** di `base_prompt` (misurato). I conflitti vi compaiono in
  modo **generico** («la seconda intifada tra Israele e Palestina», «l'Afghanistan sotto i
  talebani con Al-Qaeda in ascesa»): sono l'incipit di un paragrafo, **non uno stato tracciato**.
- **`millennium_dawn` ha però un catalogo `simulation/` strutturato** (14 polity, attori,
  facilities, giacimenti). Quella è la parte **materiale** (numeri); **non** contiene alcun
  riferimento a Hamas/Gerusalemme/intifada (grep: zero). Manca dunque il modello **politico**,
  non quello materiale.
- **`PSE` non è fra i `country_codes` di `millennium_dawn`** (c'è `ISR`, non `PSE`), ma **non è
  vero che la Palestina «non c'è»**: `country_codes` è l'elenco delle nazioni *consigliate* (non
  delle giocabili, da MAP-COMPLETE), e la mappa base (`map_base = pax_modern_provinces`) ha
  **32 province con `country = PSE`** (es. Rafah). La Palestina è nell'**ambiente**, non nei
  metadati del preset.
- `pax_modern_provinces` cita Palestina/Hamas in `preset.json` e `rules.md`, **e** ha `PSE` fra i
  `country_codes` e in `countries[]` (quindi anche dato strutturato). `modern_world_provinces`
  invece **non cita affatto** la Palestina (una sola occorrenza di «Jerusalem» in `map.geojson`).
  La distanza non è «prosa vs dato», è **presenza dell'ambiente vs assenza di un filone tracciato**.

### 1.2 Il Consulente vede solo il proprio paese

Percorso misurato in `backend-nest/src/core/government/RealityAdvisor.ts`:

- la cornice del preset entra come **`[CONTESTO INIZIALE DEL PRESET — scenario, non inventario
  corrente]`** (riga 382, aggiunta dal commit #240). La `VERIFIED FACT POLICY` (righe 40-59)
  **vieta** di trattarla come fatto corrente.
- Ogni proposta è validata contro `buildRealitySignals(snapshot)` e
  `buildCouncilProposalAnchors(snapshot)`. Ma `VerifiedWorldSnapshot` è la realtà **del solo
  paese del giocatore**: `polityId = game.playerPolityId`, regioni/unità/fronti filtrati al
  player.
- Un altro paese entra **solo** come etichetta di relazione (`hostile` → un segnale) o nella sua
  **baseline storica del passato** (max 3 polity nominate nella domanda, righe 390 e
  `game-session.ts:3551-3553`).

Quindi il Consulente **non può** proporre nulla ancorato alla situazione *corrente* di un altro
paese, e tantomeno a un filone storico (Hamas/Gerusalemme) che non è né nel suo snapshot né
nella sua baseline.

### 1.3 L'abbozzo del «respiro del mondo» esiste ed è spento

`backend-nest/src/prompts/simulation/worldPulse.ts` propone fino a 3 eventi per nazioni **non
giocate**, con trigger verificabili. Ma:

- è **flag OFF di default** (`llm/narrativeFlags.ts:43` → `narrative.worldPulse: false`);
- è **solo narrativo**: `validateNarrativeOnlyWorldPulseEvent` respinge ogni mutazione materiale
  (mobilitazioni, costruzioni, embarghi *applicati*, guerre iniziate);
- gli eventi che produce **entrano nella cronaca/timeline persistita** (`TurnPipelineService.ts:891-906`),
  ma il suo **stato interno** (candidati/trigger) **non è persistito** e **non è letto dal frontend**
  (grep `frontend/src`: zero occorrenze);
- **non «avanza»**: ricalcola i candidati ogni turno dai segnali correnti.

È un abbozzo del «respiro», non un sistema di filoni storici. Le altre sorgenti «mondo» sono
simili: `NPC_STRATEGIC_PROFILES` (profilo per codice ISO), `activeCommitments` (ciò che la
partita ha firmato), `ReactionContext`, il dossier NPC.

### 1.4 La continuità del mondo esiste: l'agenda NPC — ma è *derivata*, non *scritta*

`backend-nest/src/core/simulation/NpcAgenda.ts` mantiene obiettivi NPC **persistenti** con
chiave stabile, priorità, progresso, data di revisione e motivo (tabella `game_npc_agenda`,
`database.ts`). Sono ricalcolati da `refreshNpcAgenda` (`game-session.ts:3351-3367`), memoizzato
per turno.

**Ma gli obiettivi sono generici**: `contain-hostile`, `preserve-alliance`, `trade-access`,
`build-capability`, `stabilize-economy`, `reduce-dependency`, `isolate-rival`. Sono **derivati
dallo stato** del momento, non da un piano storico. Non c'è alcun `disarmare-Hamas`, alcun
`questione-Gerusalemme`. Il motore ha la **macchina della continuità**, ma non la **trama**.

**E la tabella è *game-scoped*, non *world-scoped*.** Misurato: `game_npc_agenda` ha chiave
primaria `(game_id, branch_id, id)`, un solo FK verso `games(id)`, **nessuna colonna `world_id`**
(`database.ts:902`; il repository filtra sempre per `game_id`/`branch_id`). La tabella `worlds`
ha invece `template_id` (migrazione a `database.ts:68`) proprio per legare un mondo al suo preset.

### 1.5 Cosa fa Pax Historia, misurato dai riferimenti in repo

`docs/ref/original/actions.txt` (il suggeritore di azioni di Pax):

- riceve la **descrizione completa della mappa** (`GRAND_MAP_DESCRIPTION_NO_CITY`: tutte le
  polity, regioni, battaglioni) e **l'intero storico degli eventi** («Most of these should be
  based on the game's timeline and history»);
- produce **6–9 «Topics of Concern»**, ognuno con **2–5 azioni concrete** (Titolo + Contenuto,
  ≤ 30 parole), ancorate a mappa e cronaca.

`docs/ref/original/desript_to_act.txt` inietta `WORLD_BEFORE_ROUND_ONE_TEXT` e
`HISTORICAL_PRESET_SIMULATION_RULES` come **primo input di ogni conversione**.

Il Consulente di World Story oggi produce card di **discussione** (`council_issue`) **senza menu
di opzioni**, e vede **solo il proprio snapshot**.

### 1.6 Il meccanismo «nazione a prescindere dal preset» **esiste già in parte**

Requisito dell'autore (8 ottobre 2026): *«è impossibile che io scriva la storia di tutte le
nazioni, ma la storia della nazione che ho scelto deve essere conosciuta dall'LLM a prescindere
dal preset.»* Misurato: **questo meccanismo esiste ed è già quello giusto** — va esteso, non
inventato.

**`getPolityHistoricalBaseline`** (`game-session.ts:3564-3595`, tabella
`game_polity_historical_baselines`) genera via LLM, **da sola conoscenza storica reale**, il
passato di **qualsiasi polity**:

- **indipendente dal preset**: usa `countryRepository.findByCode(polityId)?.name`
  (`country-facts.ts`) e `worldName`, non i campi del preset — quindi una nazione senza lore,
  senza `country_codes` e perfino **senza geometria** (Israele, la Palestina) ha comunque la sua
  storia;
- **per polity, non per giocatore**: `getPolityHistoricalBaseline(polityId)`; «One immutable
  background per polity/divergence, not one per player or branch» (riga 3563);
- **con gating di confidenza**: la `HISTORICAL_BASELINE_SYSTEM` (`HistoricalBaseline.ts:29-35`)
  accetta **solo** le entry marcate `"high"`; «se non conosci abbastanza fatti affidabili,
  restituisci poche entry o nessuna»;
- **chiavata `(polityId, startDate)`**, persistita, con timeout di 12 s (`HISTORICAL_BASELINE_TIMEOUT_MS`).

**Il buco preciso**, ed è quello che l'autore descrive: quella baseline copre **solo
`REAL HISTORY < START DATE`** — il **passato** («come Israele è arrivata al 2000»). Non copre
**cosa la nazione affronta alla data di partenza** («Israele nel 2000 ha il disarmo di Hamas,
Gerusalemme, le ispezioni in Iraq»). La `HISTORICAL_BASELINE_RULE` (`HistoricalBaseline.ts:20-27`)
lo dice esplicitamente: «La HISTORICAL BASELINE spiega il passato, non fornisce asset o effetti
attuali».

Quindi la forma dell'architettura è già decisa dai fatti: **il preset copre una parte**
(i filoni *regionali*, che una singola nazione non può dedurre — Hamas/Gerusalemme sono un nodo
Israele–Palestina–USA, non di Israele sola), e **una baseline dello stato iniziale per-nazione**,
generata dall'IA come quella storica, copre **tutte le altre** nazioni. «Per nazione, non per
preset» — che è esattamente la divisione che l'autore ha chiesto.

I tre sintomi sono **una sola causa**: *il mondo non ha un modello del contesto del preset, e il
Consulente legge solo il proprio ombelico.*

Il piano attacca **prima la causa**: dare al mondo un modello dei **Filoni del Preset** (storia
scritta, tracciata, che avanza), **come standard di piattaforma**, e poi collegarvi Consulente e
narrazione.

---

## 3. Uno standard, non una feature — dove deve vivere

Il requisito «tutti i preset presenti e futuri» è stato misurato, non assunto. Perché una cosa
sia **standard** in questo progetto, deve esistere in **cinque** posti; se ne manca uno, il
preset nuovo o importato la perde:

| # | Punto | Dove | Cosa manca oggi |
|---|---|---|---|
| 1 | **Lettura** | `preset-loader.ts` (`loadFromDir`, `validatePresetJson`, `PresetPackage`) | legge solo `lore.md`/`rules.md`; nessuna nozione di `storylines` |
| 2 | **Trasporto** | `utils/preset-zip.ts` | `ALLOWED_ROOT_FILES = {preset.json, rules.md, lore.md, map.geojson}` (riga 44) e `addIfExists('…')` (96-99): un `storylines.json` sarebbe **scartato in silenzio** in export/import |
| 3 | **Autoring IA** | `routes/presets.routes.ts` | il contratto di generazione (righe 187-201) elenca i campi che l'IA produce; la scrittura (riga 137) conosce solo `lore.md`/`rules.md` |
| 4 | **Verifica** | un controllo di conformità | non esiste alcun lint che passi **tutti** i preset e dica chi è conforme |
| 5 | **Documento** | `docs/` | non c'è una specifica versionata dello standard |

Questo è il cuore della risposta all'autore: **lo standard è il contratto, e il contratto vive in
tutti e cinque i posti.** H02 e H03 sono le fasi che lo rendono tale.

---

## 4. Lo standard del filone

### 4.1 Il file e la forma

Nuovo file, per convenzione accanto a `lore.md`/`rules.md`: **`data/presets/<id>/storylines.json`**.
Opzionale: **un preset senza il file resta valido** (retrocompatibilità, H-I7). Il file è
**versionato** perché lo standard possa evolvere senza rompere i mondi vecchi.

```jsonc
{
  "version": 1,
  "as_of": "2000-01-01",
  "storylines": [
    {
      "id": "levante-disarmo-hamas",           // stabile, kebab-case, unico nel preset
      "title": "Il disarmo di Hamas",
      "domain": "esteri",                      // mappa sulla sedia del gabinetto
      "parties": ["ISR", "PSE", "USA", "EGY"], // polity coinvolte (id di Mappa, non country_codes)
      "region": "Levante",                     // area leggibile, non un id tecnico
      "state": "aperto",                       // aperto | congelato | risolto | divergente
      "pressure": 3,                           // 1 marginale, 2 rilevante, 3 critico
      "active_from": "2000-01-01",             // opzionale: dormiente prima di questa data
      "active_until": null,                    // opzionale: oltre, non si apre
      "summary": "Israele e gli Stati Uniti premono per il disarmo; l'Autorità Palestinese è
                  divisa; la questione di Gerusalemme resta il nodo politico e religioso.",
      "trajectory": "Se nessuno lo devia, il nodo scivola verso lo scontro aperto entro l'anno.",
      "triggers": [                            // ciò che tiene il filone «acceso»
        "attentato o raid a Gerusalemme",
        "pressione diplomatica USA sull'ANP",
        "negoziato di Camp David"
      ]
    }
  ]
}
```

### 4.2 Le regole dello standard (vincolanti)

1. **Il filone dà significato e trigger, mai numeri.** Le cifre restano del motore
   (invariante `project-consulente-grafici`).
2. **`parties` sono id di Mappa, non `country_codes`.** Un filone può nominare una polity che non
   è consigliata (la Palestina ha 32 province e non è in `country_codes` di Millennium).
3. **Il filone non è un fatto.** Gerarchia (§4.4): è un **seme autorevole** del preset,
   **subordinato allo stato della partita**.
4. **`active_from`/`active_until` permettono i filoni dormienti** — necessari per un mondo che
   copre decenni (un filone del 2003 in un preset del 2000).
4-bis. **`trajectory` è opzionale** e dice **dove il nodo andava** se nessuno lo deviava (§4.7).
   È una **tendenza**, mai una profezia: gli NPC la seguono, il giocatore la devia.
5. **`domain`** mappa la sedia del gabinetto (già esiste `CabinetSeat`/`SEAT_WORLD_EMPHASIS`),
   così il filone arriva al ministro giusto.
6. **`id` stabile**: è la chiave con cui il filone si aggancia all'obiettivo NPC e alla cronaca.
7. **Zero filoni è valido.** Un preset può dichiararne zero o nessuno.

### 4.3 La forma del file: JSON Schema condiviso

Lo standard include un **JSON Schema** (`version: 1`) usato sia in scrittura (autoring) sia in
lettura (validazione) sia in verifica (conformità). Una sola definizione, tre usi — così non
nascono «due verità» sul formato (l'errore che il progetto ha già visto altrove).

### 4.4 La regola di autorità (emenda la policy)

```
STATO CORRENTE DEL MOTORE  >  STORIA DELLA PARTITA  >  FILONE DEL PRESET  >  STORIA REALE
```

Il motore **verifica** il filone contro lo stato: un filone superato dalla partita (es. pace
firmata) **non viene riproposto**. Il filone **non** è invenzione del modello → non viola il
divieto «non inventare crisi», ma la `VERIFIED_FACT_POLICY` va **emendata esplicitamente** per
nominarlo come quarta fonte (H05).

### 4.5 Dove si innesta il motore (nessun sistema parallelo)

- **Il presupposto: ogni partita ha la sua storia.** Il preset è **identico per tutti** (stesso
  modello di partenza); i filoni vivono **per partita**. Da qui: **nessun avanzamento condiviso**
  fra due partite dello stesso mondo, e **nessuna colonna nuova** — la catena
  `games.world_id → worlds.id → worlds.template_id → preset` è già sufficiente.
- **Semina alla partenza della partita**: i filoni del preset (filtrati per `active_from`/
  `active_until`) diventano obiettivi NPC iniziali **di quella partita**.
- **Avanzamento**: nel seam esistente `refreshNpcAgenda` (`game-session.ts:3351-3367`, **esce in
  strict**), con una politica `storyline-<id>` che tiene il filone «acceso». La macchina della
  continuità c'è già; si aggiunge la trama.
- **Indipendente dalla nazione scelta.** Il giocatore sceglie la nazione e si parte: i filoni ci
  sono **comunque**, anche se il giocatore non tocca nessuno dei loro protagonisti. Un filone si
  disegna per **chi lo subisce** e per chi lo guarda — mai *attorno* al giocatore.
- **Consulente**: i filoni entrano come **ancore** (`anchorKeys`, il meccanismo di #240) e
  diventano proposte — pertinenti alla nazione del giocatore se la toccano, altrimenti contesto.
- **Narrazione**: il motore dà al modello il **delta** dei filoni; il modello **sceglie** cosa
  narrare.

### 4.6 La seconda fonte: la **situazione iniziale della nazione**

Il filone è **regionale e curato**: copre i nodi che una singola nazione non può dedurre
(Hamas/Gerusalemme sono un intreccio Israele–Palestina–USA). Ma l'autore ha posto un limite che
conta: *«è impossibile che io scriva la storia di tutte le nazioni»*. E la storia della nazione
**scelta** deve essere conosciuta **a prescindere dal preset**. Quindi il contesto del mondo ha
**due fonti**, non una:

| | **Filoni del preset** (`storylines.json`) | **Situazione iniziale della nazione** |
|---|---|---|
| Chi la scrive | **tu** (curata) | **l'IA**, come la `HistoricalBaseline` |
| Copre | i grandi nodi storici/regionali | **qualunque** nazione, anche senza geometria |
| Esempio | disarmo di Hamas, Gerusalemme | «Israele nel 2000: seconda intifada, coalizione, economia» |
| Dove vive | `data/presets/<id>/storylines.json` | generata e persistita, come la baseline storica |

**Il modello da copiare esiste già** (§1.6): `getPolityHistoricalBaseline` genera il **passato**
per-polity dall'IA, con gating `"high"`. La nuova sorgente è la stessa macchina, applicata
all'**inizio** invece che al passato — con una **regola di divisione**:

> **I filoni del preset sono autorevoli sui nodi che il preset ha scelto di fissare.** La
> situazione iniziale generata **non può contraddire** un filone attivo (se il preset dice «Hamas
> non disarmato», la situazione di Israele non dice il contrario). Fuori da quei nodi, l'IA è
> libera di generare la situazione della nazione dalla propria conoscenza storica.

Così **il preset copre una parte** (i filoni), e **tutto il resto** lo copre l'IA per la nazione
scelta — che è la forma che l'autore ha chiesto.

**Dove entra nel percorso:** nel Consulente, come `presetContext` — ma la nuova sorgente è la
**situazione della nazione**, non il preset. Per il **giocatore sempre**; per gli NPC del teatro
(3 polity nominate, come già la baseline storica).

**Gating di confidenza (invariante ereditata).** Come la baseline storica accetta solo le entry
`"high"`, la situazione iniziale deve dichiarare la propria confidenza: un fatto incerto **non
entra**. E vale il **fail-closed** del progetto: meglio nessuna voce che una inventata.

### 4.7 I tre tempi — passato, presente, futuro

L'autore (8 ottobre 2026): *«la mia idea era proprio quella di dare un contesto **passato,
presente e anche futuro** del mondo; ovvio che il futuro viene influenzato dalle scelte del
giocatore e dal mondo che reagisce a quelle scelte.»*

| Tempo | Cos'è | Chi lo produce | Stato |
|---|---|---|---|
| **Passato** (`real history < start`) | come ogni nazione è arrivata qui | IA (baseline) | **esiste già** (§1.6) |
| **Presente** (alla `start_date`) | cosa ogni nazione affronta | IA (**H05**), filoni (**H04**) | da fare |
| **Futuro** (`>= start`) | dove il mondo **stava andando**, come **tendenza di default** | IA + filoni (**H06**) | da fare, **in tensione con una regola esistente** |

**Il modello è quello di Pax**, testuale in `docs/ref/original/forward.txt:92-94`:

> «*All* polities except *POTENTIALLY* for the player's polity … will **behave historically** and
> go for historical goals and objectives. … the polities you must simulate *COULD*, in reaction to
> the player's actions, behave **a-historically**.»

Cioè: **il futuro reale è la traiettoria di default del mondo; le tue scelte (e le reazioni che
provocano) la deviano.** La divergenza — *atteso vs accaduto* — **è** la storia della partita.

**La tensione, dichiarata.** Oggi il codice **vieta** di usare il futuro reale:

- `RealityAdvisor.ts:391` (`[ORIZZONTE TEMPORALE]`): «Non anticipare fatti, tecnologie, guerre o
  esiti storici reali **successivi al preset**, anche se oggi li conosci. Le date future possono
  descrivere solo piani o ipotesi, **mai fatti già accaduti**.»
- `HistoricalBaseline.ts:26`: «La baseline influenza l'interpretazione e **non determina eventi
  futuri**.»

**La risoluzione: profezia ≠ traiettoria.** Il divieto esiste per un buon motivo — impedire che il
modello usi il futuro come **fatto** («nel 2001 accadrà X»), che in una storia alternativa è
falso. La traiettoria è un'altra cosa: è ciò che il mondo **punta a fare** per default. Distinzione:

- **Profezia** — un **fatto** sul futuro, recitato al giocatore. **Resta vietata.**
- **Traiettoria** — una **tendenza**: cosa gli NPC stanno cercando di fare, cosa il mondo aveva in
  corso. **Ammessa**, perché non è un fatto, è un **default comportamentale** che la partita devia.

**Le tre regole di sicurezza (invarianti):**

1. **La traiettoria non è mai un fatto** narrato al giocatore (H-I12). Il Consulente può dire «la
   regione **sta scivolando** verso lo scontro», non «nel settembre 2001 succederà X».
2. **Gli NPC la seguono** finché la partita non la devia. **Mai il giocatore**: Pax è esplicito —
   «Never execute actions FOR the player … IF the player is playing as the nation that
   historically executed those historical actions, then make sure the player actually took an
   action» (`forward.txt:47`). Il motore **non** fa accadere al giocatore ciò che la storia reale
   gli attribuisce.
3. **La storia della partita sostituisce la traiettoria** man mano che il tempo avanza — cosa che
   il `NarrativeContextCompiler` dice già («dopo anni domina PLAYER HISTORY»). La traiettoria
   serve **all'inizio** e **in sottofondo**; un film già deviato non torna indietro.

**Chi la produce.** L'IA, con la stessa disciplina di confidenza della baseline. E i **filoni del
preset** portano la traiettoria **curata** dei loro nodi (il `storylines.json` può avere un campo
`trajectory`: dove il nodo **andava** se nessuno lo deviava). La parte curata e la parte generata
convivono con la stessa regola di divisione di §4.6.

---

## 5. Fasi

Ogni fase è consegnabile da sola, con PR, Quality Gate e test-contratto. Ordine di dipendenza.

### H00 — Contratto dello standard e modello dati
**Cosa.** Fissare: i campi del filone (§4.1), le regole (§4.2), il JSON Schema, e la semina.
**Decisione presa dall'autore (8 ottobre 2026): «ogni partita la sua storia».** Il preset è
**identico per tutti** (stesso modello di partenza), ma i filoni vivono e avanzano **per partita**,
non per mondo.

Conseguenza (misurata e **favorevole**): **non serve toccare lo schema.** La catena
`games.world_id → worlds.id → worlds.template_id → preset` esiste già (`games` ha FK
`world_id`, `worlds` ha `template_id` a `database.ts:68`), e `NpcAgendaService` è già costruito
**game-scoped** (`game-session.ts:1938`, `gameId: this.id`). I filoni si **seminano alla partenza**
come obiettivi di *quella* partita: nessuna colonna `world_id`, nessun avanzamento condiviso.
**Attenzione.** Il filone è una **politica** dentro `NpcAgenda`, non una tabella nuova. I filoni
sono **indipendenti dalla nazione scelta dal giocatore**: il preset è uno, e i filoni esistono a
prescindere da chi gioca. Non legarli al giocatore.
**Verifica.** Documento breve con la matrice «disponibile / derivabile / assente» e la catena
world→preset. Nessun refactoring.

### H01 — La specifica dello standard, scritta e versionata
**Cosa.** `docs/STANDARD_FILONI_PRESET.md`: la specifica **v1**, con JSON Schema, regole,
esempi buoni e cattivi, e la dichiarazione esplicita che è **additiva** (un preset senza file è
valido).
**Verifica.** Revisione; nessun codice.

### H02 — Il loader conosce lo standard
**Cosa.** `storylines.json` in `preset-loader.ts`: lettura (`loadFromDir`), validazione
**bloccante** contro lo Schema (un filone malformato **non** degrada in silenzio), campi in
`PresetPackage`. File assente → **nessun errore**.
**Attenzione.** La validazione deve seguire la disciplina già in vigore nel progetto: costo
*mancante* = avviso, dato *incoerente* = blocco (lezione di `project-regressione-ordini`). Qui:
file assente = avviso silenzioso; filone malformato = **blocco**.
**Verifica.** `tests/storylines-preset.test.ts`: valido, assente, `version` ignota, id ripetuto,
`parties` vuote, `state` fuori enum, `pressure` fuori 1–3. Prova al contrario su ogni regola.

### H03 — Lo standard vale per tutti i preset (trasporto + autoring + conformità)
**Cosa.** Le altre tre sedi della tabella §3:
- **`preset-zip.ts`**: aggiungere `storylines.json` a `ALLOWED_ROOT_FILES` (riga 44) e
  `addIfExists('storylines.json')` (96-99). **Senza questo, export/import scarta i filoni in
  silenzio.**
- **`presets.routes.ts`**: il contratto di autoring (187-201) e la scrittura (137) conoscono
  `storylines.json`, così un preset **futuro** nasce conforme.
- **Conformità**: un controllo che passa **tutti** i preset in `data/presets/`, elenca chi ha i
  filoni, chi no, e segnala i malformati. Un test lo esegue su tutti i preset reali (fixture
  esclusa).
**Attenzione.** Questo è il cuore del requisito «presenti e futuri»: senza H03 lo standard è solo
una convenzione privata.
**Verifica.** `tests/storylines-standard-conformance.test.ts` che passa ogni preset e asserisce
che quelli con `storylines.json` validano e che lo zip fa round-trip **senza perdere** il file.

### H04 — Ogni partita semina e avanza i **suoi** filoni
**Cosa.** Alla **partenza della partita**, i filoni del preset (filtrati per `active_from`/
`active_until`) diventano obiettivi NPC iniziali **di quella partita**; a ogni turno,
`refreshNpcAgenda` li fa avanzare (progresso, revisione, chiusura). Un filone chiuso dallo stato
non riapre; `active_from`/`active_until` decidono quando è dormiente.
**Attenzione.** `refreshNpcAgenda` **esce in strict** (`isStrictGame()`, riga 3352): decidere se i
filoni valgono anche in strict (probabile: solo ordinario). La semina è **per partita**
(decisione dell'autore): due partite dello stesso mondo hanno storie **indipendenti**. Un filone
esiste **qualunque nazione** scelga il giocatore.
**Verifica.** `tests/h04-storyline-progress.test.ts`: apre, progredisce, si chiude; prova al
contrario su un filone superato. **Due partite dello stesso preset devono dare storie diverse**
(il test lo difende). **Misurare su un preset diverso dalla fixture**
(`millennium_dawn`, `modern_world_provinces`) — lezione di `project-regressione-ordini`.

### H05 — La situazione iniziale
**Cosa.** La seconda fonte di §4.6: una **situazione** al presente generata dall'IA per la nazione
scelta, sul modello di `getPolityHistoricalBaseline` (`game-session.ts:3564`). Copre le nazioni
che il preset non copre (Israele, la Palestina, e **tutte** le altre). Persistita per
`(game, polityId, startDate)`, gating `"high"`, subordinata ai filoni (non li contraddice). Può
includere la **traiettoria iniziale** (§4.7): dove la nazione **punta ad andare**.
**Attenzione.** Non è un secondo `lore`/`base_prompt`: dev'essere **per nazione**, non per preset.
Riusare la disciplina della baseline (confidenza, fail-closed, timeout, single-flight) invece di
inventarne una parallela. Il costo: **una chiamata per nazione giocata** all'apertura.
**Verifica.** Test che: una nazione **fuori del preset** (Israele) riceve la sua situazione; la
situazione **non contraddice** un filone attivo; un fatto incerto non entra; manca il dato →
nessuna voce, non una inventata.

### H06 — La traiettoria
**Cosa.** §4.7. Il mondo ha una **traiettoria** verso cui va: gli NPC la seguono, il giocatore la
devia, le reazioni la spostano. `storylines.json` guadagna un campo **`trajectory`** (dove il nodo
*andava* se nessuno lo deviava); e gli NPC senza filone ricevono la loro traiettoria dall'IA
(stessa macchina di H05).
**Attenzione.** La distinzione è il cuore, e va difesa con un test:
- **profezia vietata** — un **fatto** sul futuro recitato al giocatore;
- **traiettoria ammessa** — una **tendenza**, il default comportamentale degli NPC.
Inoltre: **mai il giocatore** — il motore non fa accadere al giocatore ciò che la storia reale gli
attribuisce (Pax, `forward.txt:47`). E la **storia della partita sostituisce la traiettoria** man
mano che il tempo avanza.
**Nota: questo richiede l'emendamento di `RealityAdvisor.ts:391`** («mai fatti già accaduti»):
va reso esplicito che la *traiettoria* non è una profezia. È una modifica a un testo coperto da
test, quindi va con l'ok dell'autore (come H09).
**Verifica.** Test che: la traiettoria non è mai resa come fatto; un NPC la segue; il giocatore no;
dopo la divergenza la storia della partita prevale sulla traiettoria.

### H07 — La narrazione e le proposte
**Cosa.** Filoni + situazione iniziale + traiettoria entrano nel prompt del Consulente; i filoni
diventano **ancore** (`anchorKeys`) e alimentano **proposte con opzioni concrete** (stile
`actions.txt`: topic → 2-5 azioni). Il modello **sceglie**; le cifre restano del motore.
**Attenzione.** Le ancore vanno validate server-side come oggi (`resolveAnchorLinks`,
`CouncilIssue.ts:74-89`): un filone ignoto invalida la card. Mai Pressure/quest (vietate).
**Verifica.** `advisor-storyline-proposals.test.ts`: ancorata valida; filone ignoto rifiutato;
filone superato non riproposto.

### H08 — La policy ammette
**Cosa.** Emendare `VERIFIED_FACT_POLICY` (`RealityAdvisor.ts:40-59`) e
`MINISTER_WORLD_TRUTH_HIERARCHY` (`prompts/national-context.ts:124-131`) per nominare il
**FILONE DEL PRESET** come fonte autorevole **subordinata** allo stato.
**Attenzione.** Testo coperto da `advisor-strategist-voice`, `polity-historical-baselines`,
`preset-reality-smoke`: allinearli **senza allentare** le invarianti.
**Verifica.** Test che difendono la nuova frase **e** che il divieto «non inventare crisi» resta.

### H09 — Il mondo racconta
**Cosa.** Il motore pubblica al modello il **delta** dei filoni (aperti/chiusi/progrediti nel
turno); il modello **sceglie** cosa narrare. Primo passo: **accendere** `narrative.worldPulse` e
allinearlo ai filoni, o sostituirlo con un passo «cronaca del mondo» che legge filoni + stato.
**Attenzione.** `worldPulse` è **narrativa-only**: un filone che *avanza* deve avanzare **nel
motore** (H04); il pulse lo racconta. Non confondere *raccontare* con *applicare*.
**Verifica.** Test sul delta (filone progredito → una voce, filone fermo → nessuna) e sul guard.

### H10 — Millennium 2000
**Cosa.** `millennium_dawn/storylines.json` con i filoni reali del 2000 (disarmo di Hamas,
Gerusalemme, politica religiosa).
**Attenzione.** **Misurato: la geometria c'è già** (32 province `PSE` nella mappa base). Resta
solo da aggiungere `PSE` ai `country_codes` **se** lo si vuole consigliato (non obbligatorio).
**Verifica.** Test che carica il preset e valida i filoni; sonda che mostra i filoni come
obiettivi NPC al turno 1.

### H11 — Le superfici mostrano
**Cosa.** Dossier/Governo/Consulente mostrano i filoni attivi con la loro **provenienza** (preset,
non motore). Il Consulente ha le proposte con opzioni.
**Attenzione.** Invarianti di presentazione (`project-consulente-grafici`,
`project-dossier-nazionale`): il modello sceglie cosa mostrare, mai le cifre; non troncare a 3.
**Verifica.** Test-contratto sul sorgente + E2E aggiornati.

### H12 — Playback
**Cosa.** I filoni e la situazione iniziale sopravvivono a riavvio, fork e rewind: il fork copia
al punto giusto; il rewind non lascia filoni del futuro.
**Attenzione.** `pruneAfterTurn` (`game-session.ts:3133`) esiste già per l'agenda: verificare che
copra i filoni.
**Verifica.** Test di fork/rewind.

### H13 — Chiudere
**Cosa.** Aggiornare questo documento con le misure finali, i limiti reali, e la parità (o non
parità) con Pax dichiarata **onestamente** (disciplina di `WS-NARR-DISPATCH-PAX-QUALITY`).

---

## 6. Invarianti (da difendere con test)

- **H-I1 — Una cifra un posto.** Il filone dà significato e trigger, mai numeri.
- **H-I2 — Il filone non è un fatto.** Gerarchia §4.4; subordinato allo stato.
- **H-I3 — Mai una crisi inventata.** Il divieto della policy resta.
- **H-I4 — Proporre non impegna.** Le proposte restano ipotesi (MG-I1).
- **H-I5 — Una guardia nata su una fixture va provata dove la sezione non c'è.**
- **H-I6 — Zero è valido.** Nessun filone → nessuna voce, nessuna proposta.
- **H-I7 — Retrocompatibilità.** Un preset senza `storylines.json` resta valido e si comporta
  come oggi. **Questo è ciò che rende lo standard additivo.**
- **H-I8 — Lo standard non si perde in viaggio.** Export → import di un preset **conserva** i
  filoni (H03). Un contratto che lo zip scarta non è uno standard.
- **H-I9 — Una partita, una storia.** Il preset è **identico per tutti**; i filoni avanzano
  **per partita**. Due partite dello stesso mondo hanno storie indipendenti, e i filoni esistono
  **qualunque nazione** scelga il giocatore (non si disegnano attorno al giocatore).
- **H-I10 — La nazione scelta è conosciuta a prescindere dal preset.** Una nazione **fuori** dal
  preset (senza lore, senza `country_codes`, senza geometria) ha comunque la sua storia e la sua
  situazione iniziale: la genera l'IA (H05), non l'autore. Il preset **copre una parte**, non
  tutto il mondo.
- **H-I11 — Il filone vince sui nodi che il preset ha fissato.** La situazione iniziale generata
  **non contraddice** un filone attivo; fuori da quei nodi l'IA è libera. (Il filone è più
  autorevole perché più specifico, non più «vero».)
- **H-I12 — La traiettoria non è una profezia.** Il futuro reale è una **tendenza** del mondo
  (ciò verso cui punta), **mai un fatto** narrato al giocatore. Vietato «nel 2001 accadrà X»;
  ammesso «il mondo sta scivolando verso X». (§4.7, H06.)
- **H-I13 — Il motore non gioca al posto del giocatore.** La traiettoria muove gli **NPC**; il
  giocatore la devia con le sue scelte, e non subisce mai ciò che la storia reale gli attribuisce
  (Pax, `forward.txt:47`).
- **H-I14 — La storia della partita batte la traiettoria.** Man mano che il tempo avanza, gli
  eventi della partita sostituiscono la traiettoria: un film già deviato non torna indietro.

---

## 7. Test-contratto

Esistenti da **non** rompere: `advisor-strategist-voice`, `polity-historical-baselines`,
`preset-reality-smoke`, `advisor-situations`, `reality-advisor-routes`, `council-proposal-anchors`,
`council-issue-variety`, `ws-jev-w3-minister` (budget contesto ministro < 5000),
`scenario-catalog`, `preset-zip`.

Nuovi: `storylines-standard` (H02, 24 test), `storylines-conformance` (H03, 4 test),
`h04-storyline-progress` (H04), `nation-initial-situation` (H05), `trajectory-not-prophecy` (H06),
`advisor-storyline-proposals` (H07), policy (H08), delta+guard (H09), preset Millennium (H10).

---

> **Consegnata — H00–H03 (8 ottobre 2026).** Lo **standard esiste** e vale per tutti i preset,
> presenti e futuri. Codice:
> - `scenario/storylines.ts` (nuovo) — tipo, schema, validazione (pura), `activeStorylines`;
> - `utils/preset-loader.ts` — `storylines` in `PresetPackage` + lettura opzionale (file assente
>   = nessun errore; file malformato = bloccante);
> - `utils/preset-zip.ts` — `storylines.json` in export/import, con validazione **prima** della
>   scrittura su disco;
> - `routes/presets.routes.ts` — autoring: payload, bozza IA (scarta i non conformi), scrittura,
>   contratto del prompt;
> - `docs/STANDARD_FILONI_PRESET.md` (nuovo) — la specifica v1.
>
> **Test: 28 verdi** (24 `storylines-standard` + 4 `storylines-conformance`), `tsc --noEmit` pulito
> e `presets-zip` 10/10. **Due fallimenti NON miei, preesistenti:** `presets.test.ts` (binario
> `better-sqlite3` Mach-O — limite d'ambiente noto) e `playable-presets.test.ts` (il preset
> `cold_war_1951`, **untracked nel working tree dell'autore**, che il test non prevede).

> **Consegnata — H04 (8 ottobre 2026).** I filoni diventano **obiettivi del mondo**, per partita.
> Codice:
> - `core/simulation/NpcAgenda.ts` — tipo `storyline`, `AGENDA_MAX_STORYLINES=6`, `isStorylineObjective`,
>   `storylineObjectiveId`, `seedStorylineObjective`, `storylineObjectiveSuperseded`;
>   **modifiche di comportamento:** un filone **non** viene abbandonato per mancanza di un seme
>   (riga 377); gli obiettivi hanno un **tetto per corsia** (filoni ≠ derivati) e un derivato
>   urgente **non** può sostituire un filone;
> - `game/StorylineSeeding.ts` (nuovo, puro) — `buildStorylineSeeds`: un filone → un seme per
>   **ogni polity protagonista presente nel mondo**, con tetto per polity;
> - `game/NpcAgendaService.ts` — `seedStorylines(seeds)`, idempotente per `(polity, storylineId)`,
>   chiude un filone superato;
> - `game-session.ts` — `seedPresetStorylines()` dentro `refreshNpcAgenda` (legge il preset dal
>   `template_id` del mondo; salta in strict);
> - `data/presets/millennium_dawn/storylines.json` (nuovo) — **H10 anticipata**: i 5 filoni reali
>   del 2000 (disarmo di Hamas, Gerusalemme, ispezioni in Iraq, Cecenia, coda del Kosovo).
>
> **Misura end-to-end (sonda `tsx`):** il loader legge 5 filoni; la semina genera **17 semi su 11
> polity** (ISR, PSE, USA, EGY, JOR, SAU, IRQ, GBR, RUS, FRA, SRB) — **indipendente dalla nazione
> scelta**. **Test: 44 verdi** (15 H04 + 24 standard + 4 conformità + 1 tetto) + `presets-zip` 10/10,
> `tsc --noEmit` pulito. **Nessuna regressione:** i fallimenti dell'agenda (`npc-agenda`,
> `npc-relevance`, `military-p4/5`) sono il binario `better-sqlite3` Mach-O.

> **Consegnata — H05 (8 ottobre 2026).** La **situazione iniziale della nazione**: l'IA genera, per
> **qualsiasi** nazione, cosa affronta alla data di partenza e **dove punta** — a prescindere dal
> preset. Codice:
> - `core/government/NationSituation.ts` (nuovo, puro) — `buildNationSituationPrompt` (chiede
>   PRESENTE + DIREZIONE, non il passato), `composeNationSituation` (gating `high`, fail-closed),
>   `generateNationSituation`, `renderNationSituation`, `NATION_SITUATION_RULE`;
> - `database.ts` — tabella `game_polity_nation_situations` (immutabile per `game/polity/start_date`,
>   come la baseline storica);
> - `repositories/game.repository.ts` — `getNationSituation` / `storeNationSituation`;
> - `game-session.ts` — `getPolityNationSituation` (single-flight in una mappa **dedicata**: la
>   stessa chiave della baseline avrebbe fatto collidere due tipi diversi — difetto trovato e
>   chiuso durante il lavoro), generata in `getAdvisorOpening` e letta in `advisorResult`;
> - `core/government/RealityAdvisor.ts` — campo `nationSituation` + blocco
>   `[SITUAZIONE DELLA NAZIONE …]` nel prompt, **subordinato ai filoni** (H-I11).
>
> **La regola che lega le due fonti:** il filone del preset **vince** sui nodi che ha fissato; la
> situazione generata **non lo contraddice**, ed è libera fuori da quelli. E la `trajectory` è una
> **tendenza**, mai una profezia (H-I12) — dichiarato nel testo della regola.
>
> **Test: 12 verdi** (`h05-nation-situation`) + 54 delle fasi precedenti, `tsc --noEmit` pulito.
> Le suite pure toccate restano verdi (advisor-situations 60, council-proposal-anchors 8,
> advisor-strategist-voice 5, polity-historical-baselines 9).

> **Consegnata — H07 (8 ottobre 2026).** Il Consulente **propone dal filone**. I filoni non sono
> più solo obiettivi del mondo: entrano nel contesto del Consulente e sostengono **proposte
> concrete**. Codice:
> - `VerifiedWorldSnapshot.ts` — campo `storylines` (input + snapshot), popolato dal caller;
> - `RealitySignals.ts` — un filone che tocca il giocatore diventa un **segnale**
>   `storyline:<id>` (importanza dalla `pressure`), **senza factKey** (non è un fatto del motore);
>   `seatToSignalDomain` traduce la sedia del filone nel dominio-segnale — un punto solo, il
>   confine tra lo standard e il motore;
> - `CouncilProposalAnchors.ts` — i segnali `storyline:*` sono anche **anchor**: una
>   `council_issue` con `signalKeys: ["storyline:<id>"]` risolve (validazione server-side
>   invariata);
> - `RealityAdvisor.ts` — blocco `[FILONI DEL MONDO …]` nel prompt, con la chiave da usare per
>   agganciare la proposta e l'avvertenza che la `trajectory` è una tendenza;
> - `game-session.ts` — `playerStorylines()`: i filoni **attivi** che toccano la nazione del
>   giocatore (filtro `active_from`/`active_until`).
>
> **Test: 7 verdi** (`h07-storyline-proposals`) e **146 verdi** sul gruppo completo (H04+H05+H07 +
> standard + conformità + i consumatori puri del Consulente: advisor-situations 60,
> council-proposal-anchors 8, council-signalkeys 15). `tsc --noEmit` pulito.

> **Consegnata — H09 (8 ottobre 2026).** Il **mondo racconta i filoni**. I filoni del preset
> diventano un **trigger** del «respiro del mondo» (`worldPulse`): fanno entrare in scena le
> **nazioni non giocate** che il preset ha dichiarato protagoniste di un nodo. Codice:
> - `prompts/simulation/worldPulse.ts` — `WorldPulseStoryline`; `storylines` in
>   `WorldPulseSelectionInput`; `storylineTriggers` sul candidato; una regola nel prompt che
>   dichiara il filone un trigger e vieta di narrarlo **risolto** o come profezia;
> - `prompt-builder.ts` — `worldPulseSelectionInput` passa `game.storylines`; `GameData.storylines`;
> - `game/GameDataService.ts` — `activeStorylinesForWorld()` nel contesto;
> - `game-session.ts` — `activeWorldStorylines()` / `activeStorylines()` (filtro `active_from`/`until`).
>
> **Perché è così:** la scena è quella del pulse (nazioni **non** giocate, narrativa-only, già
> protetta da guard). Un filone vi entra come **contesto/direzione**, non come mutazione — così il
> vincolo narrativa-only resta intatto e non si duplica la validazione.
>
> **Test: 7 verdi** (`h09-world-storylines`) e **48 verdi** con la suite narrativa preesistente
> (`narrative-dispatch-quality`, nessuna regressione); **71 verdi** sul gruppo H completo.
> `tsc --noEmit` pulito.
> **Nota — il flag `narrative.worldPulse` è OFF di default.** Questa fase **accende i filoni nel
> pulse**, ma **non** accende il pulse: resta una decisione dell'autore (è una chiamata provider in
> più per turno). Un filone resta invisibile in cronaca finché il flag non si accende.

> **Consegnata — H06 (8 ottobre 2026).** La **traiettoria** del mondo, per le nazioni non giocate.
> Gli NPC del teatro ricevono la loro **situazione + direzione** dall'IA, con la **stessa macchina**
> di H05 (per politia, non per giocatore). Codice:
> - `NationSituation.ts` — `renderPolityNationSituations` (blocco delle altre nazioni);
> - `game.repository.ts` — `getNationSituations` (lettura multipla);
> - `game-session.ts` — `persistedPolityNationSituations` / `preparePolityNationSituations`;
> - `RealityAdvisor.ts` — campo `polityNationSituations` + blocco nel prompt;
> - `TurnPipelineService.ts` — prepara le situazioni degli attori della reazione;
> - `prompt-builder.ts` — `GameData.polityNationSituations`.
>
> **SCOPERTA — l'emendamento previsto NON serve.** Il piano diceva che H06 richiedeva di emendare
> `RealityAdvisor.ts` («mai fatti già accaduti»). **La misura lo smentisce:** il testo attuale
> (`RealityAdvisor.ts:425`) dice già *«Le date future possono descrivere **solo piani o ipotesi**,
> mai fatti già accaduti»* — che è **esattamente** la distinzione tendenza/profezia. La regola
> **permette già** la traiettoria; il blocco dei filoni (H07) la rende solo esplicita per il
> modello. **Nessun testo sacro toccato.** (Lezione di metodo: una premessa del piano scritta per
> prudenza va **misurata** prima di eseguire l'emendamento.)
>
> **Test: 14 verdi** (`h05-nation-situation`, di cui 2 nuovi per gli NPC), **73 verdi** sul gruppo
> H completo, `tsc --noEmit` pulito.

> **H08 — RIVALUTATA E NON ESEGUITA (8 ottobre 2026).** Il piano prevedeva di emendare la
> `VERIFIED_FACT_POLICY` per nominare il FILONE come fonte. **La misura dice che non serve:** la
> policy (`RealityAdvisor.ts:53`) elenca una gerarchia di **fatti** (CURRENT STATE > PLAYER HISTORY
> > HISTORICAL BASELINE); un filone **non è un fatto** (H-I2), quindi non contraddice la policy. Il
> blocco H07 già dice al modello che i filoni sono significato e non prova di risorse. Nominarli
> sarebbe **chiarezza, non un requisito** — col costo di toccare ~5 file di test che asseriscono il
> testo della policy. **Decisione: H08 resta opzionale, da fare solo se l'autore lo vuole.**

> **Consegnata — H10 completa (8 ottobre 2026).** **Tutti e cinque i mondi giocabili hanno i loro
> filoni**: `europa_1914` (3), `mondo_1936` (4), `cold_war_1951` (4), `millennium_dawn` (5),
> `modern_world_provinces` (4), `pax_modern_provinces` (4) — **24 filoni**, tutti conformi, tutti
> seminabili. È la prova che lo standard funziona su preset **diversi** (non solo la fixture):
> la sonda end-to-end genera semi per ciascuno (es. `cold_war_1951` → 19 semi su 12 polity,
> `mondo_1936` → 14 su 9).
> **Prossima:** H11 (le superfici), H12 (fork/rewind), H13 (chiusura).

> **Consegnata — H11 (8 ottobre 2026).** I filoni diventano **visibili** nel Dossier. Codice:
> - `backend-nest/src/game-session.ts` — `getPlayerStorylines()`: i filoni attivi che toccano il
>   giocatore, sola lettura, nessuna chiamata LLM;
> - `routes/games/state.routes.ts` — il campo `storylines` nella rotta `national-state` (già
>   consumata dal Dossier), accanto a `strategicAgenda`;
> - `frontend`: `api.ts` (tipi su `nationalState` e `VerifiedWorldSnapshotView`),
>   `hooks/useNationSnapshot.ts` (stato + fetch + return), `GameScreen.tsx` → `DeskContent.tsx` →
>   `NationDock/types.ts` → `NationDock.tsx` (blocco «Filoni del mondo» nella sezione Situazione),
>   `NationDock/widgets.tsx` (`StorylinesList`), `index.css` (stile scoped `.storyline-*`).
>
> **Invarianti difese:** il blocco **non mostra cifre** (H-I1 — un test lo verifica isolando il
> corpo del widget), **non si rende** quando non ci sono filoni (H-I6), e **non è in un
> richiudibile** (invariante D07/V02 del dossier). Test: `frontend/src/components/Game/storylinesSurface.test.ts` (6).
>
> **Verifica:** `tsc` **pulito su backend e frontend**; **73 verdi** sul backend (gruppo H),
> **33 verdi** sul frontend (`storylinesSurface` 6 + `nationDockSingleSource` 13 + gli altri del
> dossier). **Ambiente:** riparato il binding `rollup` Linux (`@rollup/rollup-linux-x64-gnu`) — ora i
> test del frontend girano in questa VM.
> **Prossima:** H12 (fork/rewind), H13 (chiusura).

> **Consegnata — H12 (8 ottobre 2026). Un difetto reale trovato misurando il database.**
> L'agenda dei filoni è **per ramo**, ma il servizio scriveva e leggeva col letterale `'main'`.
> **Misurato sul DB reale:** `head_branch_id` è un **UUID** — il ramo si *chiama* `main`, ma il suo
> **id** è un `randomUUID()` (`ensureMainBranch`, `game.repository.ts:67-76`). Quindi l'agenda
> viveva su una chiave `'main'` che **non è il ramo della partita**: tutti i rami la condividevano.
> Su un **fork** il ramo nuovo ereditava la strategia del ramo di partenza; su **rewind** la
> potatura colpiva una riga che non era la sua. (Il DB conferma: `game_npc_agenda` vuota e
> `game_crisis_state` scritta con UUID, **mai** con `'main'`.)
>
> **Il difetto era mio e preesistente a un tempo:** H04 ha scritto i filoni dentro una macchina che
> aveva già il buco. Corretto:
> - `game/NpcAgendaService.ts` — `branchId?()` nel contesto; **ogni** lettura/scrittura (list ×2,
>   appendMany ×2, pruneAfterTurn) passa `branchId: this.branchId()`;
> - `game-session.ts` — `branchId: () => this.fenceContext().branchId` (l'**id** reale, non il nome).
>
> **La situazione e la baseline NON hanno bisogno di fork:** sono immutabili per
> `(game, polity, start_date)` e **condivise fra rami** per design — descrivono il passato e
> l'inizio, non la partita. Il test lo difende (nessuna colonna `branch_id`).
>
> **Test: 7 verdi** (`h12-agenda-branch`), **80 verdi** sul gruppo H completo, `tsc` pulito
> backend e frontend.
> **Prossima:** H13 (chiusura).

---

## 8. Rischi e limiti dichiarati

- **Autoring.** Lo standard non scrive i filoni al posto tuo: i preset esistenti partono **senza**
  e vanno scritti uno per uno. Lo standard garantisce che quando li scrivi, **funzionino ovunque**.
- **Il filone che «avanza» tocca il motore.** `worldPulse` è narrativa-only: se un filone deve
  **cambiare lo stato** (un embargo *applicato*), serve una mutazione nel motore (EffectValidator,
  ledger). Tenere separato *raccontare* da *applicare*.
- **Budget del ministro** (JEV-W3 < 5000) stretto: i filoni vanno nel Consulente e nel Dossier,
  non necessariamente in ogni sedia.
- **Nessun turno giocato con un LLM reale** (limite già noto di MG): l'effetto reale dei filoni
  sulla narrazione non è verificabile senza provider.

---

## 9. Cosa questo piano **non** fa

- Non genera i filoni con l'IA: sono **scritti** (scelta dell'autore).
- Non tocca il motore economico/militare (ledger, EffectValidator, ProjectEngine).
- Non dichiara parità con Pax senza misura.
- Non introduce Pressure/quest/missioni.

---

## 10. Metodo e verifica indipendente

Come da `feedback-metodo-misurare`: diagnosi misurata, fasi numerate, ogni invariante con un test
che la difende, le fasi consegnate annotate qui con ciò che **la misura ha trovato**. E come da
`feedback-verifica-indipendente`: **prima di consegnare**, i numeri e i riferimenti file:riga di
questo piano vanno fatti **smontare** da un secondo agente (mandato: «ri-esegui ogni misura e
dichiara CONFERMATO / DIVERSO / NON VERIFICABILE; segnala ogni inferenza travestita da misura»).

---

## 11. Scarti dalla verifica indipendente (8 ottobre 2026)

Un secondo agente ha **smontato** (non confermato) la prima stesura. Le affermazioni strutturali
hanno retto e **ogni riferimento file:riga** è risultato esatto, ma ha trovato **quattro
affermazioni sbagliate**, che ho ricontrollato io stesso prima di correggere:

| # | Prima stesura | Misura corretta | Effetto |
|---|---|---|---|
| 1 | `base_prompt` di `millennium_dawn` = **879 caratteri** | **1462** caratteri (220 parole) | Era la cifra più load-bearing della diagnosi. Corretta. |
| 2 | «Tutta la conoscenza del mondo sta nel `base_prompt`» | `millennium_dawn` ha anche un catalogo `simulation/` strutturato (14 polity, giacimenti) | La mancanza è **politica**, non materiale. Riformulata. |
| 3 | «PSE non è nemmeno una polity giocabile» / «la geometria va misurata» | `PSE` ha **32 province** nella mappa base ed è in `country_codes`/`countries[]` di `pax_modern_provinces`; `country_codes` è la lista *consigliata*, non le giocabili | **Il rischio era invertito:** H08 non richiede geometria. Corretto. |
| 4 | «`worldPulse` non è persistito» | I suoi **eventi** entrano nella timeline persistita (`TurnPipelineService.ts:891-906`); non lo è lo **stato interno** | Precisato. |

Altre due imprecisioni minori corrette: la lista dei campi di `PresetPackage` non era dichiarata
esaustiva (mancavano `has_custom_map`, `flags`, `source`), e «fazioni/questioni zero occorrenze»
era vero **solo per i campi del preset**.

**Lezione (di nuovo quella di `feedback-verifica-indipendente`):** l'errore n.3 era un'**inversione
di senso** che nessuna rilettura avrebbe preso, perché avevo dedotto il rischio dalla lettura
invece di misurarlo. Il numero n.1 era un'inferenza travestita da misura.

---

## 12. Apertura proposta

L'ordine è dettato da due requisiti: «tutti i preset, presenti e futuri» e «la nazione scelta è
conosciuta a prescindere dal preset».

**Prima consegna: H00 + H01 + H02 + H03.** Cioè: il contratto, la specifica versionata, il loader
che lo legge, e le **altre tre sedi** (zip, autoring, conformità). Al termine di questa consegna lo
standard **esiste davvero** — un preset nuovo o importato lo porta con sé — e nessun motore è
ancora stato toccato. È la risposta diretta a «creiamo uno standard».

Poi, in ordine di dipendenza: H04 (ogni partita semina e avanza i suoi filoni), H05 (situazione
iniziale della nazione — l'IA), **H06 (la traiettoria: il futuro come default)**, H07 (Consulente
e proposte), H08 (policy), H09 (narrazione), H10 (Millennium), H11–H13.

**H05 può essere anticipata** e lavorare in parallelo: è il pezzo che l'autore ha chiamato «la
storia della nazione che ho scelto», e riusa una macchina che **esiste già** (§1.6), quindi ha
meno rischio di H04. Se l'autore vuole vedere **subito** un effetto («scelgo Israele e il
Consulente sa chi è Israele»), H05 da sola lo dà.

**I due emendamenti a testi coperti da test — H06 (`RealityAdvisor.ts:391`, «mai fatti già
accaduti») e H08 (`VERIFIED_FACT_POLICY`) — vanno fatti con l'ok esplicito dell'autore.**

---

## 13. Il modello dei tre tempi — sintesi per l'autore

```
PASSATO   (prima di start_date)   come ogni nazione è arrivata qui     IA, esiste già
PRESENTE  (a start_date)          cosa ogni nazione affronta            IA (H05) + filoni (H04)
FUTURO    (dopo start_date)       dove il mondo punta ad andare         traiettoria (H06)

il giocatore + le reazioni del mondo DEVÍANO il futuro
la divergenza (atteso vs accaduto) È la storia della partita
```

Le tre cose che il futuro **non** è: non è un copione (la partita lo devia), non è una profezia
(mai un fatto al giocatore: H-I12), non è mai giocato al posto del giocatore (H-I13).

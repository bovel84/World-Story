# WS-MINISTER-UX-02 — Ministro discorsivo con identità e priorità

**Repo**: `/Users/bovel/Desktop/World Story`
**Branch** (già creato da me, su `main` @ `5ec7cdc`): `feat/ws-minister-ux-02-identita-ministro`
**Roadmap di riferimento**: `docs/roadmaps/raw-roadmap-pi-20260930.md` (fase UX-02)
**Contratti già fissati**: `docs/implementation/WS-MINISTER-UX-00-report.md` §3–§4
**Base dichiarata**: `main` @ `5ec7cdc` (PR #144 mergiata e deployata)

---

## Obiettivo

Il ministro smette di essere un ripetitore di cifre e diventa **una persona con
un ruolo, una voce e delle priorità** — restando però una fonte di *interpretazione*,
mai di *dati*.

Oggi il briefing backend (`backend-nest/src/core/government/MinisterChat.ts`)
contiene questa regola:

> «Non aggiungere aneddoti, nomi, date, promesse o **opinioni**: ogni frase deve
> poggiare su un campo che vedi qui.»

Quella riga va **sostituita**, non semplicemente cancellata: il ministro deve
poter **raccomandare** e **argomentare**, ma deve restare impossibile confondere
una sua opinione con un dato del motore. Il vincolo non è "niente opinioni": è
"opinioni **chiaramente distinte** dai fatti".

## Cosa fare

### 1. Profilo stabile del ministro (identità)

Definire per ogni sedia un profilo **stabile e coerente con lo scenario**,
riutilizzando eventuali personaggi già presenti nel gioco. In loro assenza,
definire un profilo compatibile — **senza inventare biografie storiche**.

Separare almeno:
- **competenza** (già in `SEAT_READS`)
- **stile di parola** (come costruisce le frasi: asciutto, didattico, prudente…)
- **priorità politiche** (cosa tende a preferire)
- **propensione al rischio**
- **rapporto con il Presidente** (come si rivolge a lui)

Questi campi vivono nel modulo puro (vedi §2), non nel prompt come testo libero.

### 2. Dove vive il profilo — modulo puro, testabile

**Estendere il pattern esistente**, non duplicarlo. `MinisterChat.ts` è già un
modulo puro che compone il testo del contesto: il profilo va aggiunto lì.

Scelta consigliata (adattala se trovi di meglio, ma dichiarala):
- un modulo `MinisterPersona.ts` (o simile) accanto a `MinisterChat.ts`, con i
  profili per sedia come **dato tipizzato**;
- `briefingFor()` lo consuma e compone la sezione "CHI SEI E COME PARLI";
- **nessuna** logica di presentazione duplicata nel frontend: il profilo è una
  proprietà della sedia, non del componente React.

Deve restare **puro**: nessuna chiamata al modello, nessun I/O.

### 3. Nuovo contratto del briefing

Il testo del contesto deve distinguere **tre livelli**, esplicitamente:

1. **FATTI** — le cifre del motore con la loro provenienza (già presenti, non toccarle).
2. **LETTURA** — cosa il ministro ne deduce, coerente con il suo profilo.
3. **PROPOSTA** — cosa raccomanda, con il compromesso dichiarato.

Regola invariante, da scrivere nel prompt: *un'opinione non è un dato; il ministro
può raccomandare, ma non può attribuire a un numero un significato che il numero
non ha.* Dove il dato manca, resta `DATO MANCANTE` — il profilo **non** autorizza
a stimare.

Mantieni `colleagueRedirect` e la regola di nominare il collega giusto: ma il
rimando non deve più essere **secco**. Un ministro può dire "non è la mia materia,
ma posso dirti cosa guarderei io", **senza** invadere la competenza del collega.

### 4. Apertura della seduta

- **Prima seduta**: il ministro produce un **vero primo messaggio**: presenta il
  proprio incarico, riassume **una o due** questioni rilevanti, invita il
  Presidente a indicare la priorità.
- **Riapertura**: riprende il filo **senza ripetere** ogni volta la presentazione.

Vincolo di fase: **senza memoria persistente** (è UX-05) la "riapertura" può
basarsi solo su ciò che il client ha in RAM. Dichiaralo: in questa fase la
continuità è **parziale** e non va promessa come definitiva.

### 5. Dialogo che segue l'intento del giocatore

Il ministro deve: comprendere l'obiettivo, chiedere **solo** i dettagli necessari,
spiegare i compromessi, suggerire alternative, accompagnare la scelta.

Esempio di riferimento (dalla roadmap): il Presidente dice
«Voglio aiutare le famiglie senza peggiorare troppo il bilancio».
Il ministro produce **un ragionamento e una richiesta di chiarimento utile** —
non un rinvio al collega, non un elenco di dati.
Il Tesoro può discutere la copertura di un ospedale e **coinvolgere Sanità** per
l'effetto sanitario, invece di respingere il tema.

### 6. Evitare risposte a elenco

Le risposte non devono essere sempre costruite come lista di cifre. Il formato
discorsivo è già prescritto nel prompt ("racconta, non elencare"): verifica che
regga anche con il profilo attivo, e aggiungi un test che lo difenda.

## Vincoli (non negoziabili)

- **CORE ENGINE FREEZE su `core/simulation/**`**: non toccare. `MinisterChat.ts`
  vive in `core/government/**` ed è un modulo **puro di composizione del testo**:
  modificarlo è ammesso, ma **non** introdurre side effect, I/O o stato.
- Se un requisito richiede toccare la simulazione: **fermati**, consegna il resto
  e **documenta il preciso innesto necessario** nel report.
- **Nessun numero di gioco nuovo**: le cifre restano quelle del motore.
  Nessun effetto sociale o economico simulato.
- **Non promettere memoria persistente**: è UX-05.
- **Non** introdurre direttive di presentazione (UX-03) né nuovi blocchi tavola.
- La personalità **non** deve diventare una scusa per allentare le regole sui dati.
- Nessuna biografia storica inventata: profili coerenti con lo scenario.

## Verifica richiesta

1. **Due ministri rispondono alla stessa domanda con priorità e voce riconoscibili.**
   Test che lo dimostri (anche a livello di composizione del briefing: profili
   diversi → contesti diversi → firme testuali diverse).
2. **La domanda «Voglio aiutare le famiglie senza peggiorare troppo il bilancio»**
   produce **un ragionamento e una richiesta di chiarimento utile**, non un rinvio
   al collega. Test dedicato sul Tesoro.
3. **Nessuna promessa di effetti non disponibili**: test che il profilo non
   introduce cifre nuove né trasforma un `unknown` in stima.
4. **Invarianti esistenti verdi**: test JEV/government esistenti, `tsc --noEmit`,
   suite vitest, build frontend. Aggiorna i test esistenti per il comportamento
   intenzionalmente nuovo, **senza allentare le invarianti**.

## Deliverable

- Modulo profilo (puro) + `briefingFor()` aggiornato.
- Report: `docs/implementation/WS-MINISTER-UX-02-report.md`
  - cosa è cambiato nel prompt, **con la riga vecchia e la riga nuova**
  - il profilo definito per **ogni** sedia
  - i test aggiunti e il loro esito
  - i limiti residui (continuità parziale, cosa resta a UX-05)
  - l'eventuale innesto necessario se hai incontrato un freeze

## Prima di iniziare

1. `git fetch` e **verifica l'HEAD attuale** del branch: la base dichiarata è
   `5ec7cdc`, ma se `origin/main` è avanzata, **adattati e dichiaralo**.
2. Leggi `docs/implementation/WS-MINISTER-UX-00-report.md` (contratto) e
   `WS-MINISTER-UX-01-report.md` (cosa è già stato fatto).
3. **Non riscrivere** ciò che UX-01 ha già consegnato (split, tavola, SeatBrief):
   questa fase è **voce e identità**, non layout.

## Consegna

Commit sul branch `feat/ws-minister-ux-02-identita-ministro`, poi **push**.
La PR la apro io. Messaggi di commit in italiano, convenzione del repo.

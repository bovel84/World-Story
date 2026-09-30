# WS-MINISTER-UX-05 — Memoria persistente del ministro

**Repo**: `/Users/bovel/Desktop/World Story`
**Branch** (già creato da me, su `main` @ `25a9d89`): `feat/ws-minister-ux-05-memoria-persistente`
**Roadmap di riferimento**: `docs/roadmaps/raw-roadmap-pi-20260930.md` (fase UX-05)
**Contratti già fissati**: `docs/implementation/WS-MINISTER-UX-00-report.md`
**Base dichiarata**: `main` @ `25a9d89` (PR #147 — UX-04 — mergiata)

---

## Obiettivo

Estendere la cronologia esistente con una **memoria conversazionale persistente**,
separata dai numeri del mondo. Il ministro non deve più "dimenticare" una proposta
respinta, un obiettivo esplicitato dal Presidente o una decisione accodata.

La memoria **non è una seconda contabilità**: non porta cifre nuove, non sostituisce
i fatti aggiornati del briefing (che vincono sempre) e non autorizza a stimare dove
il dato manca.

## Cosa fare

### 1. Contratto della memoria (scope e tipi)

Scope minimo: **partita, ramo, identità del ministro e mandato**. Il solo nome della
sedia non basta se il ministro cambia: il `mandate` è l'identità di chi siede.

Tipi di ricordo da conservare:
- obiettivo esplicitato dal Presidente (`objective`)
- proposta discussa (`proposal-discussed`)
- proposta respinta **con il motivo** (`proposal-rejected`)
- questione rimasta aperta (`open-question`)
- decisione accodata / atto nel registro (`queued-decision`)
- esito verificato dopo l'avanzamento del tempo (`verified-outcome`)

Stato del ricordo distinto dal valore: `open | discussed | rejected | queued | executed | verified`.
«Il Presidente valuta una scuola» ≠ «ha firmato l'ordine» ≠ «la scuola è operativa».

Ogni ricordo importante ha un **riferimento**: messaggio/atto, data di gioco, turno.
Un ricordo senza provenienza non è verificabile e **non entra**.

### 2. Dove vive il modulo — puro e testabile

Segui il pattern già consolidato (`MinisterChat.ts`, `MinisterPersona.ts`): la parte
**pura** (tipi, registrazione, selezione per il prompt, copia al fork, potatura al
rewind) va in un modulo dedicato accanto a `MinisterChat.ts` — nessun I/O, nessuna
chiamata al modello, nessuno stato globale.

L'**innesto di persistenza reale** (salvataggio, repository) viene **dopo**: vedi §5.

### 3. Prompt: profilo + sintesi + scambi recenti + fatti

Preparare il prompt con: profilo del ministro, **sintesi breve dei ricordi pertinenti**,
scambi recenti e fatti aggiornati. Evitare di reinviare indefinitamente tutta la
cronologia o di generare nuove chiamate LLM a ogni apertura solo per riassumere.
La selezione dei ricordi pertinenti è deterministica e locale.

### 4. Fork e rewind

- **Fork**: la memoria si copia sul ramo, con gli scope aggiornati.
- **Rewind/rollback**: si **potano** i ricordi oltre il punto di ripristino — una
  decisione futura non deve comparire nel passato.

### 5. Persistenza — ATTENZIONE AL FREEZE

**CORE ENGINE FREEZE** su `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, schema e repository: non toccare.

La persistenza reale richiede un **innesto backend** (repository/salvataggio).
Se quell'innesto ricade sotto il freeze:
- **NON procedere** su quella parte; **fermati**;
- completa tutto il resto (contratto puro + selezione + fork/rewind + test);
- documenta nel report il **preciso innesto necessario** (file, firma, punto di
  aggancio) affinché la fase sia chiudibile in un intervento successivo autorizzato.

Riutilizza i meccanismi di salvataggio/repository esistenti **prima** di introdurre
nuovo storage. Una cache frontend può essere una tappa intermedia dichiarata, ma
**non soddisfa** questa fase come soluzione finale.

## Vincoli (non negoziabili)

- **Freeze**: nessuna modifica a `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
  `TurnPipelineService`, `SessionStateStore`, schema o repository. In caso di conflitto:
  fermati e documenta.
- **Nessun numero di gioco nuovo**: la memoria non è una seconda fonte contabile.
- Le partite restano **isolate**: nessuna memoria condivisa tra partite o rami.
- Nessuna nuova chiamata LLM per riassumere a ogni apertura.
- Non toccare JEV né il repo `jev`.

## Verifica richiesta (accettazione)

1. **Persistenza**: chiudere, cambiare ministro, ricaricare il browser e riavviare il
   server **non perde** la memoria prevista dal contratto (o, se bloccata dal freeze,
   il report dichiara esattamente cosa resta aperto e con quale innesto).
2. **Isolamento**: test che due partite non si scambiano ricordi.
3. **Rewind**: un rollback **non lascia** ricordi del futuro.
4. **Respingimento**: il ministro ricorda una proposta respinta **e il motivo**,
   senza trasformarla in un atto approvato.
5. **Invarianti esistenti verdi**: test esistenti, `tsc --noEmit`, suite vitest, build
   frontend. Aggiorna i test esistenti per il comportamento intenzionalmente nuovo,
   **senza allentare le invarianti**.

## Deliverable

- Modulo memoria (puro) + integrazione nel briefing (`MinisterChat.ts`).
- Test: `backend-nest/tests/ws-minister-ux-05.test.ts` e test frontend pertinenti.
- Report: `docs/implementation/WS-MINISTER-UX-05-report.md`
  - il contratto dei ricordi (tipi, stati, riferimenti)
  - come si selezionano i ricordi per il prompt
  - la regola di fork e di potatura al rewind
  - **l'esito sull'innesto**: fatto, oppure bloccato dal freeze con l'innesto necessario
  - limiti residui

## Prima di iniziare

1. `git fetch` e **verifica l'HEAD attuale** del branch: la base dichiarata è
   `25a9d89`, ma se `origin/main` è avanzata, **adattati e dichiaralo**.
2. Leggi `WS-MINISTER-UX-00-report.md` (contratto) e i report UX-01..UX-04
   (cosa è già stato consegnato): **non riscrivere** ciò che è già fatto.
3. **Non** introdurre direttive di presentazione (UX-03), grafici/mappe (UX-04) o
   il flusso proposta→firma (UX-06): questa fase è **memoria**.

## Consegna

Commit sul branch `feat/ws-minister-ux-05-memoria-persistente`, poi **push**.
La PR la apro io. Messaggi di commit in italiano, convenzione del repo.

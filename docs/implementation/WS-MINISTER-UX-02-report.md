# WS-MINISTER-UX-02 — Ministro discorsivo con identità e priorità

> Il ministro smette di essere un ripetitore di cifre e diventa **una persona con
> un ruolo, una voce e delle priorità** — restando però una fonte di
> *interpretazione*, mai di *dati*.

- **Ramo**: `feat/ws-minister-ux-02-identita-ministro` (base `5ec7cdc`, task file
  in `24de93a`).
- **Contratti di riferimento**: `docs/implementation/WS-MINISTER-UX-00-report.md`
  §3–§4; `docs/implementation/WS-MINISTER-UX-01-report.md`.
- **Freeze**: CORE ENGINE FREEZE rispettato. Nessun file toccato in
  `core/simulation/**`, nessuna modifica a schema/DB, pipeline o sessione.
- **Nessun effetto sociale/economico introdotto**; nessun numero di gioco nuovo.

---

## 1. Cosa è cambiato nel prompt

### La riga vecchia (rimossa da `MinisterChat.ts`)

```
- Non aggiungere aneddoti, nomi, date, promesse o opinioni: ogni frase deve poggiare su un campo che vedi qui.
```

Era una gabbia giusta nella paura sbagliata: vietava le opinioni **insieme** agli
aneddoti, così il ministro non poteva raccomandare nulla. Il rischio vero non era
«avere un'opinione», ma **confondere un'opinione con un dato**.

### La riga nuova (al suo posto)

```
- Non aggiungere aneddoti, nomi propri, date o promesse: quei campi non esistono nel briefing.
- Puoi avere una LETTURA e una PROPOSTA: sono tue, e le argomenti con la tua voce. Ma non sono un dato.
- Se l'obiettivo è chiaro ma manca un dettaglio per decidere, chiedilo: una domanda mirata, non un questionario.
- Se la cronologia mostra che avete già parlato, NON ripresentarti: riprendi il filo della conversazione.
```

E, sopra a queste, il contratto a **tre livelli** che tiene separate le nature:

```
COME RAGIONI — TRE LIVELLI, MAI CONFUSI:
- FATTI: le cifre qui sotto, con la loro provenienza. Non ne aggiungi, non ne deduci, non ne arrotondi.
- LETTURA: cosa ne deduci **tu**. È tua, non è un dato: dilla come tua («a mio avviso», «mi pare»).
- PROPOSTA: cosa raccomandi, con il compromesso dichiarato («costa X, ma rende Y»). Non decidi: proponi.
REGOLA INVIOLABILE: un'opinione non è un dato. Il tuo profilo ti dà una voce e delle priorità,
NON delle cifre: dove il dato è «DATO MANCANTE» resta mancante, e il tuo profilo non ti autorizza a stimare.
```

Restano intatte le regole storiche: cifre solo dal briefing, `DATO MANCANTE`
dichiarato, nessun impegno, competenza delimitata, «racconta, non elencare».

### Il rimando al collega non è più secco

`colleagueRedirect()` prima diceva soltanto «Non è la mia materia: <collega> se ne
occupa». Ora nomina il collega **e** dice cosa guarderebbe il ministro nella
propria materia, senza decidere al posto di chi ha la competenza:

```
Non è la mia materia: Ministro dei Lavori se ne occupa, e legge cantieri, deficit misurati, opere del catalogo.
Ma posso dirti cosa guarderei io: bilancio, debito, cassa e crediti del paese — è da lì che partirei,
senza decidere al posto di chi ha la competenza.
```

Solo `SEAT_LABEL` e `SEAT_READS`: nessun fatto nuovo.

## 2. Dove vive il profilo

Nuovo modulo **puro** accanto a `MinisterChat.ts`:

`backend-nest/src/core/government/MinisterPersona.ts`

- `MinisterPersona` — dato tipizzato: `mandate`, `voice`, `priorities`, `risk`,
  `president`, `signature`.
- `MINISTER_PERSONAS: Record<CabinetSeat, MinisterPersona>` — un profilo per
  **ogni** sedia; la totalità è garantita dal tipo.
- `personaFor(seat)`, `personaSection(persona)` — la sezione «CHI SEI E COME
  PARLI» consumata da `briefingFor()`.
- `firstMessage(seat, items)` — il vero primo messaggio (incarico + una o due
  questioni + invito a indicare la priorità).

`briefingFor()` lo consuma; `Cabinet.composeCabinet()` usa `firstMessage` per
`address.opening`; `openingMessage()` lo usa per la chat a messaggio vuoto. Il
modulo **non** ha I/O, stato o chiamate al modello: importa solo il tipo
`CabinetSeat` (import type-only, nessun ciclo a runtime).

Nessuna logica di presentazione duplicata nel frontend: il frontend mostra
`address.opening`, che ora è il primo messaggio composto dal profilo — **senza
toccare il layout di UX-01**.

## 3. Il profilo di ogni sedia

| Sedia | Incarico (mandate) | Voce | Priorità | Rischio | Col Presidente | Firma |
|---|---|---|---|---|---|---|
| **Tesoro** | «Ho la responsabilità della cassa, del debito e del credito del paese.» | Asciutto e numerico | Tenere in ordine i conti, coprire l'urgente, non ipotecare il futuro | Bassa | Leale ma franco | «Facciamo i conti prima di promettere.» |
| **Lavori** | «Rispondo delle opere e dei cantieri: di ciò che si costruisce e di ciò che si ferma.» | Concreto e operativo | Far partire i cantieri, sciogliere i colli di bottiglia, dare lavoro | Media | Diretto, da capo cantiere | «Ditemi dove e io vi dico cosa serve per partire.» |
| **Istruzione** | «Rispondo di scuole, atenei e formazione: del paese che saremo fra dieci anni.» | Didattico e paziente | Istruire prima di raccogliere, investire sul lungo periodo | Bassa | Rispettoso e insistente | «Una scuola oggi è un problema in meno fra dieci anni.» |
| **Sanità** | «Rispondo della salute e del sostegno a chi non può farcela da solo.» | Umano e concreto | Curare, prevenire, proteggere i più deboli | Media | Appassionato ma composto | «Dietro ogni cifra c'è qualcuno che aspetta.» |
| **Esteri** | «Rispondo delle relazioni con l'estero, dei trattati e della reputazione del paese.» | Diplomatico e misurato | Coltivare relazioni, contratti vantaggiosi, non isolarsi | Calcolata | Formale e chiaro | «Ogni porta aperta è un'opzione in più, ogni porta chiusa un costo.» |
| **Interno** | «Rispondo della coesione del paese e dell'ordine pubblico.» | Prudente e attento | Tenere insieme il paese, quietare la piazza | Bassa | Leale e vigile | «Prima di decidere, guardiamo chi resta fuori dalla decisione.» |
| **Guerra** | «Rispondo della difesa del paese, delle forze e delle scorte.» | Essenziale e sobrio | Difesa credibile, deterrenza prima dell'avventura | Preparata | Sobrio e diretto | «La forza che rassicura è quella che non deve sparare.» |

Nessun nome proprio, nessuna data, nessuna biografia storica: solo ruolo, voce e
priorità, coerenti con lo scenario. **Nessuna cifra**: un test lo impone.

## 4. Primo messaggio e riapertura

- **Prima seduta** — `firstMessage()` compone: incarico (dal profilo) → «Ho N
  cosa/e da portare al consiglio» → la/le questioni più urgenti (max **due**,
  con il loro *perché*) → se ci sono almeno due strade, la scelta con i titoli →
  `Dimmi tu qual è la priorità da cui partire.`
- **Riapertura** — il greeting UX-01 scompare appena esiste cronologia; il
  contesto istruisce il modello a **non ripresentarsi**. Ma la continuità è
  **parziale**: senza memoria persistente (UX-05) la cronologia vive solo in RAM
  nel client (`chatStore`, nessun `persist`). Al reload la seduta si riapre
  daccapo. **Non è promesso il contrario.**

## 5. Test aggiunti e aggiornati

Nuovo file `backend-nest/tests/ws-minister-ux-02.test.ts` — **13 test**:

1. ogni sedia ha un profilo completo (tutti i tratti non vuoti);
2. il profilo **non contiene cifre** (profilo e sezione: `not.toMatch(/\d/)`);
3. ogni briefing porta il proprio profilo e la sezione;
4. **due ministri, la stessa questione**: contesti diversi, voce/priorità/firma
   proprie di ciascuno e assenti in quello dell'altro;
5. il briefing distingue **FATTI / LETTURA / PROPOSTA**;
6. **«aiutare le famiglie senza peggiorare il bilancio»**: il Tesoro è competente
   (nessun rimando), il contesto chiede ragionamento e domanda mirata;
7. il profilo **non aggiunge cifre né trasforma un `unknown` in stima**;
8. il rimando al collega **non è secco**: nomina il collega e dice cosa
   guarderebbe lui, senza decidere al posto suo;
9. il formato discorsivo regge col profilo attivo («racconta, non elencare»,
   «Non sei neutrale»);
10. primo messaggio: incarico + questioni + invito alla priorità;
11. il primo messaggio non è un elenco: **massimo due** questioni;
12. sedia senza bisogni: non finge una preoccupazione;
13. riapertura: il contesto impone di non ripresentarsi (continuità parziale).

Test esistenti aggiornati per il comportamento **intenzionalmente nuovo**, senza
allentare le invarianti:

- `tests/p01-cabinet.test.ts` — le tre asserzioni della frase d'apertura ora
  verificano la nuova sostanza: il conteggio resta un numero
  (`/Ho \d+ cosa?/`, e **mai** «Ho l cosa») **più** l'incarico e l'invito alla
  priorità. Il vecchio `not.toMatch(/\bl\b/i)` è stato reso più preciso
  (`not.toMatch(/\bHo l\b/i)`) perché l'elisione italiana «l'ha», ora presente
  nel primo messaggio, non è un conteggio.
- `tests/p02b-minister-chat.test.ts` — la regola «niente opinioni» è sostituita
  dalle asserzioni sui tre livelli e su «un'opinione non è un dato»; restano
  le invarianti sui colleghi, sulle cifre e sul `DATO MANCANTE`.

### Esiti

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` (backend) | pulito |
| `vitest run` (backend) | **201 file / 2123 test** verdi (baseline 200/2110 → +1 file / +13 test) |
| `npx tsc --noEmit` (frontend) | pulito |
| `vitest run` (frontend) | **111 file / 933 test** verdi (invariato) |
| `npm run build:frontend` | build ok |

> Nota di igiene: la cartella `dist/` (non versionata) conteneva vecchie copie
> compilate dei `.test.ts` in `src/`; vanno rimosse prima di lanciare `vitest`,
> altrimenti falliscono per `require('vitest')` in CommonJS. È preesistente e non
> riguarda questa modifica.

## 6. Limiti residui

- **Continuità parziale.** La riapertura non ripete la presentazione, ma si basa
  sulla sola RAM del client: **non è memoria persistente**. L'innesto reale è
  **UX-05** (ricordi indicizzati, copiati al fork, filtrati al rewind). Qui è
  preparato il contratto (istruzione nel prompt), non l'infrastruttura.
- **Il test misura il contratto, non l'output del modello.** I test verificano
  che il contesto *chieda* ragionamento, domande mirate e distinzione fra i
  livelli; la resa dipende dal modello. Non c'è ancora un test end-to-end con
  LLM reale, e non è stato introdotto qui.
- **La mappa`argomento → collega` resta a parole chiave** (`SEAT_TOPICS`): è la
  stessa di WS-GOVOFFICE-05, non un classificatore. Una domanda ambigua può non
  produrre rimando, ma non inventa un collega.
- **Nessuna direttiva di presentazione** (UX-03) e **nessuna memoria** (UX-05):
  fuori scope per questa fase, come richiesto.
- **Nessun effetto sociale/economico** nuovo: gli esiti restano del motore.

## 7. Freeze e innesto necessario

Non è stato necessario toccare la simulazione: il profilo e il contratto vivono
in `core/government/**`, moduli puri di composizione del testo. **Nessun innesto
rimandato per freeze.**

---

**File della consegna**

- nuovo: `backend-nest/src/core/government/MinisterPersona.ts`
- modificati: `backend-nest/src/core/government/MinisterChat.ts`,
  `backend-nest/src/core/government/Cabinet.ts`
- test: nuovo `backend-nest/tests/ws-minister-ux-02.test.ts`;
  aggiornati `backend-nest/tests/p01-cabinet.test.ts`,
  `backend-nest/tests/p02b-minister-chat.test.ts`
- report: questo documento

# World Story — piano maestro: governare una nazione possibile

**Versione:** proposta normativa 1.0, 8 settembre 2026.  
**Stato:** piano da implementare, NON funzionalità già disponibili.  
**Destinatari:** sviluppatori e LLM esecutori; ogni scelta marcata «obbligatoria» è un contratto, non un suggerimento estetico.

## Indice

1. Obiettivo e perimetro
2. Invarianti
3. Esperienza distintiva e ciclo di gioco
4. Stato materiale, unità e cataloghi
5. Ordini, fattibilità e autorizzazioni
6. Tesoreria, filiere e logistica
7. Progetti, ricerca e capacità nazionali
8. Tempo, NPC, LLM ed effetti
9. Architettura, persistenza e API
10. Desktop, mobile e identità grafica
11. Compatibilità, sicurezza e prestazioni
12. Criteri di completamento

**Lettura obbligatoria prima dell'implementazione:** [audit](AUDIT_CONFORMITA_PARITA_2026-09-08.md), [specifica originale](SPEC_PARITA_PAX_HISTORIA_AZIONI_EVENTI_TIMELINE.md), [pacchetti e test](PIANO_ESECUTIVO_LLM_REALISMO_UX.md).

---

## 1. Obiettivo e perimetro

### 1.1 Promessa di prodotto

**Scrivi ciò che vuoi ottenere. Comprendi cosa manca. Decidi come procurartelo. Osserva conseguenze spiegabili.**

World Story deve essere un gioco di governo, non un terminale che concede qualsiasi desiderio né un foglio contabile che richiede di controllare ogni camion. Il giocatore può scendere nel dettaglio, ma può anche assegnare obiettivi e delegare entro limiti espliciti.

La nazione non coincide con la provincia selezionata o con la sua capitale. Risorse territoriali, conti nazionali, imprese, governo e forze armate sono concetti distinti. La mappa rimane la superficie geografica; il dossier è la superficie delle decisioni.

### 1.2 Tre livelli di profondità, stesse regole

| Livello UI | Cosa decide il giocatore | Cosa non cambia |
|---|---|---|
| Guidato, predefinito | Obiettivo, limite di spesa, priorità; conferma il piano | Vincoli materiali e tempi reali del modello |
| Gestionale | Fasi, approvvigionamenti, assegnazione capacità e fondi | Nessuna creazione gratuita, nessun anticipo del futuro |
| Esperto | Ricette, contratti, priorità granulari, manutenzione e copertura finanziaria | Stesso ledger e stesso validatore server |

La difficoltà può cambiare qualità delle informazioni, competitività NPC e assistenza. **Non** può creare materie prime, annullare costi o rendere una tecnologia nota per decreto.

### 1.3 Rilasci, per evitare un progetto infinito

- **R0 — affidabilità:** risolvere i rilievi F00–F06 prima di introdurre un'economia mutante.
- **R1 — verticale rigoroso:** un pacchetto scenario pilota validato; costruzione di un impianto, approvvigionamento, formazione di personale e ricerca di una capacità, con contabilità e Save/Load completi. Catalogo piccolo ma chiuso su tutte le dipendenze. Regole applicate anche agli NPC coinvolti e ai loro fornitori.
- **R2 — gestione nazionale:** produzione continuativa, logistica, servizi, politiche fiscali e accordi strutturati; più scenari validati.
- **R3 — profondità:** mercato più articolato, ricerca avanzata, incertezza informativa e automazioni più sofisticate dopo calibrazione.

Non attivare una funzione materiale in modalità rigorosa se dipende da una scorciatoia non modellata. Mostrare «non ancora simulato» e consentire la pianificazione, non inventare effetti per colmare il vuoto.

---

## 2. Invarianti obbligatorie

| ID | Contratto |
|---|---|
| I01 | GET, mount, lettura chat, cronaca, polling e attesa reale non avanzano il mondo. |
| I02 | Registrare/modificare un ordine non esegue lavori e non contabilizza costi materiali. |
| I03 | Un salto prende un solo lotto, con risorse condivise e priorità esplicite. |
| I04 | Saldo, stock e capacità non sono rispendibili attraverso due ordini o due client. |
| I05 | Saldi fisici, importi di trasferimento e riserve sono non negativi; le scritture ledger possono avere delta firmati bilanciati. Vietati NaN, infinito, unità ignote e conversioni implicite. Un prelievo legittimo non è uno stock negativo. |
| I06 | PIL, entrate, cassa, debito e stanziamento sono entità diverse. Un PIL alto non paga automaticamente un ordine. |
| I07 | Risorsa nel sottosuolo ≠ risorsa estratta ≠ prodotto raffinato ≠ stock consegnato e disponibile. |
| I08 | Conoscere un principio ≠ saper progettare ≠ produrre ≠ utilizzare ≠ mantenere un bene. |
| I09 | Un ordine politico non crea consenso, accordi commerciali, credito o capacità tecnica per il solo fatto di essere formulato. |
| I10 | Una struttura produttiva esiste operativamente solo dopo un progetto verificato e il collaudo. Il cantiere è un'entità distinta. |
| I11 | Durante uno stop si applicano soltanto effetti datati entro il checkpoint confermato, anche in outcome, chat, memoria e API. |
| I12 | Tutte le mutazioni del checkpoint sono atomiche; pubblicazione successiva al commit. |
| I13 | Save/Load/Rewind comprendono fondi, stock, prenotazioni, contratti, personale, progetti, conoscenze, casualità e playback. |
| I14 | Stesse regole materiali per giocatore e NPC; eventuale aggregazione NPC deve conservare quantità e capacità. |
| I15 | ID esatti, non titolo o indice, collegano ordini, processi, effetti e cause. Riferimenti ambigui richiedono chiarimento. |
| I16 | L'incertezza simulata riguarda l'esito e la conoscenza dei fatti, non il permesso di violare le risorse. |
| I17 | Uno stato sconosciuto è `unknown`, non `0`, non disponibilità illimitata e non successo presunto. |
| I18 | Il server ricalcola la fattibilità al commit: la preview non è una garanzia e il client non è fonte dei costi. |

---

## 3. Esperienza distintiva: la catena della fattibilità

### 3.1 Elemento distintivo

Il segno caratteristico di World Story sarà la **catena della fattibilità**: ogni decisione collega obiettivo → conoscenze → capacità → materiali → finanziamento → tempi → effetto osservabile. Non un diagramma ornamentale: ciascun nodo si apre sul dato, sul deficit e sulle alternative.

Esempio testuale:

```text
Impianto di fertilizzanti · Porto Nord
Tecnica ✓ → Progettazione ✓ → Squadre 70% → Acciaio 40/60 t
                                      ↘ Energia insufficiente
Fondi: 1,2 M disponibili / 1,6 M richiesti per la prima fase
Esito: NON AVVIABILE alle condizioni attuali
[Confronta alternative] [Modifica piano]
```

Le cifre dell'esempio sono **fittizie di UX**, non valori economici da copiare nei preset. Le schede reali provengono dal server.

### 3.2 Flusso di un ordine

1. Il giocatore scrive «voglio ridurre la dipendenza dall'estero per i fertilizzanti».
2. La LLM identifica un **obiettivo**, non presume autorizzata la costruzione di dieci impianti.
3. Il sistema presenta opzioni: efficientamento, accordo d'importazione, studio di un impianto locale. Nessuna è automaticamente scelta.
4. Se l'utente sceglie un piano, il preflight espone requisiti, risorse concorrenti, costi per fase, tempi condizionati e rischi.
5. «Registra ordine» memorizza intenzione e limiti. La data rimane ferma.
6. «Avanza» mostra riepilogo del lotto e della destinazione. Nuova verifica delle risorse prima dell'emissione.
7. Nel salto il motore avvia solo le fasi autorizzate e fattibili. Se accade una crisi, la costruzione non viene completata per chiudere il racconto.
8. Il dispaccio espone ciò che è realmente avvenuto e «Perché»: ordine, fase, quantità impegnate/consumate ed effetti.
9. Il progetto rimane nel dossier e prosegue ai salti successivi senza reimpartire il testo.

### 3.3 Errori che aiutano a decidere

Non usare «azione non valida» come unica informazione. Esempi:

- «Mancano 20 t di acciaio consegnato. Una nave in arrivo non è ancora stock utilizzabile.»
- «La nazione conosce questa tecnologia, ma non dispone di una linea produttiva certificata.»
- «La cassa è sufficiente per l'avvio, non per tre mesi di esercizio. Puoi ridurre la scala o autorizzare un finanziamento.»
- «Due progetti richiedono la stessa squadra. Scegli quale avviare per primo.»
- «Dati geologici non disponibili per questa regione. Puoi finanziare una prospezione; il risultato non è garantito.»

Ogni blocco indica **cosa manca, dove verificarlo, alternative e loro nuove dipendenze**. Mai proporre «importa» come soluzione già riuscita: servono venditore, disponibilità, prezzo e trasporto.

---

## 4. Stato materiale, unità e cataloghi

### 4.1 Convenzioni numeriche

1. Grandezze additive del ledger: interi a precisione arbitraria nel dominio (`bigint`), stringhe decimali canoniche nei JSON e nello storage SQLite `TEXT`. Vietato convertirle a `Number` per confronti/somme. I repository usano un codec comune; niente `SUM()` SQL sui valori testuali.
2. Denaro in unità monetarie minime definite dal catalogo valuta. Materiali in unità base definite dal catalogo risorsa. Nessun importo monetario con float IEEE-754.
3. Ratei/tassi: razionali interi `numerator/denominator`, denominatore positivo. Carry dei resti persistito: frammentare un salto non deve creare o perdere quantità per arrotondamento.
4. Percentuali UI sono proiezioni; non si rilegge dal DOM un valore per la simulazione.
5. Il calendario usa UTC e date validate. Per interessi R1 adottare **ACT/365F**, convenzione esplicita nel contratto; cambi futuri richiedono versione. Il mese di calendario resta calendario, non 30 giorni.
6. Unità illustrative: minerali kg, liquidi L a specifica dichiarata oppure kg (non entrambi senza conversione), energia Wh per intervallo, potenza W, lavoro in minuti-persona qualificati. Le risorse discrete usano pezzi interi.
7. Capacità e quantità non si sommano: MW non è MWh, persone non è ore di lavoro, capacità di porto non è merce.
8. I valori di test con valuta `TEST` sono convenzioni di test. Non diventano prezzi storici.

### 4.2 Schemi di dominio minimi

Frammenti concettuali: l'esecutore deve completarli in schemi runtime discriminati, non limitarsi alle interfacce TypeScript.

```ts
type IntString = string; // codec: /^-?(0|[1-9][0-9]*)$/, no -0; vincoli di segno per campo
type Amount = { currencyId: string; minorUnits: IntString };
type Quantity = { resourceId: string; baseUnits: IntString };
type SourceQuality = 'sourced' | 'estimated' | 'authored' | 'unknown';
type Evidence = {
  quality: SourceQuality;
  sourceRefs: string[];
  validAt: string;
  methodVersion?: string;
};
type Scope = { gameId: string; branchId: string };
type StateAnchor = Scope & { checkpointId: string; revision: number };
```

Una quantità esistente non usa numeri sconosciuti: per dati incompleti definire una union `Known<T> | Unknown`, con motivazione. Per intervalli stimati usare `low/base/high` e provenienza; un intervallo non è una probabilità scientifica.

**Distinguere due tipi di ignoranza:**
- `model_data_missing`: il motore non possiede un dato autorevole. Risultato `needs_data`; una prospezione non può generare casualmente il valore mancante per sbloccare l'azione.
- `hidden_from_player`: il motore possiede un valore/dinamica del catalogo, ma il giocatore non lo conosce. Una ricerca/prospezione autorizzata può rivelarlo secondo il modello, senza inventarlo al momento della domanda.

Una stima approvata ha un `executionValue` versionato, oppure una distribuzione definita con seed e realizzazione persistita. `low/base/high` serve alla spiegazione/previsione; il validatore non sceglie opportunisticamente `high` per autorizzare una spesa. Nessuna proiezione informativa deve esporre al giocatore lo stato segreto tramite assessment o blocker troppo precisi.

### 4.3 Entità e fonte di verità

| Entità | Campi essenziali | Regola |
|---|---|---|
| ScenarioManifest | ID/versione, data, schema, hash cataloghi, modalità, fonti | Immutabile per partita/ramo salvo migrazione esplicita |
| Polity | ID storico stabile, nome, forma di governo datata, territorio/istituzioni | Nessun PIL moderno universale applicato per codice ISO |
| Treasury | valuta, conti, cassa, riserve monetarie, debiti, autorizzazioni | Derivata da ledger; snapshot verificabile |
| ResourceDefinition | unità, conservazione, deterioramento, trasportabilità | Unità non riscritta dal modello |
| Deposit | risorsa, posizione, quantità conosciuta/stimata, accessibilità, rendimento | Esaurimento solo per estrazione; ignoranza distinta da assenza |
| InventoryLot | owner/custodian, luogo, risorsa, quantità, qualità, vincoli | Disponibile solo se posseduto/autorizzato e consegnato |
| Facility | ownerActorId/controllerActorId, recipe/capability IDs, stato, posizione, capacità, manutenzione | Nessuna produzione prima di collaudo o uso senza diritto |
| WorkforcePool | qualifica, località, persone/ore disponibili, assegnazioni | Formazione rialloca persone, non le crea |
| Knowledge/Capability | livello, dominio, dipendenze, accesso, scadenza licenze | Conoscenza/importazione/produzione separate |
| Project | ordine origine, fasi, progressi, assegnazioni, speso, blocchi | Avanza per lavoro realmente erogato |
| Contract/Shipment | parti, oggetto, quantità, prezzo, riserve, rotta, date, stato | Non diventa consegna da una chat positiva |
| PolicyMandate | obiettivo, tetti, azioni ammesse, scadenza, escalation | Consente delega controllata, non libertà illimitata alla LLM |
| LedgerEntry | causale, scope, evento/fase, conti/lotti, delta, data, chiave unica | Append-only nel ramo; un retry non duplica |

### 4.3.1 Nazione, proprietà e diritto d'uso

Aggiungere `EconomicActor` distinto da `Polity`: tesoro, impresa pubblica, impresa privata/settore aggregato, banca/prestatore, trasportatore. Ogni attore ha `actorId`, `polityId`, tipo, conti e regole di controllo. Fondi, lotti, impianti e bacini/contratti di lavoro fanno capo a un attore; il totale nazionale è una proiezione, **non un portafoglio comune**.

Ogni allocazione identifica `ownerActorId`, `controllerActorId`, eventuale `custodianActorId` e `rightRef`: proprietà pubblica, contratto di acquisto/locazione/lavoro o altra autorizzazione istituzionale modellata. Il governo non spende la cassa privata e non usa l'acciaio nazionale privato senza transazione o potere legale effettivo. Un'impresa pubblica controllata non trasferisce automaticamente tutto il proprio stock al tesoro.

R1 richiede una matrice minima di autorità nel catalogo: attore decisore, attività ammesse, limiti e approvazioni necessarie. Separare tre consensi: **conferma dell'utente**, **approvazione istituzionale**, **accettazione della controparte**. Nessuno sostituisce gli altri. Riforme non modellate restano proposte senza effetti fiscali, di proprietà o consenso. Un decreto non costituisce di per sé una requisizione eseguita. Le stesse regole valgono per NPC e settori aggregati.

### 4.4 Dati di scenario

Proposta cartelle nuove dentro ogni preset abilitato:

```text
simulation/manifest.json
simulation/polities.json
simulation/resources.json
simulation/technologies.json
simulation/recipes.json
simulation/facilities.json
simulation/initial-state.json
simulation/policies.json
simulation/sources.md
```

- Il loader valida riferimenti, DAG, unità, date, quantità, bilanci iniziali, territorio, somma personale e capacità. Import con errore produce un rapporto di percorsi JSON precisi, non fallback silenzioso.
- La copertura del catalogo è una **chiusura transitiva**: una ricetta non può richiedere un prodotto senza stock iniziale giustificato, importazione valida o filiera definita.
- Distinguere grafi: conoscenze e fasi progetto devono essere DAG; reti produttive possono contenere riciclo a durata positiva e con perdite/consumi espliciti. Rifiutare cicli a tempo zero e ricette amplificatrici non giustificate, non ogni ciclo industriale.
- Prerequisiti con `allOf` e alternative `anyOf` espliciti oppure recipe ID alternativi. Una via sostitutiva non impone i requisiti della via scartata; la ricetta scelta e l'eventuale sostituzione materiale vanno confermate nel piano.
- Dataset grandi possono essere condivisi tramite ID/hash di catalogo; clone preset crea una nuova versione senza mutare le partite già avviate.
- LLM può proporre dati di un preset in bozza; non pubblicarli come `sourced`. Fonti ed eventuali licenze vanno verificate.
- Per R1 scegliere un solo scenario pilota e un paniere iniziale piccolo; la scelta va registrata in F00/M01. Gli altri preset rimangono dichiaratamente legacy fino alla migrazione.
- L'intestazione del gioco usa una data corrente autorevole distinta da nome/versione/data di creazione del preset: niente titoli «2026» usati come calendario di una partita 2024.

---

## 5. Ordini, fattibilità e autorizzazioni

### 5.1 Stati separati

```text
Consegna ordine:
queued → issued
queued → cancelled

Valutazione (non attuazione):
needs_clarification | needs_data | blocked | feasible | feasible_with_conditions

Attuazione:
not_started → in_progress → completed
                      ↘ blocked → in_progress
                      ↘ failed | cancelled
not_started → rejected
```

`accepted` legacy non significa `completed`: la migrazione deve conservare il significato originale in un campo legacy e non inventare avanzamento materiale. L'ordine emesso non viene nuovamente accodato. Annullamento di un progetto emesso è un nuovo comando con effetti al prossimo avanzamento; non cancella ledger e storia.

### 5.2 Contratto dell'ordine

```ts
type OrderIntent = {
  id: string;
  actorPolityId: string;  // verificato server, mai fidarsi del body
  originalText: string;
  actionKind: 'construct' | 'produce' | 'procure' | 'research' |
    'train' | 'maintain' | 'move' | 'policy' | 'diplomatic_proposal' |
    'cancel_project' | 'qualitative';
  targetIds: string[];
  catalogRef?: string;
  quantity?: Quantity;
  priority: number;      // ordine definito nel lotto
  dependencyIds: string[];
  authorization: {
    maxCommitment?: Amount;
    allowPartialStart: boolean;
    allowedPhaseIds: string[];
    financingPolicyId?: string;
    delegationMandateId?: string;
  };
};
```

È uno schema illustrativo: implementare union per `actionKind` con campi obbligatori specifici. `qualitative` non può contenere `spawn`, delta di denaro o trasferimenti di territorio; gli effetti materiali devono tornare in una categoria modellata.

**Chiarimenti obbligatori:** quantità/unità, destinazione, budget o intenzione mancanti quando cambiano materialmente il significato. Il sistema può proporre valori, ma deve mostrarli prima della conferma. Un ordine composto conserva padre/figli con ID e stato, senza duplicare costi.

### 5.3 Preflight batch, non singolo semaforo

`evaluateBatch(anchor, orderedIntents, catalogs)` è puro rispetto allo stato canonico. Può essere invocato senza chiamate LLM per ordini già normalizzati.

Ordine delle verifiche:

1. Schema, scope, autorizzazione del giocatore, ID e quantità.
2. Dipendenze del piano senza cicli, assenza di sottoazioni non autorizzate.
3. Compatibilità con scenario e conoscenze effettive.
4. Progettazione/capacità industriale/operativa necessaria per quella specifica attività.
5. Territorio, accesso, autorizzazioni legali/amministrative, infrastrutture.
6. Stock consegnati accessibili all'attore: liberi oppure già riservati allo stesso progetto/fase; mai riserve di un altro progetto. Materie prime raffinate e componenti secondo ricetta.
7. Personale qualificato e slot produttivi/logistici nell'intervallo.
8. Cassa/fondi autorizzati, obblighi già assunti, credito effettivamente disponibile.
9. Tempi minimi, fasi e dipendenze temporali; costi ricorrenti e manutenzione.
10. Concorrenza di tutto il lotto, secondo priorità confermata.
11. Esito per ordine e per fase, ragioni strutturate, alternative non applicate.

**Politica di allocazione R1:** ordine di priorità scelto dall'utente, tie-break `queueSequence` server. Prima obblighi già contrattualizzati secondo le rispettive regole, poi nuovi progetti. Un ordine emesso e rifiutato non è ritentato automaticamente ai salti successivi: serve una nuova decisione collegata all'ordine originale. Un progetto autorizzato già `blocked` viene invece rivalutato ai confini temporali senza nuova emissione. Nessun ordinamento nascosto per «preferenza» della LLM. In assenza di risorse per un intero avvio e con `allowPartialStart=false`, non avviare quell'ordine; valutare i successivi. Con avvio parziale esplicito, consentire soltanto fasi finanziabili/autorizzate, non completamenti proporzionali di un bene indivisibile.

### 5.4 Risposta di fattibilità

```json
{
  "anchor": {"gameId":"g","branchId":"b","checkpointId":"c","revision":42},
  "catalogVersion":"pilot-1",
  "assessmentId":"eval-17",
  "orders":[{
    "actionId":"a2",
    "status":"blocked",
    "blockers":[{
      "code":"MATERIAL_SHORTAGE",
      "resourceId":"steel",
      "locationId":"r1",
      "requiredBaseUnits":"60000",
      "availableBaseUnits":"40000",
      "missingBaseUnits":"20000",
      "reservationRefs":["a1"]
    }],
    "warnings":[],
    "alternatives":[{"kind":"reduce_scope","requiresConfirmation":true}]
  }],
  "canonicalMutation":false
}
```

Codici minimi: `UNKNOWN_ENTITY`, `AMBIGUOUS_TARGET`, `UNAUTHORIZED_ACTOR`, `UNSUPPORTED_CAPABILITY`, `KNOWLEDGE_MISSING`, `INDUSTRIAL_CAPABILITY_MISSING`, `MATERIAL_SHORTAGE`, `ENERGY_SHORTAGE`, `WORKFORCE_SHORTAGE`, `LOGISTICS_BLOCKED`, `INSUFFICIENT_CASH`, `FINANCING_UNAVAILABLE`, `BUDGET_AUTHORIZATION_MISSING`, `DEADLINE_INFEASIBLE`, `DEPENDENCY_BLOCKED`, `DATA_UNAVAILABLE`, `STALE_ASSESSMENT`.

Preview memorizzabile come cache con TTL, ma **nessuna prenotazione durevole** finché gli ordini non sono emessi dal comando di tempo. Non prenotare acciaio o fondi semplicemente aprendo il pannello.

### 5.5 Ordini impossibili e nuove idee

- «Costruisci semiconduttori avanzati nel 1939»: niente whitelist testuale di anni. Valutare la catena di conoscenze, precisione, materiali, energia, progettazione e capacità mancanti; nessun impianto creato. Offrire un programma di ricerca/formazione pertinente, non garanzia di arrivare alla tecnologia finale.
- «Ho scoperto una fonte energetica illimitata»: la frase non introduce una nuova legge fisica o una ricetta. Può diventare proposta di studio solo su conferma.
- «Importa un macchinario che non sappiamo costruire»: può essere possibile se esistono fornitore, fondi, accesso, trasporto, installazione e manutenzione. Non richiedere la capacità di fabbricarlo per comprarlo; non concedere automaticamente la capacità di riprodurlo.
- «Dichiara una riforma»: non va rifiutata perché non esiste una ricetta industriale; modellare proposta, iter istituzionale, costo amministrativo e attuazione. L'annuncio non modifica istantaneamente l'aliquota incassata o il consenso.
- Contenuto non classificabile: `needs_clarification`/`unsupported`, con bozza conservata; mai successo gratuito per default.

---

## 6. Tesoreria, filiere e logistica

### 6.1 Finanza: stock e flussi

Per valuta e data, `cassa` indica i soli conti liquidi utilizzabili dall'attore; escrow/denaro vincolato è un conto distinto, non parte della cassa disponibile. L'eventuale patrimonio finanziario complessivo è una proiezione separata.

```text
cassaFinale = cassaIniziale + incassi + prestitiErogati
             - pagamenti - rimborsi - interessiPagati

disponibilePerNuoviImpegni = max(0, cassa - riserveMonetarieAttive)
stanziamentoResiduo = massimaleAutorizzato - impegniAttivi - spesaGiaEseguita
```

Il `max` serve soltanto a esporre disponibilità: non può nascondere una violazione `riserve > cassa`, che deve generare riconciliazione/insolvenza e blocco dei nuovi impegni.

- Stanziamento ≠ cassa; entrate future previste ≠ incassate; asset pubblici ≠ fondi liquidi.
- In R1 finanziare interamente l'avvio di ogni fase prima di attivarla. Le fasi future mostrano fabbisogno previsto ma non prenotano denaro inesistente.
- Prestito: contratto con prestatore/strumento, limite, valuta, tasso, scadenza e calendario erogazione. Nessuna liquidità creata chiamando un campo `debt`.
- Emissione monetaria solo come politica modellata e autorizzata, con contropartita nel ledger e conseguenze; fuori perimetro R1 se il modello non la rappresenta. Non usarla come fallback automatico.
- Pagamenti interni possono trasferire valore da tesoro a settore privato aggregato, non annullare il PIL come costo. Ammessi conti esterni/settoriali espliciti; vietata la cassa senza origine.
- R1 un numerario per scenario riduce complessità: etichettarlo come unità di simulazione a prezzi dell'anno base, non USD correnti. Se si usano più valute, il cambio deve essere una transazione con quotazione datata e costi, non una somma di importi eterogenei.
- Carenza di cassa per obblighi: applicare priorità legali del catalogo, arretrati/default e blocco nuove spese; non portare semplicemente il saldo a zero perdendo il debito.

### 6.2 Ledger e prenotazioni

Ogni trasferimento monetario ha conti di origine/destinazione bilanciati nella stessa valuta. Ogni movimento fisico indica provenienza e destinazione; estrazione, produzione, scarto e consumo sono causali distinte.

```text
stockFinale = stockIniziale + estrazione + outputProduzione + consegne
             - inputProduzione - partenze - consumo - perdite
stockLibero = stockPossedutoNelLuogo - prenotazioniAttive
```

- Prenotare non consuma. Consumare converte una prenotazione in movimento e ne riduce il residuo nella stessa transazione. Trasferire cassa in escrow estingue la prenotazione d'acquisto corrispondente: vietato mantenere la stessa somma sia sottratta dalla cassa sia riservata su di essa.
- Due lotti non possono prenotare la stessa quantità. Lo stesso ordine non può contare due volte una riserva, come «di progetto» e «di spedizione».
- Le riserve di flusso sono su intervalli: capacità della linea, energia disponibile, lavoro e trasporto. Non prenotare per sempre 100 operai perché sono stati usati ieri. R1 assegna le capacità operative di nuovo a ogni giorno in ordine stabile; un progetto bloccato prima del lavoro libera la quota giornaliera inutilizzata per gli altri, mentre le riserve di stock/fondi per la sua fase restano finché valide. Appuntamenti contrattuali futuri hanno slot separati: un ritardo richiede nuova disponibilità, non estensione automatica che invade altri contratti.
- Cancellazione libera la parte non consumata; costi già spesi restano. Recupero materiali solo tramite ricetta di recupero con rendimento e lavoro.
- Per stock deperibili applicare perdite datate, mai numero casuale scollegato dallo stato.
- Il ledger include chiavi uniche per `branchId, effectId, entryIndex`; la ripetizione è no-op verificata, non secondo pagamento.

### 6.3 Produzione e bilanci materiali

Ricetta versionata:

```text
input consumabili per unità output
energia per unità + eventuale carico fisso
lavoro qualificato per unità
capacità macchina e vincoli di qualità
output principali, sottoprodotti, scarti
capability prerequisites
```

Produzione nell'intervallo = minimo dei limiti di input, energia, lavoro, impianto e autorizzazione. I consumi sono proporzionali all'output effettivo secondo la ricetta. Non consumare il fabbisogno pieno se l'impianto produce al 30%, salvo carichi fissi espliciti.

Il motore non deve sommare tonnellate di materiali differenti sostenendo una generica conservazione di massa: usare ricette con rese e sottoprodotti espliciti. Niente cicli produttivi nello stesso istante che generano disponibilità infinita. Durate positive e output disponibili al confine temporale successivo.

Energia: separare potenza, energia generata nel periodo, rete, accumulo e combustibile. Un impianto senza combustibile o rete non eroga energia perché esiste come icona.

### 6.4 Importazioni e trasporti

Ciclo R1:

```text
proposta → accettataDaEntrambeLeParti → fondi/mercePrenotati
         → caricamento → inTransito → consegna → saldo/chiusura
                                       ↘ interruzione/perdita/ritardo
```

- Per vendere, il fornitore deve avere stock o produzione contrattualizzata autorizzata; non vendere all'infinito tramite NPC semplificato.
- La firma non consegna. Quantità in transito non è disponibile al cantiere; un embargo o un porto chiuso può bloccare la rotta.
- Il contratto definisce quando passa la proprietà e chi sopporta il rischio; MVP adottare una sola convenzione documentata (passaggio alla consegna, anticipo in escrow) e non inventarne una per evento.
- Capacità di trasporto per tratto e tempo; lead time positivo basato sulla rotta. Scorta in due luoghi contemporaneamente vietata.
- Blocchi simulati non rivelano al giocatore informazioni segrete non osservabili. Il motore usa lo stato reale; UI e advisor usano la proiezione informativa autorizzata.

---

## 7. Progetti, ricerca e capacità nazionali

### 7.1 Progetto come macchina a stati

```text
planned → authorized → active → commissioning → completed
                         ↕
                       blocked
planned/authorized/active/blocked → cancelled
active/commissioning → failed
```

Ogni fase ha ID, prerequisiti, minimo calendario, workload, fabbisogni/ricetta, costo di avvio e ricorrente, asset da abilitare solo alla conclusione pertinente. Fasi simultanee solo se il DAG lo consente e le risorse non si sovrappongono.

**Progressione R1:** passi giornalieri deterministici nell'intervallo `[giorno, giorno+1)`, con ordine stabile. Eventi nella data corrente hanno durata zero e non producono lavoro. Per ogni fase attiva:

1. Calcolare capacità allocata e input necessari per il lavoro realizzabile quel giorno.
2. Ridurre il lavoro al minimo dei vincoli; nessun lavoro gratuito se manca un input obbligatorio.
3. Pagare/consumare il necessario e incrementare `completedWork` con resti persistiti.
4. Verificare workload e minimo calendario; collaudo separato dove richiesto.
5. Alla conclusione creare/attivare l'asset **nello stato di lavoro**, utilizzabile dal confine temporale seguente. Solo il commit del prefisso autorizzato lo rende canonico/pubblico. Non far contribuire un asset appena completato all'economia dei giorni precedenti.

Priorità fissa per giorno, nessun beneficio dal numero di eventi narrati. Un salto di 30 giorni e 30 salti di un giorno, a parità di decisioni e input/casualità, hanno lo stesso stato materiale. Simulazioni speculative scartate non lasciano costi o progresso.

**Ordine interno R1 per il giorno D:** nello staging applicare i fatti al confine D secondo `(date, causalSequence)`; in caso di stessa data gli eventi già committati precedono i nuovi, e il scheduler assegna sequenze stabili prima dell'esecuzione. Arrivi, embargo, perdite e pagamenti non vengono riordinati per convenienza dopo aver visto il risultato. Poi rivalutare autorizzazioni/scadenze e allocare capacità/input del giorno; eseguire lavoro/produzione su `[D,D+1)`; registrare output e completamenti al confine D+1 con la loro sequenza. Un arrivo a D può essere usato quel giorno se precede l'allocazione; un output a D+1 non viene consumato il giorno D. Il catalogo specifica l'ordine delle scadenze obbligatorie in conflitto; assenza di regola = errore di modello, non scelta della LLM.

Transizione causale interna ≠ checkpoint pubblico. Un impianto completato al giorno 10 può produrre nei giorni 11–30 dello stesso staging senza commit quotidiani. Se la ricerca `next_event` viene scartata, spariscono anche impianto, produzione e riserve di quello staging.

### 7.2 Tempi stimati

Mostrare:
- progresso fisico: lavoro completato/totale, non token LLM;
- stato: attivo, bloccato, in collaudo;
- prima data **tecnicamente possibile** con le risorse attuali;
- previsione condizionata, quando disponibile, e ipotesi;
- ultimo aggiornamento e causa del ritardo.

Non promettere una data certa basandosi soltanto su `expectedDate` della LLM. Se c'è un blocco senza soluzione contrattualizzata, data prevista «non determinabile».

### 7.3 Conoscenze e tecnologie

Grafo aciclico con dipendenze di conoscenze/capacità, non semplice sblocco per anno:

```text
principio scientifico → metodo riproducibile → progetto verificato
→ prototipo → processo industriale → certificazione/impiego → manutenzione
```

- Date storiche sono baseline e indicazioni di plausibilità, non ordini irrevocabili del calendario in una ucronia.
- Acquisizione tramite ricerca, licenza, formazione o trasferimento: requisiti e diritti diversi.
- Ricerca richiede personale, strumenti, fondi, tempo e accesso al problema. Niente «università presente → tutte le tecnologie note».
- R1 usare milestone di ricerca approvate nel catalogo. Incertezza può produrre successo, ritardo o fallimento mediante RNG con seed/stato persistiti, non percentuale inventata dalla LLM.
- La probabilità non aggira prerequisiti fisici: prima soddisfare il gate, poi estrarre l'esito. Per un requisito non soddisfatto la probabilità di produzione è zero, non il 5% minimo di una formula generica.
- Per R3 ammettere innovazioni fuori catalogo solo tramite estensione versionata revisionata; il testo del giocatore non installa nuove regole nell'esecuzione.

### 7.4 Personale, manutenzione e servizi

- Personale civile, militare e in formazione derivano dalla popolazione idonea; nessuna stessa persona assegnata a due lavori simultanei. Modellare bacini aggregati, non individui.
- Un battaglione operativo richiede reclute, addestramento, equipaggiamento, comando, logistica e manutenzione. L'icona deve riflettere il registro delle unità, non generarlo.
- Una struttura esistente può essere degradata, senza energia o personale: capacità nominale distinta da capacità effettiva.
- Sanità/istruzione/amministrazione usano budget, addetti e capacità; risultati graduati con ritardi. In R1 non costruire un simulatore sociale completo: esporre poche variabili calibrate e dichiararne la natura modellistica.
- Governance: separare proposta, approvazione, regolamento e attuazione. Il giocatore governa secondo le istituzioni dello scenario, non possiede automaticamente aziende private o province estere.

### 7.5 Deleghe che riducono il lavoro ripetitivo

Mandato esemplificativo: «Mantieni 30 giorni di riserva del bene X, acquista entro il prezzo limite Y, spendi al massimo Z per mese, soltanto da fornitori A/B e senza nuovo debito».

- Il mandato si valuta solo ai tick di gioco autorizzati.
- Il motore deterministico propone/esegue esclusivamente azioni nella whitelist del mandato e nei limiti residui; registra la causa `mandateId`.
- Cambiamento sostanziale, nuova tecnologia, debito o superamento tetto → fermarsi e chiedere una decisione. L'LLM non allarga il mandato da sola.
- UI: «Gestione guidata» predefinita; riepilogo delle decisioni delegate, mai decine di notifiche contabili ordinarie.

---

## 8. Tempo, NPC, LLM ed effetti

### 8.1 Ordine causale del motore

Per ogni intervallo che termina in un checkpoint:

```text
stato canonico + ordini/mandati autorizzati
→ normalizzazione con ID e chiarimenti
→ fattibilità batch su stato di lavoro
→ avanzamento deterministico fino al prossimo confine causale
→ proposta narrativa/NPC compatibile con quel confine
→ validazione effetti e informazione pubblicabile
→ commit atomico del prefisso autorizzato
→ pubblicazione e descrizione del fatto
```

Il calendario deterministico di consegne, scadenze, fine fasi e crisi già note è il limite superiore entro cui la LLM può proporre il prossimo evento. Non saltare una scadenza certa al giorno 4 perché la LLM preferisce un discorso al giorno 10.

Se una proposta LLM datata prima del confine cambia le condizioni, ricalcolare da uno stato di lavoro precedente, senza applicare effetti due volte. Non simulare prima tutta l'economia fino a fine mese e poi retrodatare un embargo.

### 8.2 Stop, assenza di eventi e playback

**Distinzione fra presa in carico tecnica e consegna canonica:** accettare un job può bloccare tecnicamente l'editing degli ordini, ma non costituisce emissione materiale. Conservare il loro stato canonico all'origine. Durante il calcolo `issued`, riserve e avanzamenti esistono nello staging; diventano durevoli soltanto insieme al primo prefisso autorizzato. Questo vale anche se nello staging l'avvio è alla data iniziale.

| Esito comando | Ordini / riserve canoniche | Tempo, turno, revisione |
|---|---|---|
| Accettazione 202 / running | Coda originaria, claim tecnico separato; nessuna riserva materiale nuova | Invariati |
| Ricerca completata validamente senza evento | Claim rilasciato, coda e stato originari, staging scartato | Invariati; `no_event_found` |
| Protocollo incompleto / budget prima di un prefisso valido | Coda/stato originari; job pausato, nessun impegno canonico nascosto | Origine; `paused_budget` o errore protocollo secondo causa |
| Primo checkpoint di un evento autorizzato | Emissione, riserve/consumi/progetti del solo prefisso committati insieme | Data checkpoint, turno del run incrementato una volta, revisione +1 |
| Continua autorizzato | Stato del prefisso successivo; nessuna riemissione ordini | Turno invariato, revisione +1 |
| Salto a data valida senza eventi | Emissione, valutazioni e contabilità del periodo in un solo commit | Destinazione, un turno e una revisione nuovi |
| Errore/budget dopo checkpoint | Ultimo prefisso durevole, niente futuro | Data/turno dell'ultimo checkpoint; stato tecnico esplicito |

`no_event_found` richiede una ricerca semanticamente conclusa, anche se entro un orizzonte finito dichiarato. Non usare quel risultato per uno stream troncato dal limite token. La registrazione tecnica del job non è una mutazione del mondo e non incrementa la revisione del mondo.

- `next_event`: considerare tutto il lotto, trovare il primo evento importante validato; commit solo fino a quello. La contabilità ordinaria non è una notizia importante.
- Se una ricerca valida si conclude senza svolte nell'orizzonte dichiarato, nessun avanzamento implicito: scartare stato di lavoro/prenotazioni speculative e restituire `no_event_found`. Se invece termina il budget prima di una risposta valida, usare la pausa/errore prevista dalla tabella, non fingere di aver concluso la ricerca.
- Un ordine materialmente bloccato deve essere spiegato già nel preflight. Il rifiuto tecnico non diventa una crisi fittizia per «trovare» un evento.
- `until_date`: zero eventi può terminare alla data con sola contabilità; con eventi prima della data, **anche uno solo**, fermare il playback sul checkpoint, attendere conferma per arrivare oltre.
- Output incompleto/budget: nessuna destinazione presunta; `paused_budget` a ultimo checkpoint valido, o origine se non esiste un evento/commit autorizzato.
- «Continua» applica esattamente il checkpoint successivo autorizzato; chiudere un pannello non continua.
- Le proposte future precaricate sono dati privati del job, invalidati se cambia il contesto. L'API pubblica può esporre stato e numero di checkpoint non letti se previsto, non descrizioni/titoli/effetti/esiti futuri. Preferibile «altri dispacci da esaminare» a un numero se il numero stesso anticipa troppo il contenuto.

### 8.3 Ruolo della LLM

**Può:** interpretare, chiedere chiarimenti, proporre strategie/NPC, scrivere dispacci, riassumere fatti canonici e spiegare blocker.

**Non può:** autorizzare il proprio output, calcolare saldi autorevoli, mutare direttamente DB/mappa, definire ricette al volo, attribuire successi senza riferimenti, riscrivere cataloghi, spendere fuori mandato, vedere tramite prompt proposte future di un ramo scartato.

Contratto generativo versionato con `actionId`, `projectId`, `causeRefs`, `proposedEffect` discriminato. Il server ricava importi, rese e tempi dai cataloghi e dalla valutazione, non da campi suggeriti dal modello.

`complete` è riepilogo tecnico, non seconda sorgente di effetti. Un output malformato fallisce chiuso: errore tecnico e stato conservato. È ammesso un tentativo limitato di riparazione **sintattica** senza alterare significato; se non basta, pausa esplicita. Non rigenerare senza limite o spendere altri crediti automaticamente.

**Narrazione sicura:** i campi strutturati autorevoli dell'evento riportano esito e numeri. La prosa non è mai riletta per produrre effetti. Quando la prosa contraddice i dati validati, usare un riepilogo deterministico del fatto e segnalare l'errore di qualità; un secondo LLM giudice può assistere, non sostituisce la validazione. L'assenza di ogni contraddizione semantica in testo libero non è dimostrabile con un parser: prevedere eval e revisione campionaria.

### 8.4 Autonomia mondiale sostenibile

- Tutte le nazioni hanno conti/processi/scadenze nel motore, non solo il giocatore.
- Aggiornamenti contabili deterministici per tutte; decisioni narrative più dettagliate per attori coinvolti, vicini, partner e crisi, con rotazione documentata degli altri.
- Non effettuare una chiamata LLM per ogni nazione ogni giorno. Raggruppare decisioni in contesto limitato, recuperando dati rilevanti per ID.
- Un NPC aggregato non ha stock infiniti. Se partecipa a un contratto, il suo stock/capacità devono essere contabilizzati; non materializzare risorse nel passaggio da aggregato a dettagliato.
- Le scadenze deterministiche non dipendono dall'essere selezionati per una chiamata narrativa.

---

## 9. Architettura, persistenza e API

### 9.1 Separazione dei moduli

Percorsi nuovi proposti, da creare soltanto nel pacchetto assegnato:

```text
backend-nest/src/domain/{contracts,quantities,schemas}.ts
backend-nest/src/core/feasibility/FeasibilityService.ts
backend-nest/src/core/economy/{LedgerService,ReservationService,EconomyEngine}.ts
backend-nest/src/core/projects/{ProjectEngine,TechnologyEngine}.ts
backend-nest/src/core/logistics/LogisticsEngine.ts
backend-nest/src/core/simulation/{TurnOrchestrator,EffectValidator,CheckpointService}.ts
backend-nest/src/jobs/SimulationJobService.ts
backend-nest/src/repositories/{ledger,project,scenario}.repository.ts
```

`GameSession` diventa progressivamente facciata; NON riscriverla tutta in una consegna. Nessun secondo motore che continui a mutare `region.gdp` o a creare icone sotto il nuovo dominio.

`WorldStateEngine.accounts` diventa proiezione contabile del nuovo stato dove abilitato, conservando un adapter esplicito per legacy. Il vecchio `SimulationEngine` non è il motore nuovo da attivare alla cieca. Le route legacy delegano all'orchestratore o rispondono deprecazione esplicita.

Contratti condivisi: schema JSON/runtime unico con generazione dei tipi client in CI, oppure piccolo workspace di contratti puro. Non copiare manualmente tre interfacce divergenti in `models.ts`, `prompts/types.ts` e frontend.

### 9.2 Revisioni, rami e comandi

- `game.revision` è contatore monotono di mutazioni canoniche del mondo, non formula da numero turno. Ogni checkpoint incrementa una volta, anche a data identica.
- `branchId` identifica la linea corrente. Restore crea un nuovo ramo con `parentCheckpointId`; la revisione del gioco non torna indietro, anche se la data storica sì.
- Per modifiche alla coda usare anche `queueVersion`: modifica/registrazione non avanza il mondo ma invalida la preview del lotto. Ogni run ha inoltre `jobVersion` monotona per stati tecnici/claim/progresso significativo, anche senza nuovi checkpoint. Non usare una revisione del mondo invariata per ordinare queste risposte.
- Ogni callback porta `{gameId, branchId, runId, capturedRevision}` e un generation/fencing token. Prima del commit verificare che il ramo sia ancora quello e l'operazione autorizzata.
- Idempotenza: chiave univoca per gioco/ramo/tipo comando; memorizzare hash del payload canonico e risultato. Stessa chiave/payload → stesso risultato; chiave uguale/payload diverso → `409 idempotency_conflict`.
- Next e Intervene richiedono checkpoint/revisione; non soltanto il run. Il replay di Next restituisce il checkpoint prodotto dal primo comando, non ne genera un altro.

### 9.3 Transazione e outbox

Una transazione checkpoint comprende:

1. verifica CAS revision/branch/fencing;
2. ledger monetario/fisico, riserve e capacità;
3. progetti, tecnologie, contratti, unità e proiezioni mappa;
4. stato ordini e outcome per ID;
5. data/turno/revisione, eventi canonici e checkpoint;
6. stato run/playback e RNG;
7. outbox con ID stabili.

Fuori transazione: LLM, calcoli lunghi, file/network e pubblicazione SSE. Calcolare su snapshot/staging isolato, applicare a RAM solo dopo commit. Se pubblicazione fallisce, l'outbox viene ripresa; il client deduplica. Nessuna LLM mentre SQLite mantiene un write lock.

### 9.4 Tabelle e vincoli proposti

Estendere le tabelle esistenti invece di duplicare run/eventi/processi. Migrazioni additive e versionate:

| Tabelle | Vincoli minimi |
|---|---|
| `game_branches`, `games` estesa | head branch/checkpoint, revision monotona, parent checkpoint valido |
| `pending_actions` estesa | ID, scope, queueSequence, delivery/execution, normalized intent/version |
| `simulation_runs` estesa | request hash, branch, lease/fencing, captured revision, stato, error code |
| `simulation_events` estesa | sequence, checkpoint, cause/effect IDs; unici per ramo/sequenza |
| `simulation_checkpoints` estesa | schema/catalog hash, snapshot completo; immutabilità |
| `ongoing_processes` evoluta | project ID, fase/stato, origine action ID; non titolo come chiave |
| `ledger_entries`, `reservations` | scope, idempotency unique, quantità codec valido, riferimenti coerenti |
| `inventories`, `facilities`, `workforce_allocations` | owner/location, quantità, stato/capacità; FK nello stesso scope |
| `polity_knowledge`, `project_phases` | ID catalogo valido, progressi, fasi dipendenti |
| `contracts`, `shipments`, `mandates` | parti/limiti/date/stati/riserve; niente esecuzione da testo chat |
| `simulation_outbox` | sequence, event ID, payload pubblico, retry/delivery state |

Per le quantità testuali, i vincoli aritmetici complessi vivono nel dominio e nei test di riconciliazione; non fingere che SQLite faccia contabilità bigint con il suo `REAL`. Scegliere una strategia snapshot semplice per R1 (copie complete compresse/versionate se serve); evitare event sourcing integrale nuovo senza necessità.

### 9.4.1 Manifest del salvataggio e rebinding su restore

Snapshot semanticamente completo non significa rieseguire ogni stato operativo salvato. Definire schema runtime con tre sezioni:
1. **Stato semantico:** mondo, ordini, autorizzazioni, ledger/riserve, contratti, progetti, allocazioni/scadenze, carry razionali, memoria e RNG.
2. **Playback privato:** posizione esatta, sole proposte sigillate necessarie, catalog/schema hash, base semantica e origine causale; escluso da tutti i DTO pubblici.
3. **Metadati descrittivi:** ID/versioni di origine; non sono istruzioni per riattivare servizi.

Prima di mutare validare schema, checksum/hash cataloghi, riferimenti e compatibilità. Catalogo assente o snapshot invalido → restore rifiutato, stato corrente intatto. Su nuovo ramo preservare gli ID logici delle entità ove scoped, ribindare tutti i riferimenti di scope e creare nuovo run/anchor di playback collegato all'origine. Validare di nuovo le proposte sigillate contro la base semantica restaurata; se non compatibili, conservarle come audit privato non eseguibile e restituire `paused_recovery` senza rigenerazione LLM automatica.

**Non ripristinare:** lease, vecchi fencing token, richieste di rete, connessioni SSE, flag di delivery outbox o lavori in volo. Generare un solo messaggio pubblico di branch replacement con nuovo anchor; non ripubblicare tutti gli eventi storici. I risultati idempotenti del ramo vecchio restano consultabili solo nel loro scope e non autorizzano comandi sul nuovo. Il nuovo comando restore è esso stesso idempotente nel ramo di origine. Testare crash dopo commit del restore ma prima della risposta.

### 9.5 Job durevoli

```text
queued → running → awaiting_next | completed | no_event_found
                 ↘ paused_budget | paused_recovery | failed
awaiting_next → awaiting_next | completed | intervened
paused_budget/paused_recovery → ripresa esplicitamente autorizzata o chiusura
```

- POST crea job e restituisce `202` prima di attendere il provider.
- R1 un solo processo worker con claim durevole/lease e lock per partita è sufficiente; non introdurre Redis/Kubernetes senza necessità.
- Dopo crash, lease scaduta → ricostruzione dall'ultimo checkpoint e `paused_recovery`. Non riemettere ordini e non richiamare automaticamente un provider a pagamento se la precedente fatturazione/esecuzione è incerta.
- Browser disconnesso non annulla né conferma implicitamente il checkpoint. Polling/SSE recuperano il job.

### 9.6 API canonica v2 proposta

```text
GET  /api/games/:id/state
POST /api/games/:id/actions/interpret             LLM opzionale, bozza; nessun ordine automatico
POST /api/games/:id/actions/evaluate              preflight batch; nessuna mutazione materiale
POST /api/games/:id/actions/queue                 registrazione, queueVersion
PATCH/DELETE /api/games/:id/actions/queue/:actionId
GET  /api/games/:id/nation                        sintesi/qualità dati
GET  /api/games/:id/projects                      paginata e filtrabile
GET  /api/games/:id/resources                     stock, flussi, riserve e accesso
GET  /api/games/:id/ledger                        paginato, filtri data/progetto/causa
POST /api/games/:id/simulations                   202, prossimo evento oppure targetDate
GET  /api/games/:id/simulations/:runId             DTO pubblico, mai pending_state
POST /api/games/:id/simulations/:runId/next        ancora + idempotenza
POST /api/games/:id/simulations/:runId/intervene   ancora obbligatoria
POST /api/games/:id/checkpoints/:checkpointId/restore
GET  /api/games/:id/events                        SSE pubblico con id/revision/branch
GET  /api/games/:id/timeline?cursor=...            sequenza canonica, non solo turno
```

Request salto:

```json
{
  "mode":"until_date",
  "targetDate":"1951-02-01",
  "actionIds":["a1","a2"],
  "expectedRevision":42,
  "expectedQueueVersion":7,
  "branchId":"b1",
  "requestId":"client-unique-1"
}
```

Per auto usare `mode:"next_event"` senza targetDate. Non mantenere due nomi quasi equivalenti nel nuovo contratto; adapter esplicito per `jump_days:0` legacy. `actionIds:[]` significa zero nuovi ordini, non «tutti» per fallback. Errori di schema 400, dominio di richiesta non ammissibile 422, autorizzazione 403, revisione/lock 409; l'esito di un ordine bloccato è un risultato di valutazione, non crash server.

GET state restituisce snapshot canonico coerente con `anchor` e `queueVersion`; il client non deve unire casualmente mappa da revisione 44, coda da 42 e data da 43.

### 9.7 Frontend autorevole per proiezione, non per simulazione

Uno `simulationStore` con reducer unico per HTTP/SSE/polling. Regole:

- messaggio diverso game/branch → ignorare; eccezione solo per risposta validata al comando esplicito di cambio partita/restore corrente, che sostituisce l'anchor e invalida tutte le richieste precedenti;
- revisione inferiore → ignorare per lo stato corrente, salvo archivio esplicitamente richiesto;
- buco di revisioni → refetch snapshot; nessuna applicazione di delta su una base ignota;
- evento duplicato → upsert no-op;
- aggiornamento coda: confrontare `queueVersion` nel proprio scope; job: confrontare `jobVersion` del run. Stessa world revision non autorizza una risposta a sovrascrivere versioni coda/job più recenti; un gap incoerente impone refetch dello snapshot/risorsa pertinente;
- restore/load → sostituzione completa con invalidazione richieste, non merge;
- connessione incerta ≠ run terminato; conservare controlli e fare polling.

Archivio paginato separato dal checkpoint attivo. News feed contiene soltanto eventi canonici e mai contabilità ordinaria etichettata come svolta. Cronologia advisor/chat è scoped e resa coerente con il ramo; risposte tardive scartate o archiviate fuori dal ramo corrente, non reiniettate.

---

## 10. Desktop, mobile e identità grafica

### 10.1 Direzione scelta e alternative scartate

Tema: **sala di governo e atlante delle capacità**. Pubblico: giocatori di strategia che vogliono libertà narrativa e conseguenze comprensibili. Compito principale: prendere una decisione sapendo cosa la rende possibile.

Alternative considerate:
- giornale ovunque: caratteristico ma poco adatto a form, chat e contabilità; mantenere il carattere editoriale solo nei dispacci;
- dashboard finanziaria con decine di KPI: leggibile ma generica e intimidatoria; scartata come struttura principale;
- mappa e catena della fattibilità: scelta, perché unisce territorio e vincoli invece di aggiungere solo numeri.

Il rischio estetico deliberato è una **catena causale interattiva**, non una palette vistosa o animazioni inutili. Il resto dell'interfaccia è tranquillo e prevedibile.

### 10.2 Token di partenza

| Token | Valore proposto | Uso |
|---|---|---|
| `--surface-map-shell` | `#101B2D` | Cornice e fondo operativo |
| `--surface-panel` | `#1B2B43` | Schede e compositori |
| `--text-primary` | `#F2F6FC` | Testo primario |
| `--text-secondary` | `#B8C7DA` | Spiegazioni e unità |
| `--accent-action` | `#B5A6F2` | Azione primaria, testo scuro sul riempimento |
| `--accent-attention` | `#E9B85A` | Vincoli e decisioni richieste |

Stati positivi/negativi richiedono token semantici dedicati con contrasto misurato, icona e testo; non soltanto rosso/verde. I colori delle nazioni appartengono ai dati della mappa, non definiscono il contrasto delle chat.

Tipografia proposta, font locali/licenze verificate:
- **Source Sans 3** per controlli/testo, fallback system UI;
- **IBM Plex Mono** per quantità/date brevi, cifre tabulari;
- **Literata** per titoli e prosa dei dispacci, con moderazione.

Scala UI: 12 px solo metadati secondari, 14 px etichette, 16 px corpo/compositori, 20/24 px titoli; line-height corpo 1,45–1,6. Numeri lunghi formattati (`1,2 milioni`, tooltip/dettaglio con valore completo), mai `0.000073484...` senza unità. Evitare tutto maiuscolo per frasi lunghe.

Spaziatura 4/8/12/16/24/32; raggi 8 px controlli, 12 px schede; ombra solo per livelli sovrapposti. Animazioni di stato 120–180 ms, ridotte/disattivate con `prefers-reduced-motion`.

### 10.3 Architettura dei moduli

Conservare i cinque accessi noti: **Ordini, Diplomazia, Consulente, Notizie, Nazione**. Il micromanagement vive in Nazione e nei dettagli ordine/progetto, non in altre dieci icone.

Nazione contiene sezioni progressive:
1. **Situazione:** 3–5 decisioni che richiedono attenzione, cassa e autonomia delle risorse essenziali.
2. **Progetti:** attivi/bloccati/previsti, dipendenze e prossima milestone.
3. **Bilancio:** liquidità, impegni, entrate/uscite reali e previste separate, debito.
4. **Risorse e produzione:** stock/accesso, filiere, consumi, trasporti.
5. **Conoscenze e personale:** capacità disponibili, mancanti, ricerca/formazione.
6. **Politiche e servizi:** mandati/delega, servizi essenziali e istituzioni.

Non mostrare tutti i dati subito. Ogni sintesi ha «Da cosa dipende?» e un dettaglio con fonte, data e formula/model version. Tendenze solo da checkpoint esistenti; previsioni tratteggiate e condizionate, non serie future canoniche.

### 10.4 Desktop: ≥1024 px

```text
┌ Scenario / Nazione ─ Tempo fermo: data ─ [Avanza] ─ Menu ┐
│ Modulo attivo (380–460px) │ Mappa e legenda              │
│ Sintesi / lista          │ Filtri: risorse / logistica  │
│ Dettaglio con breadcrumb │ Selezione senza muovere     │
│                         │ la camera obbligatoriamente │
│ Footer azioni stabile    │                             │
├ Ordini · Diplomazia · Consulente · Notizie · Nazione ────┤
└─────────────────────────────────────────────────────────┘
```

- Un solo modulo principale attivo; pannello e mappa in griglia, non finestre sovrapposte arbitrariamente. Primo ingresso: mappa libera, Nazione chiusa.
- ≥1440 px eventuale confronto di due alternative all'interno del pannello espanso; non due moduli mutanti indipendenti.
- Dettagli con breadcrumb, ritorno alla posizione scroll precedente; nessun reset durante polling.
- Desktop con altezza ridotta: contenuto scrollabile, header/footer non spariscono. Ridimensionamento solo se realmente supportato dal layout, con alternativa tastiera e limiti che non tagliano i controlli.
- Lettore checkpoint in cima alla gerarchia modale, con Save/Intervieni/Continua e mappa non falsamente interattiva sotto un dialog modale.

### 10.5 Mobile: 320–767 px; tablet 768–1023 px

```text
┌ Nazione · data ferma         [Avanza] ┐
│ Titolo modulo                   [×] │
│ Situazione / breadcrumb             │
│                                     │
│ Contenuto a una colonna, scroll      │
│ Catena fattibilità come lista       │
│ verticale espandibile               │
│                                     │
├ Motivazione breve / costo           ┤
│ [Registra ordine]                   │
└────────────────── safe area ────────┘
```

- Un foglio alla volta, layout `grid-template-rows: auto minmax(0,1fr) auto`; `100dvh` con fallback e safe-area. Non footer fixed indipendente dal foglio che copre il contenuto.
- Nel foglio il dock globale può essere nascosto/inert: pulsante Chiudi torna a mappa/dock. Non comprimere cinque etichette a 8 px per tenerle sempre in vista.
- Confronti a schede alternate, stessa metrica nello stesso ordine; nessuna tabella orizzontale obbligatoria per capire fattibilità.
- Compositore e pulsante visibili con tastiera; usare viewport dinamico/VisualViewport dove necessario, test reale iOS e Android. Bozza preservata a rotazione/interruzione.
- Landscape basso: header compatto, area contenuto scorrevole, footer senza testi eccessivi; nessun comando nascosto fuori schermo.
- Tablet: mappa + un pannello se lo spazio effettivo lo consente; altrimenti comportamento foglio. I breakpoint dipendono dallo spazio, non dallo user-agent.

### 10.6 Ordini e chat

**Ordini:** compositore → interpretazione/clarifiche → scheda fattibilità → coda; riepilogo conflitti del lotto. Il footer non mette una frase lunga in una colonna di 60 px accanto a un pulsante largo. Etichette univoche: «Registra ordine», «Modifica», «Rimuovi dalla coda», «Avanza»; evitare «Invia» se sembra esecuzione immediata.

**Chat:** intestazione con interlocutori, messaggi con data di gioco, compositore; separare messaggio diplomatico da scheda accordo. «Discuti condizioni» non trasferisce risorse; «Registra proposta di accordo» crea un oggetto negoziale confermabile, effetti materiali al salto autorizzato. Stato accordo sempre testuale (proposto/accettato/rifiutato/in esecuzione), non inferito da emoji/parole.

### 10.7 Accessibilità e CSS

- WCAG 2.2 AA come obiettivo, verificato, non dichiarato solo dal tema: testo normale ≥4,5:1, testo grande ≥3:1, componenti/focus ≥3:1 dove applicabile. Target di prodotto ≥44×44 CSS px, preferiti 48 px su touch.
- Componenti nativi per bottoni, checkbox, input; niente div cliccabile senza semantica.
- Dialog condiviso: nome accessibile, focus iniziale sensato, trap solo se modale, background inert, Escape di chiusura senza simulazione, ritorno focus al controllo origine. Chiusura del lettore non equivale a Intervieni o Continua.
- Stato tecnico in `aria-live=polite` sintetico; non leggere ogni token o ogni riga del ledger. Errori associati agli input. Nessuna azione disponibile solo su hover/drag/colore.
- Zoom 200%, reflow 320 px e test 400% della shell con alternativa testuale alla mappa; la mappa può avere interazione bidimensionale, i form no.
- Nuovi componenti con CSS Modules o scope esplicito; token tema sul root dei portal. Un solo registro z-index: map 0, shell 10, module 20, overlay 30, dialog 40, toast 50. Il numero è convenzione proposta da verificare con il motore mappa.
- Separare vendor CSS, base, token, layout, componenti. Migrare un componente alla volta eliminando regole sostituite. Non modificare selettori globali `body:has(...)` per governare stato applicativo.

### 10.8 Onboarding e informazione

Tutorial breve in fixture offline: un ordine fattibile, uno bloccato, una consegna in arrivo e un salto senza ordini. Mostrare esplicitamente «la data non cambia finché non avanzi». Non avviare chiamate a pagamento al caricamento del tutorial.

Tre colonne concettuali in ogni sintesi, anche se verticali su telefono: **Disponibile ora / Già impegnato / Previsto**. Trasformano il micromanagement in decisione comprensibile anziché lista di statistiche.

---

## 11. Compatibilità, sicurezza e prestazioni

### 11.1 Salvataggi legacy

- Nuovo `saveSchemaVersion`, `simulationModelVersion` e hash scenario/catalogo.
- Campi assenti non diventano zero verificato o risorsa infinita. Non convertire PIL legacy in cassa con un coefficiente inventato.
- R1: partite nuove del preset validato usano realismo rigoroso. Partite vecchie restano caricabili in modalità legacy esplicitamente segnalata, senza claim di stessi vincoli.
- Conversione di una vecchia partita: solo su copia/nuovo ramo e conferma; rapporto di copertura dati, quantità note/stimate/sconosciute. Se mancano dati bloccanti, non attivare esecuzione rigorosa.
- Vecchi progetti narrativi restano leggibili; non far comparire automaticamente risorse/impianti per adattarli.
- Tutti i checkpoint nuovi includono posizione playback privata, ledger/riserve, progetti, contratti, dati RNG e autorizzazioni. Il DTO pubblico del save non rivela proposte future.
- Rollback di codice con dati nuovi: compatibilità verificata o snapshot di backup isolato; mai cancellare progressi degli utenti per automatizzare il rollback.

### 11.2 Sicurezza

Autorizzazione game/save/LLM settings, limiti di frequenza e budget, protezione credenziali, isolamento utenti. CORS ristretto non sostituisce auth. Token del provider mai nei log, negli snapshot o nel client oltre le modalità esplicitamente previste. Import preset con limiti file/zip/path e JSON depth/size; testo della lore trattato come dato non fidato, non permesso di bypassare gli invarianti.

### 11.3 Prestazioni e osservabilità

Obiettivi iniziali da misurare, non risultati attuali:
- POST job p95 <500 ms sul server di test senza tempo provider;
- preflight deterministico di 20 ordini p95 <250 ms nel profilo di riferimento;
- apertura modulo dopo caricamento dati p95 <150 ms su desktop e <300 ms su telefono di riferimento;
- nessun blocco ripetuto del main thread >100 ms per aprire una scheda;
- separare bundle mappa, preset editor e moduli non necessari all'ingresso con dynamic import; budget per chunk first-party iniziale indicativo ≤300 kB gzip, documentando separatamente il motore mappa;
- virtualizzare liste lunghe di progetti/ledger; query per scope con indici; niente full snapshot ripetuto nel polling se revisione invariata.

Profilo obbligatorio in Q01: annotare hardware/browser, 200 politie, 5.000 regioni, 1.000 progetti, 20 ordini, orizzonte 365 giorni; un secondo profilo più piccolo per mobile UI. Se gli obiettivi non sono raggiunti, consegnare misure e ottimizzazione, non ridurre silenziosamente il numero di NPC.

Tick giornaliero R1 semplice e verificabile; ottimizzazioni event-driven soltanto se equivalenti nei test di segmentazione. Lavori CPU lunghi fuori dal request handler/event loop principale, mantenendo il singolo writer DB.

Metriche senza dati sensibili: job latency, provider latency/costo, errori schema, blocchi per reason code, commit duration, replay idempotenti, outbox lag, gap revisioni, errori di riconciliazione, abort/restore scartati correttamente.

---

## 12. Criteri di completamento

Il gioco non è «finito» perché costruisce un impianto una volta. Per dichiarare R1 completato:

- [ ] Difetti di integrità F00–F06 risolti con regressioni positive e negative.
- [ ] Nessun percorso LLM/legacy crea un asset senza autorizzazione materiale nel nuovo modello.
- [ ] Due ordini concorrenti, fondi insufficienti, carenza materiali, tecnologia mancante e tempi incompatibili producono risultati spiegati, senza effetti vietati.
- [ ] Progetti continuano con zero nuovi ordini e si arrestano su carenze reali.
- [ ] Importazione e uso di tecnologia estera non sono confusi con capacità di produzione nazionale.
- [ ] Save E1 → E2 → Load E1 e riavvio ripristinano esattamente risorse, ramo e playback; retry Next non salta E2.
- [ ] Tutte le nazioni interessate rispettano le stesse conservazioni.
- [ ] UI guidata e dettagliata usano lo stesso assessment, stessi prezzi e stesse unità.
- [ ] Desktop/mobile, tastiera, zoom, connessione persa e tastiera virtuale verificati.
- [ ] Fonti/stime e funzioni fuori modello chiaramente dichiarate.
- [ ] Deploy coordinato e smoke funzionali autorizzati; nessuna certificazione Pax eccedente le prove.

La lista operativa con dipendenze, test numerici e istruzioni di consegna è nel [piano esecutivo](PIANO_ESECUTIVO_LLM_REALISMO_UX.md). Non avviare tutti i pacchetti insieme.

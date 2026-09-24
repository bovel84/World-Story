# World Story — piano di chiarezza: un dossier che si capisce

**Versione:** proposta normativa 1.0, 24 settembre 2026.
**Stato:** piano da implementare, NON funzionalità già disponibili.
**Destinatari:** sviluppatori e LLM esecutori; ogni scelta marcata «obbligatoria» è un contratto.
**Obiettivo concordato:** **sintesi vera + dettaglio a richiesta.**

> **Il problema in una riga.** Il dossier nazionale mostra 93 etichette-metrica in 21
> componenti, distribuite su 8 schede e affiancate da 6 superfici concorrenti; la
> stessa cifra compare in più punti (Stabilità e Tensione sociale in **tre** sezioni),
> e lo store che governa le sezioni **dichiara un invariante che l'implementazione
> viola**. Non manca informazione: ne avanza, senza gerarchia e senza una prima
> risposta alla domanda «quindi, sto bene o male?».

---

## Indice

1. Diagnosi: cosa c'è davvero oggi
2. L'invariante che il codice dichiara e non rispetta
3. Perché il sovraccarico è un problema di prodotto, non di stile
4. La promessa: una schermata che risponde a tre domande
5. Invarianti obbligatorie
6. Le fasi (D01–D07)
7. Criteri di completamento e verifica
8. Cosa NON fare

---

## 1. Diagnosi: cosa c'è davvero oggi

Numeri misurati sul codice (`frontend/src/`, 2026-09-24).

### 1.1 Il dossier in cifre

| Grandezza | Valore |
|---|---|
| Schede del dossier (`NATION_SECTIONS`) | **8** |
| Card dichiarate nelle schede | **34** |
| Metriche (etichette) nelle schede | **56** |
| Etichette-metrica in tutti i componenti di gioco | **93** |
| Righe di `NationDock.tsx` | **1.004** |
| Superfici concorrenti che mostrano lo stato nazionale | **6** |

Le sei superfici: `NationDock` (il dossier), `OperatingPictureBoard` (quadro
d'insieme a sei aree), `ObjectsBoard` (sala di governo), `TimeDesk` (tempo),
`CompactBriefing` (briefing compatto in partita), `StrategicBriefingCard`. Più
`EventFeed` (cronaca) e `MaterialBalanceList` (bilancio materiale), che aggiungono
altre due letture dello stesso stato materiale.

### 1.2 Metriche ripetute fra sezioni

| Metrica | In quante sezioni |
|---|---|
| Stabilità | **3** (situazione, risorse, politiche) |
| Tensione sociale | **3** (situazione, risorse, politiche) |
| Tesoreria | 2 (situazione, bilancio) |
| Saldo mensile | 2 (situazione, bilancio) |
| Sforzo bellico | 2 (bilancio, risorse) |
| Spesa militare | 2 (bilancio, dentro la stessa scheda) |
| Scorte armi | 2 (risorse, armamenti) |
| Realizzazione | 2 (progetti, nella stessa scheda) |

Otto metriche duplicate, due delle quali in tre punti diversi. Il giocatore che
cerca «quanto sono stabile?» la trova in tre posti e non sa quale sia quello
giusto — perché non c'è un «giusto».

### 1.3 Le card che spiegano invece di mostrare

Nella scheda Armamenti ci sono card intitolate *«Come si legge l'arsenale»* e
*«Sala di governo»*: istruzioni su come interpretare i numeri, dentro la
schermata che dovrebbe dare i numeri. È il sintomo di un difetto di gerarchia:
quando la conclusione non è visibile, si aggiunge una legenda.

---

## 2. L'invariante che il codice dichiara e non rispetta

Questo non è un'opinione estetica: è una contraddizione nel codice.

`stores/nationDock.ts` dichiara, come contratto:

```
 * Ogni cifra compare in una sola sezione: le infrastrutture stanno in Risorse,
 * il denaro in Cassa, il combattente in Armamenti.
 *
 * Invarianti (UI01/UI04):
 *  - all'apertura del dossier la sezione attiva è «Situazione» (decisioni
 *    richieste), mai una sezione di dettaglio;
 *  - una sola sezione attiva alla volta;
 *  - cambiare sezione non muta lo stato del mondo (solo navigazione).
```

La prima riga — «ogni cifra compare in una sola sezione» — **è violata** dalle
otto metriche del §1.2. Le altre tre invarianti sono rispettate.

Conseguenza pratica: chi implementa una sezione nuova oggi non ha un criterio per
sapere dove mettere una cifra, perché il criterio scritto non è applicato. Ogni
aggiunta successiva aumenta la duplicazione, e nessun test la intercetta.

**Il piano parte da qui:** rendere vera un'invariante già dichiarata, e coprirla
con un test che la difenda, prima di cambiare qualunque cosa nell'aspetto.

---

## 3. Perché il sovraccarico è un problema di prodotto, non di stile

Tre conseguenze osservabili, non estetiche.

**Il giocatore non sa se sta bene.** La scheda Situazione mostra Tesoreria, Saldo
mensile, Stabilità e Tensione sociale — quattro numeri — ma **nessuno dice quale
sia il problema**. Un saldo di −2,1 mld è grave su un PIL di 30 mld e irrilevante
su 3.000: senza il rapporto, il numero non è un'informazione.

**Il giocatore non sa cosa fare.** Le «Decisioni richieste» sono una card fra
sei nella stessa scheda, e le pressioni di pace sono un'altra card. La cosa più
importante — cosa richiede la mia attenzione adesso — è allo stesso livello di
«Sfide del momento», «Impegni della partita» e «Strategie delle potenze».

**Sei superfici per lo stesso stato.** `NationDock` e `OperatingPictureBoard`
mostrano lo stesso quadro con due impaginazioni diverse, e il secondo è montato
**dentro** il primo (`NationDock.tsx:121`). `ObjectsBoard` e `TimeDesk`
aggiungono altre due letture. Il costo non è solo visivo: sono quattro punti da
mantenere allineati quando una metrica cambia, e quattro occasioni di divergere.

---

## 4. La promessa: una schermata che risponde a tre domande

La direzione approvata è **sintesi vera + dettaglio a richiesta**. In concreto,
il dossier si apre su una sola schermata che risponde, nell'ordine:

1. **Sto bene o male?** Un giudizio, non quattro numeri. Con il rapporto che lo
   rende interpretabile («saldo −2,1 mld su entrate 28: pesa l'8%»).
2. **Cosa mi sta chiedendo attenzione adesso?** Una lista, ordinata per scadenza
   e gravità. Le pressioni di pace, le crisi, le scadenze del debito, i progetti
   che finiscono: **una sola lista**, non quattro card.
3. **Cosa posso fare?** Per ogni voce, l'azione minima. Se non c'è, dirlo.

Tutto il resto — le 34 card, le 56 metriche, le 93 etichette — resta raggiungibile,
ma **a richiesta**: una sezione «Dettaglio» con le otto aree di oggi, raggiungibile
dalla sintesi e mai aperta per default.

Il modello di riferimento è quello che il gioco già applica altrove con successo:
il **bollettino** del motore (`WorldStateEngine.playerBulletin`) dice in una frase
governo, popolazione, PIL, bilancio, crescita, stabilità, riserve, sforzo bellico e
tensione. Il dossier dovrebbe aprirsi con qualcosa di quella densità, non con sei
card.

---

## 5. Invarianti obbligatorie

Valgono per ogni fase. Sono contratti, non suggerimenti.

**I1 — Una cifra, un posto.** Ogni metrica ha **una sola** sezione di
appartenenza. Le ripetizioni elencate in §1.2 vanno risolte: la metrica resta dove
ha più senso, altrove si rimanda («vedi Cassa»), non si ricopia.

**I2 — Ogni cifra ha un giudizio.** Nessuna metrica compare da sola: o ha un
rapporto che la rende interpretabile («8% delle entrate»), o ha un tono
(`positive`/`warning`/`critical`), o entrambi. Un numero nudo è un difetto.

**I3 — La sintesi sta davanti al dettaglio.** All'apertura del dossier si vede la
sintesi (§4), mai una sezione di dettaglio. Vale per il desktop e per il mobile.

**I4 — Una sola lista di cose da fare.** Pressioni, crisi, scadenze, progetti e
impegni confluiscono in **una** lista ordinata. Nessuna seconda lista parallela.

**I5 — Nessuna superficie duplica lo stato.** `NationDock` e
`OperatingPictureBoard` non mostrano lo stesso quadro: o il secondo diventa la
sintesi (e il primo il dettaglio), o sparisce come superficie autonoma.

**I6 — Il dettaglio non perde nulla.** Nessuna metrica viene eliminata in questa
fase: cambia **dove** e **quando** si vede. Ogni numero raggiungibile oggi resta
raggiungibile.

**I7 — La verifica è un test.** Ogni invariante ha un test che la difende. I test
esistenti sul dossier (`nationDock.test.ts`, `hudMobileLayout.test.ts`,
`templateSelectorAccessibility.test.ts`) restano verdi.

---

## 6. Le fasi

Sette fasi, in ordine di dipendenza. Ogni fase è consegnabile da sola, con la sua
PR e il suo Quality Gate.

### D01 — Rendere vera I1 (una cifra, un posto)

**Cosa.** Risolvere le otto metriche duplicate di §1.2. Per ciascuna, decidere la
sezione di appartenenza e sostituire le occorrenze altrove con un rimando.

Criterio per decidere, in ordine: (a) dove la metrica è **azionabile**
(Tesoreria sta in Cassa, dove si emette debito); (b) dove è **spiegata** (Sforzo
bellico sta in Armamenti, dove si vede l'arsenale); (c) dove è **primaria** per
quella sezione.

**Proposta** (da confermare in fase di implementazione):

| Metrica | Resta in | Rimandi |
|---|---|---|
| Stabilità | Situazione | Risorse, Politiche |
| Tensione sociale | Situazione | Risorse, Politiche |
| Tesoreria | Cassa | Situazione (via sintesi) |
| Saldo mensile | Cassa | Situazione (via sintesi) |
| Sforzo bellico | Armamenti | Bilancio, Risorse |
| Spesa militare | Bilancio (una volta sola) | Armamenti |
| Scorte armi | Risorse | Armamenti |
| Realizzazione | Progetti (una volta per gruppo) | — |

**Verifica.** Un test nuovo che enumeri le metriche per sezione e fallisca su
qualunque duplicato. È il test che oggi manca e che ha permesso la deriva.

**Perché per prima.** È l'unica fase che *riduce* il lavoro delle successive:
senza, ogni schermata nuova eredita le ripetizioni.

### D02 — Ogni cifra ha un giudizio (I2)

**Cosa.** Passare in rassegna le 56 metriche delle schede e assicurare a ciascuna
un rapporto interpretabile o un tono. Dove oggi c'è `Tesoreria: 12,4`, deve
leggersi `Tesoreria 12,4 mld` con il tono del caso, e dove serve `(0,4 mesi di
uscite)`.

**Attenzione.** Il motore ha già i toni (`stabilityTone`, `tensionTone`,
`warEffortTone`, `statusDossierTone`): la fase è di **applicazione**, non di
invenzione di nuova logica. Dove manca un tono, la soglia va dichiarata nel modulo
di presentazione, non nel componente.

**Verifica.** Test sul modulo di toni: ogni metrica delle schede ha un tono o un
rapporto; nessuna metrica nuda.

### D03 — La sintesi che risponde a tre domande

**Cosa.** Costruire la schermata di apertura del §4: giudizio complessivo,
lista unica di cose da fare, azione minima per voce.

**Fonte dei dati.** Il motore pubblica già tutto ciò che serve: il bollettino
(`playerBulletin`), le pressioni evidenziate (`highlightPressures`, max 2),
lo stato di crisi (`assessCrisis`), le scadenze del debito (`maturedDebts`,
`averageMaturityYears`), i progetti per categoria. **Nessuna cifra nuova**: la
sintesi è una lettura, come lo è già `deriveDiplomacyPresence`.

**Riuso.** `OperatingPictureBoard` ha già le sei aree con stato, titolo e
problemi (`domain.drivers`) e una funzione che apre la sezione giusta
(`onOpenSection`). È il mattone giusto: la sintesi si costruisce **su** quel read
model, assorbendolo (I5) invece di affiancarlo.

**Verifica.** Test che, dato uno stato, la sintesi produca: un giudizio, una lista
non vuota quando c'è qualcosa da fare, e una lista **vuota** quando non c'è nulla
(nessun riempitivo).

### D04 — Una sola lista di cose da fare (I4)

**Cosa.** Fondere in un'unica lista ordinata: pressioni di pace attive, stato di
crisi, scadenze del debito entro l'orizzonte, progetti in scadenza, impegni
(`commitmentsWorthAttention`). Ordinamento: prima ciò che **chiude la partita**
(crisi), poi ciò che **scade** (finestre delle pressioni, scadenze), poi il resto.

**Attenzione.** Le pressioni hanno già una finestra e una priorità
(`pressureWindow`, `pressurePriority`): l'ordinamento deve usarle, non
reinventarle.

**Verifica.** Test che con crisi attiva la crisi sia prima; che con due pressioni
la più urgente preceda; che a lista vuota non si mostri nulla.

### D05 — Il dettaglio a richiesta (I3, I6)

**Cosa.** Spostare le otto sezioni attuali dietro la sintesi: raggiungibili,
mai aperte per default. Navigazione a due livelli: sintesi → sezione → (dove
serve) card.

**Vincolo.** Nessuna metrica sparisce (I6). Se una metrica non trova posto, il
posto è sbagliato: si corregge la sezione, non si elimina il numero.

**Verifica.** Test che all'apertura l'elemento attivo sia la sintesi; che ogni
sezione resti raggiungibile; che l'elenco delle metriche per sezione coincida con
quello di D01 (nessuna perdita).

### D06 — Una superficie sola per lo stato (I5)

**Cosa.** Risolvere la convivenza `NationDock` / `OperatingPictureBoard` /
`ObjectsBoard` / `TimeDesk`. La sintesi (D03) assorbe il quadro d'insieme;
`ObjectsBoard` diventa la sezione «Impianti» del dettaglio; `TimeDesk` resta la
superficie del **tempo** (che è una cosa diversa dallo stato) e va lasciata al suo
mestiere.

**Attenzione — punto delicato.** `ObjectsBoard` è citato come «sala di governo» e
compare nella documentazione come superficie a sé (OP-OBJECTS). Fonderla è un
cambiamento di prodotto, non una pulizia: va confermato dall'autore prima di
eseguire, e se confermato va aggiornato il report di origine.

**Verifica.** Test che nessun componente monti un secondo quadro d'insieme;
screenshot del dossier aperto con una sola intestazione di stato.

### D07 — Le card che spiegano, tolte

**Cosa.** Eliminare le card didattiche interne (*«Come si legge l'arsenale»*,
*«Sala di governo»* quando è una legenda): la spiegazione va **dove serve**, cioè
nel rapporto che accompagna la cifra (I2) o in un'informazione contestuale
attivabile, non in una card permanente che occupa la schermata a ogni apertura.

**Verifica.** Ricerca nel codice: nessuna card con titolo che inizi per «Come si
legge». Le spiegazioni necessarie sono coperte dai test di D02.

---

## 7. Criteri di completamento e verifica

Il piano è completo quando, **contemporaneamente**:

| # | Criterio | Prova |
|---|---|---|
| C1 | Nessuna metrica compare in due sezioni | test di D01, verde |
| C2 | Ogni metrica ha tono o rapporto | test di D02, verde |
| C3 | Il dossier si apre sulla sintesi, su desktop e mobile | test di D03/D05 + `hudMobileLayout` verde |
| C4 | Una sola lista di cose da fare | test di D04 |
| C5 | Una sola superficie per il quadro di stato | test di D06 |
| C6 | Nessuna metrica perduta rispetto a oggi | confronto fra l'elenco di D01 e quello di D05 |
| C7 | `tsc` pulito, build verde, Quality Gate verde | CI |
| C8 | Le tre suite a11y restano verdi | `npm run test:a11y` |

**Ordine di consegna.** D01 e D02 sono indipendenti e a basso rischio: si possono
fare subito, in due PR. D03–D05 sono il cuore e vanno in una PR sola (la sintesi
senza il dettaglio dietro sarebbe monca). D06 richiede una conferma di prodotto.
D07 è cosmetico e può chiudere.

---

## 8. Cosa NON fare

**Non aggiungere una scheda.** Ogni problema di chiarezza di questo dossier è
stato finora risolto aggiungendo una card o una superficie: è il meccanismo che
ha prodotto lo stato attuale. Se una fase sembra richiedere una scheda nuova, il
progetto della fase è sbagliato.

**Non eliminare metriche.** La riduzione è di **gerarchia**, non di contenuto
(I6). Un numero che il motore calcola e il giocatore non vede più è una
regressione, non una semplificazione.

**Non inventare cifre per la sintesi.** La sintesi è una **lettura** di ciò che il
motore pubblica già (bollettino, pressioni, crisi, scadenze). Il motore resta
l'unica fonte: la sintesi non calcola, sceglie e ordina.

**Non toccare il motore per far tornare l'interfaccia.** Se una sintesi non si può
costruire con i dati pubblicati, la risposta è cambiare la sintesi, non aggiungere
un endpoint. Le eccezioni vanno discusse come fase a sé.

**Non rompere il mobile.** Il dossier mobile ha già una sua disciplina
(`hudMobileLayout.test.ts`): ogni fase deve restare verde lì.

---

## Appendice — i due difetti di identità corretti prima di questo piano

Trovati durante la diagnosi del dossier, corretti e verificati nello stesso giorno
(branch `fix/debito-date-e-nomi-paesi`). Sono inclusi qui perché appartengono alla
stessa famiglia: **un numero e un nome che dicevano una cosa falsa.**

**Date del debito fuori epoca.** Il magazzino veniva seminato prima che la sessione
conoscesse la data del mondo, quindi i titoli nascevano con il default dello stato
(`1951-01-01`). In un mondo del 2000: `issued=1951-01-01`, `maturity=1954-01-01` —
scaduti 46 anni prima — e la scadenza media del dossier valeva **zero**, perché
ogni titolo era oltre la maturità. Corretto fissando la data prima della semina, e
con `normalizeInheritedDebtDates` per i salvataggi già scritti.

**Il nome del paese era quello di una provincia.** Il read model diplomatico
ricavava il nome della polity dalla provincia capitale, quindi `ITA` si leggeva
«Aosta». La relazione è per codice e il codice non è un nome: il motore ora espone
`getRelationshipNames()` (stessa fonte di tutto il resto: registro dei paesi, nomi
italiani curati, nomi storici dei preset) e il client la usa.

Nota metodologica per chi implementa il piano: entrambi sono stati trovati
**misurando**, non leggendo. Il primo con una partita vera su un mondo del 2000; il
secondo cercando da dove venisse una stringa. Vale la stessa disciplina per le fasi
del piano: ogni criterio di §7 è una misura, non un'impressione.

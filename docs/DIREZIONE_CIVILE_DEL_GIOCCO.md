# World Story — la direzione civile del gioco

**Versione:** 1.0, 25 settembre 2026.
**Stato:** **M01, M02, M03 implementate e verificate.** M04 è la verifica e il deploy.
**Destinatari:** sviluppatori e LLM esecutori; ogni scelta marcata «obbligatoria» è un
contratto.
**Mandato:** come per i piani precedenti, **solo frontend**. Il motore non si tocca.
**Rapporto con gli altri piani:** prosegue `PIANO_CHIAREZZA_DOSSIER_NAZIONE.md` (D01–D07) e
`COERENZA_DOSSIER_ANNO_NAZIONE.md` (N01–N08). Quei due hanno risolto *dove* sta una cifra, *di
quando* e *di chi* è. Questo risolve **per chi** si governa.

> **La richiesta, in una riga.** «Un giocatore potrebbe voler risolvere l'economia e la
> qualità di vita del popolo e non fare la guerra al mondo.» Il gioco non glielo permetteva
> di **vedere**: il motore lo permetteva già.

---

## 1. La diagnosi, misurata

Lo sbilanciamento **non è nel motore**. Questo è il fatto che ha guidato tutto il lavoro:

| Dove | Cosa dice la misura |
|---|---|
| **Motore — bilancio** | Le voci civili esistono e sono ricche: amministrazione (peso 26), istruzione e ricerca (10 + 2,6 per ateneo), sanità e assistenza (16 + popolazione), infrastrutture (10 + porti + fabbriche), sostegno sociale e lavoro (12 + mobilitati). La difesa è **una** voce, presa dalla quota dichiarata dal conto. |
| **Motore — fazioni** | Sette anime con leve proprie: welfare, istruzione, infrastrutture, tasse, debito, ordine, difesa. Solo **una** spinge le armi. |
| **Motore — pressioni di pace** | 16 template: scioperi, corruzione, carestia, emigrazione, movimento separatista, inflazione, reduci, commercio, sanzioni, rifugiati, opinione pubblica… Solo **due** sono militari (una manovra del vicino, un incidente di confine). |
| **Motore — dati sociali** | Pubblica `socialBurdenPct`, `educationBurdenPct`, `gdpPerCapitaUsd`, atenei, popolazione, ricerca, stabilità, tensione sociale. |
| **Frontend — dossier** | La scheda **Armamenti ha 8 blocchi** — il massimo di ogni scheda. La dimensione civile aveva **una metrica** non duplicata (il PIL pro capite): le altre due erano rimandi. |
| **Frontend — quadro d'insieme** | Cinque aree: economia, risorse, industria, militare, governo. **Per la qualità della vita non c'era un'area.** |
| **Frontend — sintesi** | Elencava crisi, sfide, impegni e problemi. Nessuna via d'ingresso civile: un giocatore che voleva investire nel popolo leggeva solo minacce. |

**Conclusione.** Il motore dà al giocatore gli strumenti per governare in pace; l'interfaccia
lo presentava come un capo di stato maggiore. La direzione si cambia **presentando meglio ciò
che c'è**, non aggiungendo meccaniche — e quindi, coerentemente col mandato, senza toccare il
motore.

---

## 2. Le tre correzioni

### M01 — L'area «Popolo» nel quadro d'insieme

**Cosa.** Una **sesta** area, `peopleOperatingPicture`, fra le forze armate e il governo.
Legge i dati civili che il motore già pubblica e che nessuna scheda metteva in fila: spesa
sociale e per l'istruzione, **quota della spesa che va al popolo invece che alle armi**,
atenei, ricerca, tenore di vita, tensione, stabilità.

**Perché l'ordine conta.** Prima si legge ciò che il paese **ha** (economia, risorse,
industria, armi), poi **per chi lo ha** (il popolo), poi **chi lo governa**. La posizione non
è arbitraria: è la sequenza in cui la domanda «sto bene?» incontra la sua risposta civile.

**Verifica.** 10 test. Le soglie della spesa civile sono dichiarate in una costante
(`CIVIL_SPENDING_THRESHOLDS`); dove il motore non pubblica entrambe le voci, la quota è `null`
e il dossier lo dichiara invece di stimare.

> **Consegnata** — `peopleOperatingPicture.ts`, 10 test in `peopleOperatingPicture.test.ts`,
> e la sezione `popolo` in `nationalOperatingPicture`. Un test aggiornato: i domini erano
> cinque, ora sei (con il commento che dice perché «Popolo» sta dove sta).

### M02 — La sintesi mostra le occasioni, non solo le minacce

**Cosa.** Un blocco **separato** dopo la lista delle urgenze: capacità industriale libera,
avanzo di cassa, ricerca accumulata da spendere, atenei mancanti, spesa civile sottile.

**Il punto delicato, e come è risolto.** Un'occasione non deve **mai** scalzare ciò che
stringe. Ha l'ultima fascia di priorità (`ORDER.occasione`, dopo `attenzione`), e la vista la
tiene in un blocco distinto: se il paese è in crisi, la crisi resta in testa e l'occasione
scende sotto. Due test lo difendono esplicitamente, uno con una crisi critica attiva.

**La distinzione è semantica, non estetica.** Le urgenze sono cose *da fare*; le occasioni sono
cose *che si possono fare*. Mescolarle farebbe sembrare un invito allo sviluppo una crisi da
risolvere.

**Verifica.** 6 test: le occasioni esistono quando ci sono i margini; vengono dopo ogni
urgenza; con una crisi la crisi resta prima; **senza occasione il blocco non compare** (nessun
riempitivo).

> **Consegnata** — `opportunityItems` in `nationalSynthesis.ts`, il campo `opportunity` su
> `SynthesisItem`, il blocco in `NationalSynthesisPanel.tsx`, lo stile in `index.css`.

### M03 — Pari dignità alla dimensione civile

**Cosa.** Un blocco «Investimento nel popolo» nella sezione Conoscenze: istruzione e ricerca,
sanità e sostegno, e — accanto — la spesa militare, con la **quota al civile**. Sotto, le voci
civili del bilancio con i loro importi.

**Perché non è una classifica morale.** Il testo del blocco lo dichiara: sono le due scelte che
lo stesso bilancio deve fare. Una nazione che arma e non istruisce non è più forte — è più
fragile, perché la ricerca cresce solo con gli atenei. Questa non è retorica: è la formula del
motore (`education` pesa `10 + atenei × 2,6`).

**Il test-contratto D01 ha intercettato due violazioni reali**, entrambe mie, entrambe corrette
rispettando l'invariante:
1. «Istruzione e ricerca» compariva in due sezioni con due copie canoniche → in Cassa è
   diventata un rimando a Conoscenze.
2. «Spesa militare» era usata due volte per lo stesso numero → nel blocco civile si chiama
   **«Quanto alle armi»**, e il rimando porta alla voce canonica.

Questo è il valore della disciplina: l'invariante «una cifra, un posto» ha fermato una
duplicazione che avevo introdotto io mentre lavoravo *per* la chiarezza.

---

## 3. Il Consulente — la resa del testo

Difetto separato, della stessa famiglia («una richiesta senza chi la soddisfa»). Il prompt del
Consulente chiede al modello di scrivere «con titoli, grassetto, elenchi»
(`prompts/advisor.ts`), ma il componente stampava il testo **grezzo** con
`white-space: pre-wrap`: il giocatore leggeva `**grassetto**` con gli asterischi e `## Titolo`
col cancelletto.

**Correzione.** `richTextModel.ts` interpreta un sottoinsieme di markdown; `RichText.tsx` lo
rende in **elementi React**. Non si usa `dangerouslySetInnerHTML`: il testo arriva da un
modello linguistico, e inserirlo come HTML sarebbe una superficie di iniezione. Un test lo
verifica sul codice (senza i commenti, che la tecnica la *citano* per dire che non si usa).

**Ambito.** Solo il ruolo `assistant`: il messaggio del governo è testo che scrive il
giocatore, e si mostra com'è.

**Verifica.** 14 test. Due corretti durante il lavoro perché erano più ingenui del codice: uno
cercava `dangerouslySetInnerHTML` anche nel commento che spiega perché non si usa, l'altro
pretendeva che il paragrafo avesse un ramo esplicito nel `match` quando è il caso di default.

---

## 4. Cosa NON è stato fatto, e perché

**Non si è toccato il motore.** Il mandato lo vieta, e la diagnosi dice che non serve: gli
strumenti civili ci sono. Aggiungere meccaniche avrebbe risposto a un problema di
presentazione con del codice nuovo.

**Non si è eliminato nulla del militare.** La scheda Armamenti ha ancora i suoi 8 blocchi, e
deve averli: chi vuole fare la guerra ha diritto agli stessi strumenti di chi non la vuole.
L'obiettivo non era ridurre il militare, era **dare una casa al civile**.

**Non si è toccato il prompt del Consulente né quello dei suggerimenti.** Il modello chiede già
«2-3 opzioni concrete con i costi e i rischi», che non è un invito alla guerra — è una richiesta
di concretezza. Se il consulente risponde ancora troppo in chiave militare, la causa va
**misurata** su risposte reali, non dedotta dal prompt.

---

## 5. Verifica

| Prova | Esito |
|---|---|
| `tsc --noEmit` | pulito |
| Test frontend (94 file) | **tutti verdi**, a blocchi (234 + 265 + 286 = **785 test**) |
| Nuovi test | 24 in `peopleOperatingPicture.test.ts` (12) e `richTextModel.test.ts` (12), più 2 in `richTextModel` per la sicurezza |
| Test aggiornati | 1 (`nationalOperatingPicture.test.ts`: cinque domini → sei) |
| Violazioni intercettate dai test-contratto | **2** (D01: «Istruzione e ricerca» duplicata; «Spesa militare» due volte) |
| `git diff` su `backend-nest/` | **vuoto**: il motore non è stato toccato |
| E2E Playwright | non eseguibili in questa macchina (mancano le librerie di sistema del browser); da rilanciare in CI |

---

## 6. Cosa resta aperto

**Non è una fase, è una misura che manca.** Il prompt dei suggerimenti e quello del Consulente
chiedono «strategia» e «opzioni con costi e rischi»: non è detto che il modello li legga come
scelte di potenza, ma **non lo sappiamo**. La verifica giusta è raccogliere **risposte reali**
su partite diverse e contare quante propongono vie civili e quante vie militari. Se lo
sbilanciamento è anche lì, la correzione è nel prompt — ed è una fase a sé, con la sua misura.

**Le scelte di prodotto che restano:** nessuna nuova. M01–M03 non richiedevano decisioni perché
non toccano il motore e non eliminano nulla.

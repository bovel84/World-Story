# WS-GOVOFFICE-03 — L'Ufficio del Governo a due pannelli e il Registro firmato

Branch: `feat/ws-govoffice-03` · Base: `main` @ `2781460`.
Classe: **A** — evoluzione di una feature già scritta (una colonna → due pannelli;
la coda → registro firmato). Nessuna migrazione. Nessuna route nuova. Nessun tocco
al motore congelato.

---

## 1. Problemi trovati (causa reale)

### 1.1 La richiesta dell'autore

> «La schermata è confusa possiamo immaginarla con due pannelli una con la chat e
> l'altra con i dati della nazione e di competenza del ministro. Gli ordini
> presettati non mi piacciono e poi gli ordini registrati non si devono vedere
> nella pagina di dialogo con il ministro. Possiamo immaginare gli ordini nella
> prima schermata come magari un registro ufficiale con la firma del presidente.»
>
> (con due chiarimenti successivi: «la seduta con il ministro crea l'ordine» e
> «il compositore libero sparisce del tutto»)

### 1.2 Il difetto, verificato sul codice

La schermata di seduta era **una colonna sola** che impilava cinque cose:
le cifre della sedia, le **strade proposte** (`.minister-path` con badge
«consigliata», prerequisiti, esito atteso), la chat, la coda «Ordini in attesa
del turno» (`.pending-actions-section`, con ✎/×) e il compositore libero
(`ActionsPanel`). Quattro conseguenze reali:

1. **Le strade erano ordini presettati.** Un click e l'ordine era in coda, senza
   scrivere nulla: è letteralmente un preset, non una proposta da discutere.
2. **La coda stava nella pagina del dialogo.** Gli ordini già deliberati si
   vedevano *mentre* si parlava con il ministro, mescolando lettura e lavoro.
3. **Il compositore era una seconda via all'ordine** accanto al dialogo, e
   l'unico punto dell'app che usava la verifica di fattibilità.
4. **Gli ordini non avevano una superficie di lettura.** Non esistevano un
   registro né una firma: solo la lista operativa della coda.

---

## 2. Cosa è stato fatto

### 2.1 Il flusso, ora

- **Prima schermata** — il **Registro degli atti** in cima (lettura), poi i
  riquadri dei ministri. Niente chat, niente coda operativa, niente compositore.
- **Seduta** — **due pannelli**: dialogo a sinistra, dati del ministro a destra.
  L'ordine nasce **solo** dal dialogo (il pulsante «↳ Concludi con un ordine da
  questo problema» sotto ogni messaggio del giocatore) e finisce nel registro.

### 2.2 Il registro e la firma

`OrderRegister` è una superficie di **lettura**: `<ol>` semantico, un blocco
documento per atto, e la firma **in calce, una volta sola** — come su un registro
rilegato, perché ripeterla per ogni atto suggerirebbe firme che nessuno ha messo.

Il **«Ritira»** è l'unico gesto operativo del registro (l'atto non si modifica:
si ritira e si rifà in seduta). Due difese perché non si rompa: la parola resta
su una riga (`white-space: nowrap`, `word-break: keep-all`) e il **testo dell'atto
cede per primo** (`min-width: 0` sull'elemento flessibile), così un atto con una
parola lunghissima non spinge mai il pulsante fuori dal riquadro. Verificato a
1440, 1100, 768 e 390 px, con uno e con più atti: il pulsante resta dentro il
blocco, cliccabile e su una riga.

```
Per il Governo di <Nome Stato>
Il Presidente del Consiglio
<data corrente di gioco>
```

**Limiti dichiarati** (§7): il motore registra `PendingAction { id, text }` e
basta. Non esiste un nome di persona (l'unico nome autorevole è quello dello
**Stato**, `nationalName`) e non esistono sedia né data **per singolo atto**:
il registro non le inventa. Se il nome dello Stato non è pubblicato, la riga
«Per il Governo di …» **si omette** (`isNameUnknown`) invece di inventarla.

### 2.3 Il pannello destro e il «numero unico»

`MinisterDossier` mostra la competenza della sedia, le sue cifre (con la
provenienza) e la scheda del **dominio nazionale** di quella materia, riusando
`DomainCard` del quadro d'insieme.

Il vincolo che ha deciso l'architettura: `nationalOperatingPicture` era composto
in **un solo posto** (`useNationDockModel.ts`), con dodici ingressi già derivati.
Chiamarlo di nuovo con ingressi diversi avrebbe mostrato **due numeri diversi per
lo stesso dominio**. La composizione è quindi stata estratta in
`nationOperatingPictureInput.ts`, usato da **entrambi**. Non è un read model
nuovo: è la derivazione del dossier, spostata dove può essere condivisa.

La mappa **sedia → dominio** (`seatDomains.ts`) non esisteva: è la trascrizione
di `SEAT_READS` del motore (`backend-nest/src/core/government/Cabinet.ts`), tenuta
vicina nel commento perché se il motore cambia una competenza va cambiata con lei.

### 2.4 Ciò che è uscito, e cosa se ne perde

| Uscito | Motivazione | Effetto |
|---|---|---|
| `.minister-path` (strade proposte) | sono ordini presettati | l'ordine nasce dal dialogo |
| `.pending-actions-section` dalla seduta | richiesta dell'autore | vive nel registro |
| `ActionsPanel` (compositore libero) | decisione dell'autore | vedi §7 |
| «Porta in consiglio» (fazione) | riempiva la bozza del compositore, che non esiste più | la richiesta resta in lettura |

### 2.5 Cosa **non** è stato toccato, e perché

- **La verifica di fattibilità** (`verifyOrder` → `checkFeasibility` →
  `FeasibilityCheck`) resta nel codice ma **non è più montata**: era raggiungibile
  solo dal compositore. `feasibilityCheck.test.ts` resta verde e la capacità è
  recuperabile (vedi §7).
- **`CabinetSession`**: le strade restano nel *consiglio intero*
  (`variant="full"` senza `onlySeat`), che è comportamento storico usato solo dai
  test, non dal flusso a due schermate. Le strade sono uscite da `MinisterChat`.
- **Il motore**: nessuna rotta, nessuno schema, nessun read model nuovo.
  `docs/implementation/q02-endpoint-inventory.json` resta invariato.

---

## 3. Invarianti

- **MG-I1 (aggiornata)** — *leggere* il registro non impegna nulla; *concludere*
  un ordine in seduta lo mette in coda. Aprire l'Ufficio, aprire una sedia,
  leggere il registro: nessuna mutazione.
- **`queuePlayerAction` resta l'unico punto che tocca la coda.** Sia l'esito del
  dialogo sia «Ritira» passano dalle rotte del motore (`queueAction`, DELETE
  `queue/:id`): mai una mutazione locale, che creerebbe un ordine fantasma.
- **Il motore non ha un presidente.** La firma è d'ufficio; il nome è quello
  dello Stato e, se manca, si dichiara l'assenza.
- **Nessun `!important`** nei selettori `.cabinet*` / `.minister-*`
  (`cssDiscipline.test.ts`): rispettato.
- **Un dominio, un numero**: la composizione del quadro operativo è una sola e
  condivisa — ed è difesa da `operatingPictureBoard.test.ts`.

---

## 4. Verifica

| Prova | Esito |
|---|---|
| Unit frontend (`vitest run`) | **880/880** (104 file) |
| Build di produzione (`npm run build`) | verde, 15,4 s |
| E2E mock — U02, P04, P05 | **3/3** (il registro, «Ritira», i due pannelli, le strade assenti) |
| A11y (`playwright.a11y.config.mjs`) | **3/3**, 54 s — audit sul registro *con un atto dentro* e sulla seduta a due pannelli |
| Typecheck (`tsc --noEmit`) | pulito |

Il gate **richiesto** su `main` resta `test-build` (`ci.yml`): test backend, test
frontend, build. Il backend non è stato toccato. Gli E2E mock restano informativi
(`continue-on-error`) per la nota fragilità del loro teardown su macOS — gli
errori «worker did not exit» non sono fallimenti di test.

---

## 5. File

**Nuovi** — `OrderRegister.tsx`, `MinisterDossier.tsx`, `seatDomains.ts`,
`nationOperatingPictureInput.ts`.

**Modificati** — `GovernmentOffice.tsx` (il cambiamento centrale),
`MinisterChat.tsx`, `GameScreen.tsx`, `NationDock.tsx`, `NationDock/types.ts`,
`NationDock/widgets.tsx`, `NationDock/useNationDockModel.ts`, `DeskContent.tsx`,
`editorial.css`, `ordersModuleTheme.test.ts`, `operatingPictureBoard.test.ts`,
`e2e/tests/modules.spec.mjs`, `e2e/a11y/a11y.spec.mjs`.

---

## 6. Debito tecnico ripulito

- Rimossa l'ultima copia della derivazione del quadro operativo: ora è una sola
  (`nationOperatingPictureInput.ts`) e il test la difende.
- Rimosso il percorso «fazione → bozza d'ordine» e il pulsante «Porta in
  consiglio», che non avevano più una destinazione.

---

## 7. Limiti residui (dichiarati, non nascosti)

1. **La verifica di fattibilità non è più raggiungibile dall'interfaccia.**
   `useOrderQueue.verifyOrder`/`registerOrder` e `FeasibilityCheck` restano nel
   codice, non montati. Se si vuole la cancellazione completa, vanno rimossi
   anche loro e il loro test. **Decisione da confermare.**
2. **Nessun nome di persona per la firma.** Il motore non ne ha: la firma è
   d'ufficio («Il Presidente del Consiglio») più il nome dello Stato.
3. **Nessuna sedia né data per singolo atto.** Il motore non le registra; la
   firma è in calce con la data corrente. Per averle servirebbe un read model
   lato motore (proposta §8.3 del report WS-GOVOFFICE-02).
4. **Dopo un ricaricamento si perde la distinzione tra ordini della stessa
   seduta**: il registro li mostra nell'ordine della coda, che è quello giusto,
   ma senza raggruppamento per ministro.

---

## 8. Proposte per la fase successiva

1. **La richiesta di una fazione, portata al ministro giusto.** Oggi resta in
   lettura nel pannello del consiglio; il giocatore la ricopia a mano nel
   dialogo. Un «porta questa richiesta al ministro di competenza» aprirebbe la
   seduta giusta con la richiesta già in contesto.
2. **Un segno di provenienza sull'atto** («dalla seduta con il Tesoro»), che
   richiede però la sedia per atto lato motore (limite §7.3).
3. **Il registro nel Piano (TimeDesk)**: gli atti si vedono già lì come conteggio;
   portarvi la lettura firmata renderebbe il salto di tempo più consapevole.

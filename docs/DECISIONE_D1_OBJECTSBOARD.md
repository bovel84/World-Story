# World Story — decisione D-1: dove vive `ObjectsBoard`

**Versione:** 1.1, 26 settembre 2026.
**Stato:** **decisione presa e consegnata** — opzione **B** (pannello proprio
«Forze»). Il codice è su `frontend/src/`: `ForcesPanel.tsx`, modulo `forze` in
`moduleState.ts` + `CommandRail`/`nationalContext`, `countTroubledUnits` in
`operationalObjects.ts`; `ObjectsBoard` tolto dal dossier. 625 + 198 test verdi,
tsc pulito, build verde. Le domande di §5 restano disponibili se si vuole un
secondo parere da Jev, ma la decisione non è più in attesa.
**Origine:** `RIORGANIZZAZIONE_DOSSIER_STILE_VICTORIA3.md` §7, dove è registrata come
«decisione aperta D-1», da prendere ora che «Stato maggiore» ha la sua forma.
**Vincolo:** solo frontend. Le 12 azioni sono del motore e restano sue.

> **La domanda in una riga.** `ObjectsBoard` è una **sala operativa** (crea reparti,
> impartisce ordini, ri-equipaggia) montata dentro il Dossier nazionale, che dopo
> V01–V05 è diventato un **documento di stato**. Un blocco che agisce dentro un
> documento che si legge è la stessa tensione che ha fatto uscire le sfide (V01):
> resta nel dossier, o ha una casa propria come le Questioni?

---

## 1. Il fatto misurato

`ObjectsBoard.tsx` è **331 righe** e monta `UnitActionPanel.tsx` (**278 righe**).
Espone **12 azioni**, tutte pubblicate dal motore (`OperatingAction['id']`):

| Categoria | Azioni |
|---|---|
| Formazione | `raise_formation` (crea reparti) |
| Approvvigionamento | `procure`, `trade` |
| Reparto | `reinforce_unit`, `reequip_unit`, `reconstitute_unit`, `transfer_unit`, `reassign_unit` |
| Ordini tattici | `order_attack`, `order_defend`, `order_reserve`, `order_withdraw` |

## 2. Dove sono raggiungibili oggi — la misura che decide

`ObjectsBoard` è montato in **un solo posto**: dentro il Dossier, sezione «Stato
maggiore». Le azioni di reparto e gli ordini (`onUnitAction`, `onUnitOrder`,
`UnitActionPanel`) sono raggiungibili **anche** dal `ProvinceInspector`
(`components/Shell/ProvinceInspector.tsx`), il pannello che si apre **cliccando un
reparto o un fronte sulla mappa**.

**Il modulo Ordini non contiene nessuna di queste azioni**: `ActionsPanel.tsx` non
riceve le props e non nomina reparti, armate o formazioni. È la scrittura di ordini in
linguaggio naturale, altra cosa.

**Cosa è davvero unico** (misura, dopo la correzione sotto): la sola azione che
esiste **solo** in `ObjectsBoard` è `raise_formation` — creare reparti.
`procure` e `trade` vivono nel dossier, nei suoi stessi blocchi, e non nella sala.

**Correzione (2026-09-26, seconda misura).** La prima stesura di questa sezione
diceva che `raise_formation`, `procure` e `trade` erano «l'unica porta» di
`ObjectsBoard`. **È vero solo per `raise_formation`.** Le altre due vanno precisate,
e la misura lo mostra:

- `procure` e `trade` sono pubblicate dal motore come azioni **sugli oggetti**, ma
  `ObjectsBoard` **non le esegue**: il suo `onClick` gestisce il solo
  `raise_formation` (`ObjectsBoard.tsx:167`) e il pannello non riceve nemmeno le prop
  `procure`/`trade` (grep = 0). Quei due pulsanti, nella sala, sono **inerti**.
- Le stesse due azioni sono raggiungibili **dal dossier**, nei blocchi «Produzione e
  acquisti» («Costruisci» / «Importa», `NationDock.tsx:1105-1106`) e «Risorse
  naturali» (`ResourceTradeRow` + `runTrade`, `NationDock.tsx:787`), che restano.

Quindi la porta unica è **una sola azione**, `raise_formation` (creare reparti), non
tre. La decisione B non cambia — la sala agisce comunque, e senza di essa
`raise_formation` resterebbe senza casa — ma l'argomento è più stretto di come l'avevo
scritto.

**Difetto trovato di conseguenza** (fuori dal mandato D-1): nella sala operativa i
pulsanti `procure`/`trade` sono mostrati ma non fanno nulla — un `onClick` mancante in
`ObjectsBoard.tsx`. Decisione separata.

## 3. La premessa sbagliata (da correggere nel piano V)

Il piano V (§7) diceva, come motivazione per lasciare `ObjectsBoard` nel dossier:

> «le sue azioni sono già disponibili anche dal modulo Ordini»

**È falso**, e la misura lo mostra: il modulo Ordini non riceve quelle props. La
frase era una deduzione, non una misura — esattamente il tipo di affermazione che il
metodo dell'autore vieta («misurare, non leggere»). Va corretta nel piano V.

## 4. Le opzioni — **scelta B**

> **Decisione dell'autore, 2026-09-26: opzione B.** `ObjectsBoard` è uscita dal
> dossier e vive nel pannello **«Forze»** della barra comandi (nuovo modulo
> `forze`), con il distintivo che conta i reparti con problemi. Il dossier è
> tornato documento di stato puro (31 blocchi, nessun blocco interattivo).
> L'azione che era unica — `raise_formation` (creare reparti) — resta
> raggiungibile, dal pannello; `procure` e `trade` restano nel dossier, dove
> erano già (e funzionanti). `ObjectsBoard` è montato **una volta sola**, lì:
> niente più doppio montaggio fra dossier e mappa.



**A — `ObjectsBoard` resta nel dossier, in «Stato maggiore» (statu quo di fatto).**
Il dossier torna a contenere un blocco interattivo, che è la cosa da cui V01–V05 l'hanno
ripulito — ma è un blocco **operativo**, non una sfida: agisce su oggetti del paese, non
risponde a una pressione. Ha un precedente nel codice: `UnitActionPanel` in
`ProvinceInspector` è interattivo in un pannello di contesto.
*Costo:* il documento di stato contiene di nuovo un'azione; la tensione di V01 resta.

**B — `ObjectsBoard` diventa un pannello proprio, come «Questioni».**
Nuovo modulo `forze` nella barra comandi (badge: reparti con problemi?), montato in
`DeskContent` come gli altri, con le stesse props. Il dossier resta puro documento di
stato; la sala operativa ha la sua porta, accanto a Ordini e Questioni.
*Costo:* si tocca `moduleState`/`CommandRail` (ora a definizione unica, quindi
economico) e `DeskContent`; le props operative (`onRaiseFormation` e le azioni di
reparto) passano al pannello nuovo — sono già in `DeskContent`. `procure`/`trade`
**non** si spostano: restano nel dossier, dove erano già funzionanti.

**C — `ObjectsBoard` esce del tutto: le sue azioni si spostano dove servono.**
`raise_formation`/`procure`/`trade` in un pannello «Forze»; le azioni di reparto e gli
ordini restano al `ProvinceInspector`, che già le ha. Il dossier non le mostra più.
*Costo:* è l'opzione più grande, e rischia di spezzare in due una sala che oggi è una.
Sconsigliata **prima** di una prova d'uso: non sappiamo se il giocatore la usa davvero
dal dossier o solo dal contesto mappa.

## 5. I criteri per il giudizio (payload Jev)

La decisione si può sostenere su cinque giudizi, che è dove Jev serve. Stato = i fatti
misurati qui sopra; domande tipizzate:

| # | Domanda | Tipo |
|---|---|---|
| 1 | Una sala che **crea reparti e dà ordini** appartiene a un documento di stato o a una superficie operativa? | `choice` (stato / operativa / entrambe) |
| 2 | Il fatto che `raise_formation` sia altrove **irraggiungibile** è un argomento per tenerla nel dossier o per darle un pannello proprio? | `choice` |
| 3 | `UnitActionPanel` in `ProvinceInspector` è interattivo: rende coerente un blocco interattivo anche nel dossier? | `noul` |
| 4 | Quanto la scelta B (pannello proprio) è coerente con la decisione già presa di separare le sfide (pannello Questioni)? | `score` (0–3) |
| 5 | Quanto la scelta C (spezzare la sala in due) rischia di rompere un flusso d'uso che oggi funziona? | `score` (0–3) |

## 6. Raccomandazione (da confermare)

**Opzione B.** È la sola che risolve la tensione di V01 senza perdere una porta: le
sfide sono uscite dal dossier e sono andate in un pannello proprio — la sala operativa
segue lo stesso principio, e il precedente è appena stato costruito in V01
(`QuestionsPanel` + modulo `questioni`), quindi il costo è basso. L'opzione A lascia
aperta la contraddizione; la C è un cambiamento più grande di quanto la misura
giustifichi.

**Prima di eseguire** va sciolto un dubbio d'uso che **non** è nella misura: il
giocatore apre `ObjectsBoard` dal dossier o dalla mappa? Se la risposta è «dalla
mappa», la C diventa più forte; se è «dal dossier», B è quasi obbligata. È una domanda
da misurare su una partita vera (telemetria o osservazione), non da dedurre.

---

## Appendice — misure riproducibili

- `ObjectsBoard.tsx` 331 righe, `UnitActionPanel.tsx` 278 righe (conteggio).
- Azioni: `backend-nest/src/core/simulation/OperationalObjects.ts:102-108` (tipo),
  `OperationalState.ts:1928-2020` (costruzione).
- Montaggi: `ObjectsBoard` **solo** in `NationDock.tsx:942`; `UnitActionPanel` in
  `ObjectsBoard` e in `ProvinceInspector.tsx:436,541`.
- `ActionsPanel.tsx` (modulo Ordini): nessuna prop militare, nessun riferimento a
  reparti/armate/formazioni.

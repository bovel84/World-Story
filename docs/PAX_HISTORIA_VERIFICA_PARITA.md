# Verifica comparativa — Pax Historia

**Stato:** parziale, osservazionale; non certifica equivalenza.

- **Data/ora:** 2026-09-07, 12:16–14:27 CEST
- **Riferimento:** `https://www.paxhistoria.co`, UI italiana, pagina del preset ufficiale *Modern Day* (versione 62)
- **Partita isolata:** nuova partita di prova, Italia, turno 1 (nessun salvataggio preesistente modificato)
- **Modello:** Light
- **Credito visibile:** $5.826 iniziale; $5.819 finale (costo osservato: $0.003 per dettaglio brainstorming, $0.004 per «Evento successivo»)
- **Evidenze:** `docs/ref/pax-verifica-2026-09-07/`

> La prima visita a `/games` mostrava «Some services are down» e nessuna partita; dopo il normale accesso OAuth la partita di prova e il motore hanno funzionato. Non sono stati aggirati login, protezioni o reCAPTCHA.

## Tabella: azione utente → variazione osservata

| # §16 | Azione sul riferimento | Variazione osservata | Stato / confronto Open-Pax |
|---|---|---|---|
| 1 | Alla data 1 gennaio 2026 ho inviato tre azioni. Ho modificato la prima tramite testo cliccabile → «Salva»/«Annulla»; ho eliminato la terza con il pulsante cestino, poi ho aggiunto una terza proposta IA. | La coda ha mostrato subito le righe; modifica ed eliminazione non hanno cambiato data né saldo. | **Verificato:** stessa separazione richiesta da G04. `02-coda-modifica-rimozione.png`. |
| 2 | «Aiuta a pensare a delle azioni» ha mostrato temi; aprendo «Crisi Energetica Nordafricana» ha prodotto analisi e risposte potenziali. Ho scelto «Intervento in Tripolitania». | Il brainstorming iniziale non ha mutato coda/data/saldo; il dettaglio ha ridotto il saldo di $0.003. La scelta ha aggiunto una riga con badge «Suggerimento IA», senza simulare né cambiare data. | **Verificato in parte:** corrisponde al principio Open-Pax Enhance/accettazione esplicita (G24), ma non è stato testato il comando Enhance testuale separato. |
| 3 | Con tre azioni presenti ho aperto il salto e scelto «Passa al prossimo evento importante». | Il lettore ha mostrato il primo evento il 2 gennaio e ha mantenuto il controllo esplicito della cadenza. | **Verificato:** batch e arresto leggibile; non dichiarare equivalenza sulla semantica interna degli ordini. |
| 4, 6 | Nel lettore ho selezionato «Evento successivo». | È stato materializzato il secondo evento il 3 gennaio; saldo -$0.004; restano «Evento successivo» e «Intervieni». | **Verificato:** Pax usa playback manuale evento-per-evento, non autoplay. Open-Pax §9.3/G22 segue questa cadenza per i salti fissi. `04-playback-secondo-evento.png`. |
| 7 | Ho scelto «Intervieni», quindi confermato «Sì, Intervieni». | È comparsa una conferma: «Lo stato attuale verrà salvato». Poi «Procedi 1/3/2026»; dopo il click, turno 2/data 3 gennaio 2026, saldo invariato. | **Verificato:** stop esplicito al checkpoint letto. Open-Pax usa l'ancora più rigorosa `simulationId + eventId + revision`; Pax espone una conferma UI. `05-conferma-intervene.png`. |
| — | Dopo Intervene ho riaperto Azioni al turno 2. | La lista «Le tue azioni» era vuota: anche la terza proposta selezionata, non vista come evento nel lettore, non era esposta in coda. | **Osservazione da approfondire:** non basta per dedurre se Pax l'abbia scartata, assorbita nel batch o archiviata altrove. Open-Pax non deve cambiare il proprio comportamento senza altra prova. `06-coda-dopo-intervene.png`. |
| 5 | Aperto «Passa Avanti / Vai Avanti». | Disponibili «Passa al prossimo evento importante», 1 settimana, 1/3/6 mesi, 1 anno e «Personalizzato / Scegli data»; dal 1/1/2026 i target visibili erano rispettivamente 8/1, 1/2, 1/4, 1/7, 1/1/2027. | **Verificato UI:** calendario per preset e campo personalizzato presenti. Non è stata inviata una simulazione mensile/annuale. `03-controlli-salto.png`. |

## Comportamenti confermati

1. Gli ordini sono raccolti alla stessa data prima del salto; modifica/rimozione non avanzano il tempo.
2. Brainstorm e risposta potenziale sono distinti dall'avanzamento del mondo; l'accettazione aggiunge un ordine e non un evento.
3. Il salto automatico si ferma al primo evento e offre avanzamento manuale di un evento alla volta.
4. Intervene richiede conferma, conserva gli eventi mostrati e porta la partita al checkpoint dell'ultimo evento letto.
5. I controlli del salto espongono next-event, preset calendariali e data personalizzata.

## Ancora da verificare

La campagna non ha coperto, per limitare il consumo di crediti:

- auto-jump senza ordini e periodi senza novità/errori/limiti di generazione;
- salto esplicito mensile/annuale e data personalizzata fino alla chiusura;
- Save durante il salto, Load e Rewind con ordini/chat del ramo annullato;
- diplomazia, accordi e loro riflesso nel salto;
- dettaglio preciso del destino del terzo ordine non letto dopo Intervene;
- comportamento in caso di Intervene durante la generazione anziché nel lettore;
- identificatori/versione del backend di Pax e test di riconnessione.

## Implicazione per Open-Pax

Questa prova conferma il valore della scelta già implementata §9.3/G22: lettore separato, checkpoint per-evento e decisione manuale. La differenza osservata è che Open-Pax rende l'ancora del controllo verificabile nel contratto API (`eventId`/`revision`), mentre Pax la espone come stato UI e conferma. Nessuna funzione viene promossa a «equivalente» soltanto da questa prova parziale.

## Adeguamenti grafici Open-Pax successivi alla verifica

Realizzati senza alterare il contratto di simulazione, per rendere leggibili i controlli osservati nel riferimento:

1. **Shell operativa:** HUD navy/indaco compatto, data come controllo principale e dock inferiore a icone per Azioni, Diplomazia e Consulente.
2. **Azioni:** superficie di comando laterale con gerarchia visiva per Brainstorm, proposte selezionabili, coda modificabile/rimovibile e compositore libero/Enhance; inviare un ordine resta distinto dal salto.
3. **Timeline:** sheet scuro per next-event, preset di calendario e selezione diretta della data personalizzata. La data viene convertita localmente in giorni prima della chiamata API compatibile.
4. **Playback:** `SimulationEventReader` è un foglio modale con la sequenza dei soli checkpoint già autorizzati, stato del checkpoint corrente e CTA «Evento successivo»/«Intervieni». Non riceve né visualizza proposte future.

Build frontend superata dopo il pacchetto. Questi interventi migliorano la parità percepita; non trasformano le verifiche §16 ancora mancanti in equivalenze certificate.

## Stato del rilascio

**Deploy Open-Pax: eseguito il 7/9/2026.** Worker `open-pax`, versione iniziale `73aad6d7-310c-453b-804c-90f4aa791821`, aggiornata con hotfix grafico alla `906efd11-c982-44c4-bd4e-c23eed7ad3fe`, con riconciliazione del lettore sospeso alla `bad2584c-3900-42eb-9268-e0931653901a` e con il pass di leggibilità UI alla `2550efa1-2509-4f7c-8149-05cccc3c5331` e con Dispacci nella HUD/chat diplomatiche migliorate alla `c63bd1b7-7b74-425d-a7d6-965db214b0e7` con la coda di notizie centrali alla `177936c0-ee42-447a-8c1e-9bfa903262a5` e con il dettaglio archivio centrato alla `e9d1add3-b1a1-4709-b6ad-66c56a0f2924`; backend compilato/riavviato dopo backup SQLite coerente. Smoke pubblico riuscito: health, proxy templates e asset della build corrente. Restano da svolgere gli E2E pubblici completi §17 prima della certificazione del rilascio.

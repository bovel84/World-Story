# Eventi con iniziativa e spazio per il giocatore

Il percorso compatto (usato anche da GLM Flash) non riceveva pressioni di pace,
crisi, voci interne e impegni. Il budget di un salto fisso poteva essere esaurito
dai soli esiti degli ordini. Inoltre, senza ordini, il prompt auto-jump chiedeva
comunque una risposta NPC a un ordine per poter produrre il prossimo evento.

La modifica:

- porta le fonti mancanti nel compatto e negli override del preset, con un limite
  indipendente per fonte (massimo 2.800 caratteri di contenuto);
- conserva nel compatto anche il vincolo degli ordini privi di copertura;
- concede uno spazio aggiuntivo per sviluppi brevi, due nei periodi di almeno
  21 giorni, entro il tetto esistente di 30 eventi (12 nel prompt compatto);
- chiarisce che la causa è documentata ma il suo sviluppo può essere nuovo:
  richieste, controproposte, interessi contrapposti e opportunità plausibili;
- lascia nella descrizione la posta in gioco e l'eventuale questione aperta,
  senza scegliere nuove politiche o spese per il giocatore;
- ferma l'auto-jump senza ordini sul primo evento canonico, anche interno;
  con ordini conserva l'attesa della decisione NPC;
- apre il governo dopo un intervento confermato sul dispaccio corrente.

Usa la stessa chiamata del turno. `worldPulse` resta opzionale e spento di default.
Non cambia schema degli eventi, salvataggi, EffectValidator o ReactionDecisions.
Il budget è un massimo: l'assenza di cause può ancora produrre zero eventi.

Verifiche automatiche con provider simulato: fonti in tutti i percorsi, assenza
di chiamate aggiuntive, budget, streaming, arresto senza effetti futuri,
contratti delle reazioni e modalità strict; compilazione di backend e frontend.
Questi controlli verificano il collegamento e le regressioni, non dimostrano la
qualità letteraria delle risposte di un modello reale.

Prova in partita: avanzare senza ordini in una nazione con una pressione aperta,
leggere lo sviluppo e intervenire. Poi verificare che un ordine abbia il suo
esito e che una questione rinviata prosegua senza essere semplicemente ripetuta.
Non sono state eseguite chiamate a pagamento per questa modifica.

/**
 * Lunghezza del corpo di un dispaccio, in **un solo posto**.
 * ==========================================================
 * Prima questo numero viveva in tre punti e in tre misure diverse — «due brevi
 * paragrafi» qui, «90-140 parole» nella riga seguente, «4-6 frasi» in
 * `simulation/prompt.ts:228` — e il modello non poteva obbedire a tutte.
 *
 * La misura scelta è **una**: antefatto e sviluppo in **due frasi brevi**.
 * Non è la sintesi estrema del riferimento (15-25 parole): il nostro dispaccio
 * deve restare comprensibile **senza aver letto i precedenti** (regola già
 * scritta sotto), quindi gli serve l'antefatto. Ma non è più il paragrafo da
 * 140 parole: due frasi, ognuna con un fatto.
 *
 * Se questo numero cambia, cambia qui: `simulation/prompt.ts` lo importa.
 */
export const EVENT_BODY_WORDS = 'due frasi brevi, 35-60 parole in tutto';

export const EVENT_DESCRIPTION_GUIDE = `Antefatto in una frase e sviluppo in una seconda: chi agisce, dove, e che cosa cambia rispetto a prima. ${EVENT_BODY_WORDS}`;

/** Shared by full, preset and compact simulation paths; no extra model call. */
export function buildImmersionContract(): string {
  return `
[CONTINUITÀ E IMMERSIONE]
- Ogni notizia deve aggiungere un cambiamento rispetto alla cronaca, non ripetere l'ordine o rinominare un evento già raccontato. Riprendi un impegno, una scelta o un problema documentato e mostra che cosa cambia adesso.
- Titolo concreto: **soggetto + svolta**, al massimo 12 parole, senza cifre di bilancio e senza formule vuote («Tensioni crescono», «Nuova crisi», «Bollettino», «Evento»). La description deve essere comprensibile anche senza aver letto i dispacci precedenti: ${EVENT_DESCRIPTION_GUIDE}.
- Prima frase: la situazione del preset o il fatto precedente che ha portato fin qui, dove accade, chi è coinvolto e quale interesse concreto è in gioco. Seconda frase: la novità e che cosa cambia rispetto a prima. Un elenco di reazioni NON sostituisce questo contesto.
- Resta nello stesso campo description; non emettere un ulteriore evento per raccontare l'antefatto. Varia il ritmo; evita aperture seriali come «In seguito all'ordine».
- Se una fonte non documenta l'antefatto, appoggiati alla situazione attuale verificabile e rendi esplicita la lacuna solo se rilevante. Non inventare un passato per raggiungere la lunghezza indicata.
- Fai percepire la posta in gioco attraverso un effetto materiale attestato: accesso a un porto, consegna di materiali, occupazione, collegamenti, sicurezza o rapporti diplomatici. Non inventare testimonianze, citazioni, nomi di funzionari, cifre o scene di folla per creare atmosfera. Se mancano nomi, usa il ruolo istituzionale.
- Un rischio resta un rischio e una previsione resta una previsione: non trasformarli in fatti compiuti. Non imporre un colpo di scena o un dilemma quando il periodo non li giustifica.

[CANTIERI E CAPACITÀ MATERIALI]
- Distingui autorizzazione, apertura del cantiere, lavori, collaudo e operatività. Valuta risorse, forniture, accessi, manodopera e tempo soltanto dalle fonti disponibili; non inventare costi, percentuali o disponibilità.
- Un ordine già avviato può proseguire senza un nuovo ordine; nuove finalità, nuove spese non autorizzate o ampliamenti richiedono una decisione. La scadenza prevista non prova il completamento.
- start_construction apre un cantiere soltanto con lavori attestati. Per una fase successiva usa update_construction sulla provincia e sul nome/ID ESATTI del cantiere esistente, mai un secondo cantiere.
- feature.type resta il tipo finale dell'opera. In feature.metadata usa soltanto dati documentati: phase (preparation|foundations|structure|installation|testing), status (under_construction|paused), nextStep (prossimo lavoro concreto), blocker (impedimento concreto; stringa vuota se risolto), expectedDate (YYYY-MM-DD stimabile; null se non più stimabile). Ometti ciò che non sai.
- Un impedimento deve spiegare perché i lavori rallentano e quale condizione consente di riprenderli; non inventare un ostacolo ad ogni aggiornamento. Non emettere un evento per il solo trascorrere dei giorni.
- complete_construction significa opera collaudata e utilizzabile, non semplice fine del periodo. accepted indica l'esecuzione di quanto ordinato, non il completamento anticipato dell'obiettivo; usa partial per un obiettivo ancora in lavorazione e collega il processo esistente senza duplicarlo.
`;
}

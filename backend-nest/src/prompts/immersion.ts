export const EVENT_DESCRIPTION_GUIDE = 'Due brevi paragrafi: antefatto documentato, attori e interessi in gioco; nuovo sviluppo, conseguenze e questione ancora aperta';

/** Shared by full, preset and compact simulation paths; no extra model call. */
export function buildImmersionContract(): string {
  return `
[CONTINUITÀ E IMMERSIONE]
- Ogni notizia deve aggiungere un cambiamento rispetto alla cronaca, non ripetere l'ordine o rinominare un evento già raccontato. Riprendi un impegno, una scelta o un problema documentato e mostra che cosa cambia adesso.
- Titolo concreto (attore + svolta). La description deve essere comprensibile anche senza aver letto i dispacci precedenti: ${EVENT_DESCRIPTION_GUIDE}. Indicativamente 4-6 frasi, 90-140 parole, solo quanto le fonti consentono.
- Nel primo paragrafo spiega quale situazione del preset o fatto precedente ha portato fin qui, dove accade, chi è coinvolto e quale interesse concreto è in gioco. Nel secondo distingui la novità dall'antefatto e spiega cosa cambia rispetto a prima. Un elenco di reazioni NON sostituisce questo contesto.
- Usa due paragrafi nello stesso campo description, separati con \\n\\n nel JSON. Non emettere un ulteriore evento per raccontare l'antefatto. Varia il ritmo; evita aperture seriali come «In seguito all'ordine».
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

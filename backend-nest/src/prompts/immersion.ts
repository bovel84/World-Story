/**
 * Lunghezza del corpo di un dispaccio, in **un solo posto**.
 * ==========================================================
 * Prima questo numero viveva in tre punti e in tre misure diverse — «due brevi
 * paragrafi» qui, «90-140 parole» nella riga seguente, «4-6 frasi» in
 * `simulation/prompt.ts:228` — e il modello non poteva obbedire a tutte.
 *
 * La misura scelta è **una**: svolta, causa, conseguenza essenziale.
 * Come nel dispaccio breve del riferimento, il lettore deve capire subito
 * chi agisce e cosa cambia. Il contesto esteso resta nella memoria del mondo,
 * non nel corpo dell'articolo. Le istruzioni valgono per ogni percorso LLM.
 *
 * Se questo numero cambia, cambia qui: `simulation/prompt.ts` lo importa.
 */
export const EVENT_BODY_WORDS = 'una o due frasi, 20-35 parole in tutto, massimo 240 caratteri (spazi inclusi)';
export const EVENT_HEADLINE_GUIDE = 'soggetto + svolta concreta, massimo 9 parole e 85 caratteri';

export const EVENT_DESCRIPTION_GUIDE = `Dispaccio immediato: chi ha deciso cosa e dove; aggiungi solo la causa o la conseguenza essenziale, senza introduzioni o ripetizioni. ${EVENT_BODY_WORDS}. Usa il nome esatto del luogo presente nella mappa, senza inventare coordinate`;

/** Shared by full, preset and compact simulation paths; no extra model call. */
export function buildImmersionContract(): string {
  return `
[CONTINUITÀ E IMMERSIONE]
- Ogni notizia deve aggiungere un cambiamento rispetto alla cronaca, non ripetere l'ordine o rinominare un evento già raccontato. Riprendi un impegno, una scelta o un problema documentato e mostra che cosa cambia adesso.
- Titolo concreto: **${EVENT_HEADLINE_GUIDE}**, senza cifre di bilancio e senza formule vuote («Tensioni crescono», «Nuova crisi», «Bollettino», «Evento»). La description deve essere comprensibile anche senza aver letto i dispacci precedenti: ${EVENT_DESCRIPTION_GUIDE}.
- Prima frase: la decisione nuova, il protagonista e il luogo principale (se documentato); seconda frase solo se indispensabile: causa oppure effetto immediato. Niente riepiloghi iniziali, cronologie lunghe o commento finale. Non iniziare con un riepilogo della situazione. Per un fatto nazionale indica la nazione; non assegnare una città a un evento globale senza una sede documentata.
- La causa viene dal preset, dalla cronaca o dallo stato; lo sviluppo è ciò che stai SIMULANDO. Non ridurre ogni iniziativa a «valuta», «monitora», «tensioni crescono». Se tempi e capacità lo consentono, racconta l'esito concreto e applica gli effetti materiali tramite il contratto esistente; se non lo consentono, specifica il vero impedimento.
- Alterna gli sviluppi giustificati dal periodo: politica interna, accordi, economia, conflitti, società, scienza o emergenze già sostenute dal contesto. Anche paesi lontani possono agire: non legare artificialmente ogni notizia al giocatore e non fabbricare eventi per coprire categorie.
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

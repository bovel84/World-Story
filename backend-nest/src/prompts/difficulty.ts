/**
 * World Story — Livelli di difficoltà
 * ================================
 * 5 livelli, realizzati come blocchi testuali nei prompt (come nell'originale).
 * I testi sono nostri (la wiki dell'originale non è raggiungibile dall'ambiente
 * di sviluppo).
 */

export type Difficulty = 'story' | 'easy' | 'normal' | 'hard' | 'very_hard';

export const ALL_DIFFICULTIES: Difficulty[] = ['story', 'easy', 'normal', 'hard', 'very_hard'];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  story: 'Storia (facilissimo)',
  easy: 'Facile',
  normal: 'Normale',
  hard: 'Difficile',
  very_hard: 'Difficilissimo',
};

const DIFFICULTY_PROMPTS: Record<Difficulty, string> = {
  story: `[Difficoltà: Storia]
Questa è la modalità narrativa. Il mondo si adatta con delicatezza ai disegni del giocatore:
- Le azioni del giocatore riescono quasi sempre, anche le più ambiziose — trova
  semplicemente una spiegazione plausibile del successo.
- Le altre potenze si comportano in modo benevolo e ostacolano raramente il
  giocatore in modo diretto.
- Le crisi sono rare e si risolvono rapidamente a favore del giocatore.
- Le guerre contro il giocatore scoppiano solo se le ha iniziate lui stesso.`,

  easy: `[Difficoltà: Facile]
La partita è benevola verso il giocatore:
- Le azioni del giocatore hanno quasi sempre successo; i fallimenti arrivano
  solo in caso di avventatezza evidente.
- Le altre potenze preferiscono il commercio e le alleanze con il giocatore
  alla confrontation.
- L'economia del giocatore cresce più in fretta e le conseguenze degli errori
  sono attenuate.
- I nemici del giocatore agiscono con esitazione.`,

  normal: `[Difficoltà: Normale]
Simulazione realistica:
- Il successo delle azioni del giocatore dipende da risorse, geografia e
  situazione internazionale.
- Le altre potenze inseguono i propri interessi: stringono alleanze,
  competono, sfruttano le debolezze del giocatore.
- Ogni decisione ha un costo e delle conseguenze.
- Guerre, crisi e complicazioni diplomatiche sono una parte normale del gioco.`,

  hard: `[Difficoltà: Difficile]
Il mondo è ostile e competitivo:
- Le azioni del giocatore incontrano spesso resistenza: sanzioni, coalizioni,
  piani stravolti.
- Le altre poteri si alleano attivamente contro la crescita di influenza del
  giocatore.
- Gli errori costano caro: i passi falsi economici e militari hanno
  conseguenze lunghe.
- Gli alleati del giocatore sono inaffidabili e possono rivedere le proprie
  posizioni.`,

  very_hard: `[Difficoltà: Difficilissimo]
Simulazione spietata della politica delle grandi potenze:
- Il mondo vede nel giocatore una minaccia: l'equilibrio di potenza è quasi
  sempre contro di lui.
- La maggior parte delle azioni ambiziose si conclude con un fallimento o con
  una vittoria pirrica — simulalo con onestà, senza sconti.
- Le altre potenze agiscono in modo coordinato, subdolo e con capacità di
  anticipazione.
- Crisi economiche, tradimenti degli alleati e problemi interni sono prove
  ricorrenti per il giocatore.`,
};

export function normalizeDifficulty(raw: unknown): Difficulty {
  return ALL_DIFFICULTIES.includes(raw as Difficulty) ? (raw as Difficulty) : 'normal';
}

/** Blocco testuale della difficoltà per il prompt del salto (DIFFICULTY_DESCRIPTION_JUMP_FORWARD). */
export function difficultyPromptBlock(difficulty: Difficulty): string {
  return DIFFICULTY_PROMPTS[difficulty];
}
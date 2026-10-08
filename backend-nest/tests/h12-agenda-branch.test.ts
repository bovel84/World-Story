/**
 * H12 — L'agenda dei filoni è **per ramo**.
 *
 * Difende il difetto trovato misurando il database reale: `head_branch_id` è un
 * **UUID** (il ramo si *chiama* `main`, ma il suo id no). L'agenda scriveva e
 * leggeva col letterale `'main'` — una chiave parallela, non il ramo della
 * partita. Conseguenza: dopo un **fork** il ramo nuovo condivideva la strategia
 * del ramo di partenza, e il **rewind** potava una riga che non era la sua.
 *
 * Qui si prova il livello puro (NpcAgenda), perché la scrittura su SQLite non
 * gira in questa VM (binario macOS). Il cablaggio del ramo nel servizio si
 * verifica leggendo il codice, come gli altri test-contratto del progetto.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { seedStorylineObjective, storylineObjectiveId } from '../src/core/simulation/NpcAgenda';
import { seedFromStoryline } from '../src/game/StorylineSeeding';
import type { Storyline } from '../src/scenario/storylines';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const filone: Storyline = {
  id: 'levante-disarmo-hamas', title: 'Il disarmo di Hamas', domain: 'esteri',
  parties: ['ISR'], region: 'Levante', state: 'aperto', pressure: 3,
  summary: 'Israele e gli USA premono per il disarmo.', triggers: ['attentato'],
};

describe('H12 — il servizio dell’agenda legge e scrive sul ramo della partita', () => {
  const service = read('src/game/NpcAgendaService.ts');

  it('il contesto espone il ramo (non un `main` fisso)', () => {
    expect(service).toContain('branchId?(): string | null');
    expect(service).toContain('private branchId(): string');
  });

  it('ogni lettura e scrittura passa il ramo', () => {
    // Le cinque chiamate al repository: list ×2, appendMany ×2, pruneAfterTurn ×1.
    const calls = service.match(/npcAgendaRepository\.(list|appendMany|pruneAfterTurn)\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5); // guardia contro il falso verde
    for (const call of calls) {
      expect(call, `manca il ramo in: ${call}`).toContain('branchId: this.branchId()');
    }
  });

  it('game-session cabla il ramo dal fenceContext (l’id reale, non il nome)', () => {
    const session = read('src/game-session.ts');
    expect(session).toContain('branchId: () => this.fenceContext().branchId');
  });
});

describe('H12 — l’obiettivo del filone è stabile e indipendente dal ramo nel suo id', () => {
  it('l’id dell’obiettivo non contiene il ramo: è `polity:storyline:id`', () => {
    const seed = seedFromStoryline(filone, 'ISR', false);
    const objective = seedStorylineObjective(seed, null, { date: '2000-01-01', turn: 1 });
    expect(objective.id).toBe(storylineObjectiveId('ISR', 'levante-disarmo-hamas'));
    // Il ramo è una dimensione del **database**, non dell'id: così lo stesso
    // filone vive in rami diversi senza collisioni.
    expect(objective.id).toContain('storyline');
    expect(objective.id.split(':')).toHaveLength(3);
  });

  it('riseminare sullo stesso ramo conserva nascita e progresso (idempotenza)', () => {
    const seed = seedFromStoryline(filone, 'ISR', false);
    const born = seedStorylineObjective(seed, null, { date: '2000-01-01', turn: 1 });
    const grown = { ...born, progress: 70, createdTurn: 1 };
    const again = seedStorylineObjective(seed, grown, { date: '2000-06-01', turn: 8 });
    expect(again.createdDate).toBe('2000-01-01');
    expect(again.createdTurn).toBe(1);
    expect(again.progress).toBe(70);
  });
});

describe('H12 — la situazione e la baseline sono condivise fra rami (per design)', () => {
  const db = read('src/database.ts');

  it('la tabella della situazione NON ha una colonna di ramo', () => {
    const start = db.indexOf('CREATE TABLE IF NOT EXISTS game_polity_nation_situations');
    const body = db.slice(start, db.indexOf(')`', start));
    expect(body).not.toContain('branch_id');
    // Descrive l'inizio della partita: è la stessa in ogni ramo che ne deriva.
    expect(body).toContain("PRIMARY KEY (game_id, polity_id, start_date)");
  });

  it('la baseline storica è dichiarata condivisa fra rami', () => {
    expect(db).toContain('shared across branches');
  });
});

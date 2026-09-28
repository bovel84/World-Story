/**
 * MG03 µ2 — L'opera finita esiste sulla mappa
 * ===========================================
 * Un cantiere che avanza e non produce nulla è metà del lavoro. Qui si difende
 * la consegna: dal collaudo all'oggetto sulla mappa, con l'effetto dichiarato.
 *
 * Guardia contro il falso verde: si verifica che l'oggetto **non** sia un
 * cantiere, che porti il progetto (il legame con la decisione) e che la data sia
 * quella del COLLAUDO. Un test che si accontentasse di «esiste un oggetto»
 * passerebbe anche con un `construction_site` non finito.
 */
import { describe, expect, it } from 'vitest';
import path from 'path';
import { loadSimulationCatalog } from '../src/scenario/loader';
import { deliveredWorkFor, alreadyDelivered } from '../src/game/WorkDelivery';

const FIXTURE_DIR = path.join(process.cwd(), 'data', 'presets', 'realism_test_world');
const catalog = () => loadSimulationCatalog(FIXTURE_DIR).catalog!;
const road = () => catalog().works.find(w => w.id === 'w_road')!;

const center = { lat: 45.5, lng: 9.2 };
const deliver = (overrides: Record<string, unknown> = {}) => deliveredWorkFor({
  work: road(), regionId: 'ALPHA-nord', regionOwner: 'ALPHA', center,
  completedDate: '1951-03-01', projectId: 'prj_abc', ...overrides,
});

describe('MG03 µ2 — l’opera collaudata diventa un oggetto sulla mappa', () => {
  it('l’oggetto è l’OPERA, non un cantiere', () => {
    const delivered = deliver();
    // Il tipo è quello dichiarato dalla distinta: `ft_road`, non `construction_site`.
    expect(delivered.type).toBe('ft_road');
    expect(delivered.type).not.toBe('construction_site');
    expect(delivered.metadata.status).toBe('operational');
    expect(delivered.metadata.phase).toBe('completed');
    // E non resta un `plannedType`: non c'è più nulla da pianificare.
    expect(delivered.metadata.plannedType).toBeUndefined();
  });

  it('porta il progetto e la data del collaudo, non quella prevista', () => {
    const delivered = deliver({ completedDate: '1951-04-15' });
    expect(delivered.metadata.projectId).toBe('prj_abc');
    expect(delivered.metadata.completedDate).toBe('1951-04-15');
    // La data prevista non esiste in questo oggetto: era il difetto legacy.
    expect(delivered.metadata.expectedDate).toBeUndefined();
  });

  it('porta l’effetto dichiarato dalla distinta, non una promessa vuota', () => {
    const delivered = deliver();
    expect(delivered.metadata.effect).toEqual({ kind: 'transport', unit: 'km', perDay: '40' });
    // La manutenzione dichiarata, per chi la applicherà.
    expect(delivered.metadata.maintenance).toMatchObject({ resourceId: 'tools', baseUnits: '1', periodDays: 60 });
    // E la provenienza: la distinta è `authored`, e l'oggetto lo dichiara.
    expect((delivered.metadata.evidence as any).quality).toBe('authored');
  });

  it('l’opera sta dove è stata ordinata', () => {
    const delivered = deliver();
    expect(delivered.lat).toBe(center.lat);
    expect(delivered.lng).toBe(center.lng);
    expect(delivered.owner).toBe('ALPHA');
    expect(delivered.metadata.regionId).toBe('ALPHA-nord');
  });

  it('lo stesso progetto non consegna due volte', () => {
    const objects = [{ metadata: { projectId: 'prj_abc' } }];
    expect(alreadyDelivered(objects, 'prj_abc')).toBe(true);
    expect(alreadyDelivered(objects, 'prj_altro')).toBe(false);
    // Una regione vuota non ha consegnato nulla.
    expect(alreadyDelivered([], 'prj_abc')).toBe(false);
    // E un oggetto senza metadati non fa esplodere il controllo.
    expect(alreadyDelivered([{}], 'prj_abc')).toBe(false);
  });

  it('due opere diverse possono avere lo stesso nome', () => {
    // Il controllo è per progetto, non per nome: due strade omonime in regioni
    // diverse sono due opere, e un nome ripetuto non deve bloccare la seconda.
    const prima = deliver({ projectId: 'prj_1', regionId: 'ALPHA-nord' });
    const seconda = deliver({ projectId: 'prj_2', regionId: 'ALPHA-sud' });
    expect(prima.name).toBe(seconda.name);
    expect(prima.metadata.projectId).not.toBe(seconda.metadata.projectId);
    expect(alreadyDelivered([prima], 'prj_2')).toBe(false);
  });

  it('due consegne hanno id diversi', () => {
    expect(deliver().id).not.toBe(deliver().id);
  });
});

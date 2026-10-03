import type { ProposalActDraft } from './actDraft';
import { meetingReadFromFeasibility, type MeetingFeasibilityInput } from './meetingEngineRead';
import type { CanonicalRegionRef } from './meetingLocalization';

/** Only the exact draft's engine preview may supply execution actors/materials.
 * A missing/ambiguous canonical location is not permission to build elsewhere. */
export function resolveCouncilExecution(draft: ProposalActDraft, feasibility: MeetingFeasibilityInput,
  regions: readonly CanonicalRegionRef[], currentRegion: CanonicalRegionRef | null = null): ProposalActDraft {
  if (!feasibility.workDeclaration) return draft;
  const read = meetingReadFromFeasibility({ subject: draft.text }, feasibility, regions, currentRegion);
  const declaration = feasibility.workDeclaration;
  const ready = feasibility.feasible && declaration.funded && declaration.materialActorId && declaration.missingMaterials.length === 0
    && read.location?.status === 'resolved' && read.regionId;
  if (!ready) return { ...draft, capability: 'unsupported', work: undefined,
    note: read.location?.status !== 'resolved' ? 'Indica una sola regione canonica nel testo dell’atto, poi aggiorna la verifica del motore.'
      : 'Il motore non conferma copertura e materiali dell’opera. Risolvi i requisiti prima di firmare.' };
  return { ...draft, capability: 'engine-order', note: 'Distinta e luogo verificati dal motore. La firma conserva la dichiarazione d’opera; il cantiere viene aperto all’esecuzione.',
    work: { workId: declaration.workId, payerActorId: declaration.payerActorId, materialActorId: declaration.materialActorId!, funded: declaration.funded, regionId: read.regionId! } };
}

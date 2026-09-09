/** M06 µ5c-2 — tick strict, staging server-side e nessuna mutazione legacy. */
import { settleDueCashflows } from '../../services/FinanceService';
import { consumeStagedLedgerEffect,consumeStagedShipmentEffect,promoteStagedEffectAnchors } from '../../repositories/strict-effect-staging.repository';
import { consumeStagedProjectTick } from '../../repositories/project-runtime.repository';
import { applyDueCanonicalEffects } from '../../services/StrictEffectProducerService';
import { StrictEffect } from './EffectValidator';

export interface StrictTickResult { readonly settledCashflows:readonly { readonly cashflowId:string;readonly paid:string;readonly status:string }[]; }
/** Tutti i kind strict ammessi hanno ora un adapter server-staged. */
export function assertExecutableStrictEffects(_effects:readonly StrictEffect[]):void{}
/** Mantiene validi durante il playback solo gli ID materiali già staged. */
export function promotePlaybackEffectAnchors(gameId:string,branchId:string,fromRevision:number,toRevision:number,effects:readonly StrictEffect[]):number{return promoteStagedEffectAnchors(gameId,branchId,fromRevision,toRevision,effects.filter(effect=>effect.kind!=='qualitative').map(effect=>effect.effectId));}
/** Payload materiali dal DB staged, mai dalla proposta LLM. */
export function applyStagedStrictEffects(gameId:string,branchId:string,anchorRevision:number,effects:readonly StrictEffect[]):void{for(const effect of effects){if(effect.kind==='ledger')consumeStagedLedgerEffect(gameId,branchId,anchorRevision,effect.effectId);if(effect.kind==='shipment')consumeStagedShipmentEffect(gameId,branchId,anchorRevision,effect.effectId);if(effect.kind==='project_tick')consumeStagedProjectTick(gameId,branchId,anchorRevision,effect.effectId);}}
/** Applica soltanto conseguenze già canoniche e datate. */
export function runStrictTick(gameId:string,branchId:string,anchorRevision:number,asOfDate:string):StrictTickResult{applyDueCanonicalEffects(gameId,branchId,anchorRevision,asOfDate);return{settledCashflows:settleDueCashflows(gameId,branchId,asOfDate)};}

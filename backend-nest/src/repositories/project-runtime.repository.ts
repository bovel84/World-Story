/** M06 µ5c-2 — stato progetto persistito e tick server-staged. */
import db,{withCanonicalTransaction} from '../database';import {IntString} from '../domain/quantities';import {advancePhaseDay,ProjectPlan,ProjectState,validateProjectPlan} from '../core/projects/ProjectEngine';import {assertCanonicalEffectAnchor,StrictEffectStagingError} from './strict-effect-staging.repository';
type ProjectRow={game_id:string;branch_id:string;project_id:string;plan_json:string;state_json:string;version:number};type StageRow={game_id:string;branch_id:string;anchor_revision:number;effect_id:string;kind:string;payload_json:string;status:string};type TickPayload={projectId:string;version:number;nextState:ProjectState};
function parse<T>(json:string,label:string):T{try{return JSON.parse(json) as T;}catch{throw new StrictEffectStagingError('BAD_PROJECT_PAYLOAD',`${label} JSON non valido`);}}
function runtime(branchId:string,projectId:string):ProjectRow{const row=db.prepare('SELECT * FROM project_runtime_states WHERE branch_id=? AND project_id=?').get(branchId,projectId) as ProjectRow|undefined;if(!row)throw new StrictEffectStagingError('MISSING_PROJECT_RUNTIME','progetto runtime non trovato');return row;}
export function createProjectRuntime(gameId:string,branchId:string,plan:ProjectPlan,state:ProjectState):boolean{validateProjectPlan(plan);if(plan.id!==state.id)throw new StrictEffectStagingError('BAD_PROJECT_RUNTIME','plan/state projectId divergenti');return withCanonicalTransaction(()=>{const old=db.prepare('SELECT state_json,plan_json FROM project_runtime_states WHERE branch_id=? AND project_id=?').get(branchId,plan.id) as {state_json:string;plan_json:string}|undefined;const p=JSON.stringify(plan),s=JSON.stringify(state);if(old){if(old.plan_json!==p||old.state_json!==s)throw new StrictEffectStagingError('PROJECT_RUNTIME_CONFLICT','runtime progetto già presente con stato diverso');return false;}db.prepare('INSERT INTO project_runtime_states (game_id,branch_id,project_id,plan_json,state_json) VALUES (?,?,?,?,?)').run(gameId,branchId,plan.id,p,s);return true;});}

/** MG03 — il contesto operativo di un progetto: chi paga, chi ha i materiali,
 *  dove sorge l'opera. Scritto al commit, riletto dall'avanzamento. */
export interface ProjectContext {
  readonly payerActorId:string;
  readonly materialActorId:string;
  readonly regionId:string;
}

/** Scrive il contesto di un progetto già creato. Idempotente: stesso contenuto
 *  è un no-op, contenuto diverso è un conflitto (mai una sovrascrittura muta). */
export function setProjectContext(gameId:string,branchId:string,projectId:string,context:ProjectContext):boolean{
  return withCanonicalTransaction(()=>{
    const row=db.prepare('SELECT game_id,context_json FROM project_runtime_states WHERE branch_id=? AND project_id=?').get(branchId,projectId) as {game_id:string;context_json:string|null}|undefined;
    if(!row||row.game_id!==gameId)throw new StrictEffectStagingError('MISSING_PROJECT_RUNTIME','progetto runtime non trovato');
    const json=JSON.stringify(context);
    if(row.context_json===json)return false;
    if(row.context_json!==null)throw new StrictEffectStagingError('PROJECT_CONTEXT_CONFLICT','contesto progetto già presente e diverso');
    db.prepare('UPDATE project_runtime_states SET context_json=? WHERE branch_id=? AND project_id=?').run(json,branchId,projectId);
    return true;
  });
}

/** I progetti di un ramo, con il loro contesto. Un progetto senza contesto NON
 *  viene restituito: senza detentori non saprebbe dove attingere, e inventarli
 *  sarebbe peggio che dichiararlo fermo. */
export function listStrictProjects(gameId:string,branchId:string):readonly {projectId:string;version:number;workId:string;state:ProjectState;context:ProjectContext}[]{
  const rows=db.prepare('SELECT project_id,plan_json,state_json,version,context_json FROM project_runtime_states WHERE game_id=? AND branch_id=?').all(gameId,branchId) as Array<{project_id:string;plan_json:string;state_json:string;version:number;context_json:string|null}>;
  const out:Array<{projectId:string;version:number;workId:string;state:ProjectState;context:ProjectContext}>=[]; 
  for(const row of rows){
    if(!row.context_json)continue;
    let context:ProjectContext;
    try{context=JSON.parse(row.context_json) as ProjectContext;}catch{continue;}
    if(!context||typeof context.payerActorId!=='string'||typeof context.materialActorId!=='string'||typeof context.regionId!=='string')continue;
    let plan:ProjectPlan|null=null;
    try{plan=JSON.parse(row.plan_json) as ProjectPlan;}catch{plan=null;}
    if(!plan)continue;
    // Il progetto lo identifica il PIANO, non il contesto: il workId sta sul
    // piano costruito da `planFromWork`.
    const workId=(plan as unknown as {workId?:string}).workId??String((plan as unknown as Record<string,unknown>).sourceWorkId??'');
    out.push({projectId:row.project_id,version:row.version,workId,state:JSON.parse(row.state_json) as ProjectState,context});
  }
  return out;
}
/** Il workDone arriva dal motore lavoro server, non dalla LLM; nextState è fissato nello staging. */
export function stageProjectTick(gameId:string,branchId:string,anchorRevision:number,effectId:string,projectId:string,phaseId:string,workDone:IntString):boolean{if(!Number.isInteger(anchorRevision)||anchorRevision<0)throw new StrictEffectStagingError('BAD_ANCHOR','anchor revision non valida');return withCanonicalTransaction(()=>{assertCanonicalEffectAnchor(gameId,branchId,anchorRevision);const r=runtime(branchId,projectId);if(r.game_id!==gameId)throw new StrictEffectStagingError('BAD_PROJECT_RUNTIME','game progetto divergente');const plan=parse<ProjectPlan>(r.plan_json,'plan');const state=parse<ProjectState>(r.state_json,'state');const payload:TickPayload={projectId,version:r.version,nextState:advancePhaseDay(plan,state,phaseId,workDone)};const json=JSON.stringify(payload);const old=db.prepare('SELECT * FROM strict_effect_staging WHERE branch_id=? AND effect_id=?').get(branchId,effectId) as StageRow|undefined;if(old){if(old.kind!=='project_tick'||old.anchor_revision!==anchorRevision||old.game_id!==gameId||old.payload_json!==json)throw new StrictEffectStagingError('STAGING_CONFLICT','project tick staged già presente con contenuto diverso');return false;}db.prepare('INSERT INTO strict_effect_staging (game_id,branch_id,anchor_revision,effect_id,kind,payload_json) VALUES (?,?,?,?,?,?)').run(gameId,branchId,anchorRevision,effectId,'project_tick',json);return true;});}
export function consumeStagedProjectTick(gameId:string,branchId:string,anchorRevision:number,effectId:string):boolean{return withCanonicalTransaction(()=>{assertCanonicalEffectAnchor(gameId,branchId,anchorRevision);const stage=db.prepare('SELECT * FROM strict_effect_staging WHERE branch_id=? AND effect_id=?').get(branchId,effectId) as StageRow|undefined;if(!stage)throw new StrictEffectStagingError('MISSING_STAGED_EFFECT','effectId non staged dal server');if(stage.game_id!==gameId||stage.kind!=='project_tick'||stage.anchor_revision!==anchorRevision)throw new StrictEffectStagingError('STALE_STAGED_EFFECT','project tick non appartiene all ancora canonica');if(stage.status==='consumed')return false;if(stage.status!=='staged')throw new StrictEffectStagingError('BAD_STAGED_STATUS','status staging non valido');const payload=parse<TickPayload>(stage.payload_json,'tick');if(!payload||typeof payload.projectId!=='string'||!Number.isInteger(payload.version)||!payload.nextState)throw new StrictEffectStagingError('BAD_PROJECT_PAYLOAD','tick staged malformato');const claim=db.prepare("UPDATE strict_effect_staging SET status='consumed', consumed_at=CURRENT_TIMESTAMP WHERE branch_id=? AND effect_id=? AND status='staged'").run(branchId,effectId);if(claim.changes!==1)throw new StrictEffectStagingError('STAGING_RACE','project tick già consumato');const update=db.prepare('UPDATE project_runtime_states SET state_json=?,version=version+1 WHERE branch_id=? AND project_id=? AND game_id=? AND version=?').run(JSON.stringify(payload.nextState),branchId,payload.projectId,gameId,payload.version);if(update.changes!==1)throw new StrictEffectStagingError('STALE_PROJECT_RUNTIME','stato progetto cambiato dopo staging');return true;});}
export function getProjectRuntime(branchId:string,projectId:string):{plan:ProjectPlan;state:ProjectState;version:number}{const r=runtime(branchId,projectId);return{plan:parse<ProjectPlan>(r.plan_json,'plan'),state:parse<ProjectState>(r.state_json,'state'),version:r.version};}

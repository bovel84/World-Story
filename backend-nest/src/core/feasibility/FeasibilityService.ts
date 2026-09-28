/** M03 µ2 — gate puro §5.3: nessuna riserva, I/O o LLM. */
import { SimulationCatalog, AuthorityRule } from '../../scenario/types';
import { OrderIntent } from './intent';
export type AssessmentStatus='needs_data'|'blocked'|'feasible'|'feasible_with_conditions';
export type ReasonCode='UNKNOWN_ENTITY'|'AMBIGUOUS_TARGET'|'UNAUTHORIZED_ACTOR'|'UNSUPPORTED_CAPABILITY'|'KNOWLEDGE_MISSING'|'INDUSTRIAL_CAPABILITY_MISSING'|'DATA_UNAVAILABLE'|'DEPENDENCY_BLOCKED'
 // MG01 µ3 — deficit materiali, monetari e di manodopera, con i tre numeri.
 |'INSUFFICIENT_CASH'|'MATERIAL_SHORTAGE'|'WORKFORCE_SHORTAGE';
export interface Blocker{readonly code:ReasonCode;readonly targetId?:string;readonly detail:string;readonly missing?:readonly string[];}
export interface Requirement{readonly allOf?:readonly string[];readonly anyOf?:readonly (readonly string[])[];}
export interface FeasibilityFacts{readonly actorId:string;readonly verifiedPolityId:string;readonly approvals:readonly ('user'|'institutional'|'counterparty')[];readonly rights:readonly {readonly targetId:string;readonly activity:string}[];readonly knowledgeIds:readonly string[];readonly capabilityIds:readonly string[];readonly requirements?:Readonly<Record<string,Requirement>>;readonly modelDataMissingIds?:readonly string[];readonly hiddenFromPlayerIds?:readonly string[];
 /** MG01 µ3 — deficit della distinta misurato sulle letture del ledger.
  *  Assente = la costruzione è valutata senza guardare le disponibilità, come
  *  prima di MG01: il chiamante che non legge il ledger non ottiene un falso
  *  «fattibile», perché senza letture i requisiti restano non verificati. */
 readonly deficits?:readonly {readonly code:string;readonly id:string;readonly phaseId:string;readonly required:string;readonly available:string;readonly missing:string;readonly holder:string}[];
 /** Requisiti che le letture non coprono (manodopera non materializzata). */
 readonly unknownRequirements?:readonly {readonly reason:string;readonly id:string}[];}
export interface AlternativeProposal { readonly kind:'research'|'alternative_path'; readonly requiresConfirmation:true; readonly missing:readonly string[]; }
export interface OrderAssessment{readonly actionId:string;readonly status:AssessmentStatus;readonly blockers:readonly Blocker[];readonly warnings:readonly string[];readonly alternatives:readonly AlternativeProposal[];}
/** MG01 — esito della ricerca della distinta di costruzione per un `construct`. */
export type WorkResolution =
  /** `catalogRef` nomina un'opera e la sua distinta è dichiarata: valutabile. */
  | { readonly kind:'declared'; readonly workId:string }
  /** `catalogRef` non nomina né un'opera né un tipo d'impianto: entità ignota. */
  | { readonly kind:'unknown' }
  /** Entità nota, ma nessuna distinta di costruzione: dato mancante, non costo zero. */
  | { readonly kind:'missing_distinct' };
function hasAll(have:Set<string>,need:readonly string[]){return need.filter(x=>!have.has(x));}
/** Ogni alternativa è una via completa: allOf comune + almeno una anyOf, mai tutte le vie. */
export function satisfiesRequirement(have:ReadonlySet<string>, requirement:Requirement|undefined):{ok:boolean;missing:readonly string[]}{if(!requirement)return{ok:true,missing:[]};const base=hasAll(new Set(have),requirement.allOf??[]);if(base.length)return{ok:false,missing:base};const alternatives=requirement.anyOf??[];if(!alternatives.length)return{ok:true,missing:[]};for(const path of alternatives){const missing=hasAll(new Set(have),path);if(!missing.length)return{ok:true,missing:[]};}return{ok:false,missing:alternatives[0]??[]};}
function authorityActivity(intent:OrderIntent):string|null{return intent.actionKind==='procure'||intent.actionKind==='move'?'spend':intent.actionKind==='produce'||intent.actionKind==='construct'?'allocate':intent.actionKind==='policy'?'policy':null;}
function targetKnown(catalog:SimulationCatalog,id:string):boolean{return catalog.resources.some(x=>x.id===id)||catalog.recipes.some(x=>x.id===id)||catalog.technologies.some(x=>x.id===id)||catalog.facilityTypes.some(x=>x.id===id)||(catalog.works??[]).some(x=>x.id===id)||catalog.initialState.facilities.some(x=>x.id===id)||catalog.initialState.inventory.some(x=>x.id===id)||catalog.initialState.deposits.some(x=>x.id===id)||catalog.polities.some(x=>x.id===id);}
/** MG01 — la distinta di costruzione esiste per questo `catalogRef`?
 *  `construct` senza distinta non è «fattibile a costo zero»: è un'opera il cui
 *  costo non è dichiarato. Distinguere i due casi è il punto della fase. */
export function resolveConstructWork(catalog:SimulationCatalog,catalogRef:string|undefined):WorkResolution{if(!catalogRef)return{kind:'missing_distinct'};const work=(catalog.works??[]).find(x=>x.id===catalogRef);if(work)return{kind:'declared',workId:work.id};const entityKnown=targetKnown(catalog,catalogRef);return entityKnown?{kind:'missing_distinct'}:{kind:'unknown'};}
/** MG01 µ3 — elenco leggibile dei requisiti di una distinta, per dire all'utente
 *  COSA non è stato verificato quando non ci sono letture del ledger. */
export function requirementsOfWork(catalog:SimulationCatalog,catalogRef:string|undefined):readonly string[]{const work=(catalog.works??[]).find(x=>x.id===catalogRef);if(!work)return[];const out=new Set<string>();for(const phase of work.phases){for(const input of phase.inputs)out.add(input.resourceId);if(phase.funds)out.add(phase.funds.currencyId);for(const w of phase.workforce??[])out.add(w.qualification);}return[...out];}
function actorRule(catalog:SimulationCatalog,actorId:string,activity:string):AuthorityRule|undefined{const actor=catalog.actors.find(x=>x.actorId===actorId);return actor?catalog.authorities.find(x=>x.actorType===actor.type&&x.activity===activity):undefined;}
export class FeasibilityService { constructor(private readonly catalog:SimulationCatalog) {}
 evaluate(intent:OrderIntent,facts:FeasibilityFacts):OrderAssessment {const blockers:Blocker[]=[];const warnings:string[]=[];const alternatives:AlternativeProposal[]=[];const missingData=new Set(facts.modelDataMissingIds??[]);const hidden=new Set(facts.hiddenFromPlayerIds??[]);if(intent.actorPolityId!==facts.verifiedPolityId)blockers.push({code:'UNAUTHORIZED_ACTOR',detail:'actorPolityId non coincide con identità verificata dal server'});const actor=this.catalog.actors.find(x=>x.actorId===facts.actorId);if(!actor||actor.polityId!==facts.verifiedPolityId)blockers.push({code:'UNAUTHORIZED_ACTOR',detail:'attore economico non autorizzato per polity verificata'});
 for(const target of intent.targetIds){if(missingData.has(target))blockers.push({code:'DATA_UNAVAILABLE',targetId:target,detail:'model_data_missing: nessun dato autorevole'});else if(hidden.has(target))blockers.push({code:'DATA_UNAVAILABLE',targetId:target,detail:'hidden_from_player: dato esiste ma non è rivelato'});else if(!targetKnown(this.catalog,target))blockers.push({code:'UNKNOWN_ENTITY',targetId:target,detail:'target assente dal catalogo'});}
 const activity=authorityActivity(intent);if(activity&&actor){const rule=actorRule(this.catalog,facts.actorId,activity);if(!rule)blockers.push({code:'UNAUTHORIZED_ACTOR',detail:`nessuna regola R1 per attività ${activity}`});else{const approved=new Set(facts.approvals);const absent=rule.requiresApprovals.filter(x=>!approved.has(x));if(absent.length)blockers.push({code:'UNAUTHORIZED_ACTOR',detail:`consensi mancanti: ${absent.join(',')}`});}}
 const requirement=facts.requirements?.[intent.catalogRef??intent.actionKind];const knowledge=satisfiesRequirement(new Set(facts.knowledgeIds),requirement);if(!knowledge.ok){blockers.push({code:'KNOWLEDGE_MISSING',detail:'prerequisiti di conoscenza non soddisfatti',missing:knowledge.missing});alternatives.push({kind:'research',requiresConfirmation:true,missing:knowledge.missing});if((requirement?.anyOf?.length??0)>1)alternatives.push({kind:'alternative_path',requiresConfirmation:true,missing:knowledge.missing});}
 if(intent.actionKind==='produce'){const recipe=this.catalog.recipes.find(x=>x.id===intent.catalogRef);const facility=this.catalog.initialState.facilities.find(x=>x.id===intent.targetIds[0]);if(!recipe||!facility){blockers.push({code:'UNKNOWN_ENTITY',detail:'ricetta o impianto assente'});}else if(!facility.operational||facility.typeId!==recipe.facilityTypeId){blockers.push({code:'INDUSTRIAL_CAPABILITY_MISSING',targetId:facility.id,detail:'impianto non operativo o incompatibile con ricetta'});}else if(facility.ownerActorId!==facts.actorId&&facility.controllerActorId!==facts.actorId&&!facts.rights.some(x=>x.targetId===facility.id&&x.activity==='operate')){blockers.push({code:'UNAUTHORIZED_ACTOR',targetId:facility.id,detail:'nessun diritto d uso dell impianto'});}}
 // MG01 µ3 — i deficit letti dal ledger entrano nel giudizio con i loro numeri.
 // Un deficit è un blocco: l'opera non parte senza cassa e materiali, e il
 // messaggio dice quanto manca, non solo che manca.
 for(const deficit of facts.deficits??[]){blockers.push({code:deficit.code as ReasonCode,targetId:deficit.id,detail:`per la fase ${deficit.phaseId}: richiesti ${deficit.required}, disponibili ${deficit.available}, mancano ${deficit.missing} (detentore ${deficit.holder})`,missing:[deficit.id]});}
 for(const gap of facts.unknownRequirements??[]){warnings.push(`requisito non verificato — ${gap.id}: ${gap.reason}`);}
 // Senza letture, i requisiti di una distinta NON sono verificati: la
 // costruzione non può dirsi «fattibile» senza condizioni. È lo stesso verde
 // spurio di prima, un livello più su: non «costa zero», ma «non so se ce l'hai».
 if(intent.actionKind==='construct'&&facts.deficits===undefined){const requirements=requirementsOfWork(this.catalog,intent.catalogRef);for(const r of requirements){warnings.push(`disponibilità non verificata — ${r}: la costruzione non è valutata sul possesso`);}}
 // MG01 — costruzione senza distinta: `needs_data`, mai `feasible`. Il verde
 // spurio nasceva dal fatto che `estimateIntentCosts` restituiva tempo e input
 // vuoti per un `construct`, indistinguibili da un costo dichiarato pari a zero.
 if(intent.actionKind==='construct'){const resolution=resolveConstructWork(this.catalog,intent.catalogRef);if(resolution.kind==='unknown'){blockers.push({code:'UNKNOWN_ENTITY',targetId:intent.catalogRef,detail:'tipo d’opera assente dal catalogo'});}else if(resolution.kind==='missing_distinct'){blockers.push({code:'DATA_UNAVAILABLE',targetId:intent.catalogRef,detail:'nessuna distinta di costruzione dichiarata per quest’opera: il costo non è noto',missing:[intent.catalogRef??intent.actionKind]});}else{const work=(this.catalog.works??[]).find(x=>x.id===resolution.workId);if(work&&work.phases.some(p=>(p.inputs??[]).length===0)){blockers.push({code:'DATA_UNAVAILABLE',targetId:resolution.workId,detail:'distinta di costruzione incompleta: almeno una fase non dichiara materiali',missing:[resolution.workId]});}}}
 if(intent.actionKind==='move'||intent.actionKind==='procure'){const lot=this.catalog.initialState.inventory.find(x=>x.id===intent.targetIds[0]);if(lot&&lot.ownerActorId!==facts.actorId&&lot.custodianActorId!==facts.actorId&&!facts.rights.some(x=>x.targetId===lot.id&&x.activity==='use'))blockers.push({code:'UNAUTHORIZED_ACTOR',targetId:lot.id,detail:'stock privato/altrui senza diritto o contratto'});}
 if(intent.authorization.allowPartialStart&&intent.authorization.allowedPhaseIds.length===0)warnings.push('avvio parziale richiesto ma nessuna fase autorizzata: nessun avvio parziale verrà applicato');if(intent.actionKind==='qualitative')warnings.push('ordine qualitativo: nessuna ricetta o effetto materiale valutato');const status:AssessmentStatus=blockers.some(x=>x.code==='DATA_UNAVAILABLE')?'needs_data':blockers.length?'blocked':warnings.length?'feasible_with_conditions':'feasible';return{actionId:intent.id,status,blockers,warnings,alternatives};}
}

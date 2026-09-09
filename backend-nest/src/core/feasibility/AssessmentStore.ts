/** M03 µ4 — cache preview: mai autorità di commit (§5.3–5.4). */
export interface AssessmentAnchor { readonly gameId:string; readonly branchId:string|null; readonly checkpointId?:string; readonly revision:number; readonly queueVersion:number; }
export interface CachedAssessment<T> { readonly assessmentId:string; readonly anchor:AssessmentAnchor; readonly value:T; readonly expiresAt:number; }
export class StaleAssessmentError extends Error { readonly code='STALE_ASSESSMENT'; constructor(message='assessment stale: anchor/TTL non più valido'){super(message);this.name='StaleAssessmentError';} }
function same(a:AssessmentAnchor,b:AssessmentAnchor):boolean{return a.gameId===b.gameId&&a.branchId===b.branchId&&a.checkpointId===b.checkpointId&&a.revision===b.revision&&a.queueVersion===b.queueVersion;}
export class AssessmentStore<T> { private readonly values=new Map<string,CachedAssessment<T>>(); constructor(private readonly now:()=>number=()=>Date.now(),private readonly ttlMs=60_000){}
 put(assessmentId:string,anchor:AssessmentAnchor,value:T):CachedAssessment<T>{const item={assessmentId,anchor,value,expiresAt:this.now()+this.ttlMs};this.values.set(assessmentId,item);return item;}
 getFresh(assessmentId:string,current:AssessmentAnchor):CachedAssessment<T>{const item=this.values.get(assessmentId);if(!item||item.expiresAt<=this.now()||!same(item.anchor,current)){this.values.delete(assessmentId);throw new StaleAssessmentError();}return item;}
 clear():void{this.values.clear();}
}

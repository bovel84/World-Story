# Sala del Consiglio — implementation and review

## Interaction

- The minister picker selects the initial rapporteur, not the owner of the discussion.
- Rooms have one ID, topic, named transcript, participant list, common decision board, invitations and attributed positions. Drafts and presidential signature keys are associated with the room ID.
- The chat occupies the full workspace by default (19 px desktop, 18 px mobile). The board opens as a 35% desktop drawer or a full-screen mobile bottom sheet. Opening/closing it preserves the composer, history and proposals.
- Ministers suggest invitations through a validated `consiglio` protocol. Only a presidential click admits a colleague. Manual admission remains available for all seven supported ministerial seats, including when a cabinet dossier is sparse.
- Each round is sequential, with at most one intervention per participant. Every request receives the completed named contributions preceding it, the common decision state and the council context. A newcomer speaks first, then the existing participants respond. There is no recursive autonomous loop.
- Preparing an act runs a short drafting round with every participant. The resulting editable common draft contains articles, constraints and the named contributing proponents. Preparation does not queue or execute an order.
- Evidence references still open validated engine-derived charts/maps in the common board. Authoritative dossiers are tucked into a disclosure rather than permanently consuming chat space.

## Safety / differential review

Reviewed the model and orchestration, UI, API transport, request bridge and the existing order/preflight integration. Source-based caller inspection was used: no codebase graph was indexed. The new API argument is optional; both minister routes use the request bridge, and existing one-minister calls retain their contract.

Resolved findings:

1. **Truncated replies:** stream reader failures now reject even after tokens have arrived, without initiating a second generation. The backend destroys an already-started minister response on provider failure instead of emitting successful EOF. Partial text is presentation-only and cannot update the common board or become a colleague's completed intervention.
2. **Presidential authority:** model actions cannot accept/reject a proposal on behalf of the President or create authoritative engine facts. Claimed President/engine sources are downgraded to minister proposals. Acceptance and exclusion are explicit presidential actions; acceptance does not erase unanswered questions or imply ministerial unanimity.
3. **Ambiguous signatures:** a signature attempt freezes the payload, including a verified work declaration, and its idempotency key. A new preparation is blocked until explicit cancellation. Retry uses the same payload/key. An unconfirmed attempt also prevents silently concluding and discarding the room.
4. **Construction payloads:** the exact draft's engine preview supplies work/payer/material actors, funding and canonical region. Unsupported funding/materials or missing/ambiguous location block signature. Browser coverage confirms declaration and region survive into `actions/queue`.
5. **Scope isolation:** operation ownership is checked against room ID, open state, game/branch/turn/mandate scope and abort signal. Interrupt, close, back and scope changes cannot attach late responses to another room. Memory consolidation writes to the originating game/branch/mandate and records the originating date/turn.
6. **Board/draft parity:** the same formatter renders all declared percentage/value/amount fields in both board and draft; currency units are not appended to percentages.
7. **Accessibility:** nested sheets restore their trigger, preserve the enclosing dialog's inertness and do not reinitialize its focus trap when Escape handling changes. Full-screen board Escape closes the sheet only.

Unsigned discussions and outstanding invitations are retained as discussed proposals/open questions, never queued or executed decisions. Signed orders still go through the existing idempotent register and engine execution path. A minister's declared agreement is attributed to that minister, not promoted to universal consensus.

## Verification

- Frontend build: passed.
- Backend build: passed.
- Frontend: **152 files, 1,323 tests passed**.
- Backend source suite: **229 files, 2,426 tests passed**, using `npm test -- --exclude 'dist/**' --maxWorkers=2`.
- Council browser suite: **8 tests passed**, using `npx playwright test -c playwright.config.mjs tests/council-room.spec.mjs` from `e2e/`.
- `git diff --check`: passed.
- Visually inspected desktop chat and mobile chat/board screenshots; snapshots are written under `/tmp/world-story-council-*.png` by the browser suite.
- Tests covered named shared context, manual and suggested admission, bounded rounds, common drafting, explicit signing, canonical work payload, inline evidence, interruption/resumption, immutable signature retry and mobile focus restoration.

Raw backend `npm test` also discovers six generated CommonJS tests under `dist/`, which cannot import Vitest. The successful full source run explicitly excludes generated artifacts; no unrelated test configuration was changed. The frontend build retains the existing large-chunk warning.

## Boundaries

- Active rooms are client-side and survive closing/reopening the Government interface or returning to the minister picker in the mounted game. A browser reload does not restore the live transcript. On turn/branch/mandate transitions, rooms are retired and selective memory remains scoped to their origin. This is not a server-persisted `GovernmentSession` API.
- Recent history is bounded to 20 named contributions; the common decision state and minister memory provide additional context. Provider calls are sequential, so admitting many participants increases response time; interruption is available.
- The seven existing seats are preserved. Industry remains within the existing Lavori remit; a new standalone Industry portfolio was not introduced.
- Browser tests use mocked providers; real-model negotiation quality and the legacy selector-based Government browser suites were not comprehensively evaluated. Existing minister personality and world-context prompts remain in use.

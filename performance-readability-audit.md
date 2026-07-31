# Katei Performance and Readability Audit

- Audit date: 2026-07-31
- Audited commit: a2d1423 (main and origin/main)
- Primary app: apps/katei
- Scope: application runtime, browser code, persistence/read models, templates, tests, build/deploy configuration, shared styles, and repository-local automation

## Executive summary

Katei has broad behavioral coverage and clear domain concepts, but its current request and mutation paths repeatedly process much more data than the user action requires. The central scaling issue is the full-snapshot architecture: routine reads scan all workspace documents, fine-grained commands repeatedly migrate and clone a complete workspace, persistence replaces the complete Mongo document, API responses return the complete projected workspace, and the browser normalizes and rebuilds the complete board.

The highest-value changes are:

1. Replace repeated unbounded Mongo scans with one indexed, viewer-scoped access read.
2. Establish one trusted normalization boundary and stop repeatedly migrating, validating, and cloning current-schema records.
3. Move fine-grained commands toward targeted persistence and authoritative deltas.
4. Split browser code by surface and lazily load editor and locale resources.
5. Reconcile or hydrate the server-rendered board, then update cards and stages incrementally.
6. Make multi-field card saves and AI operation reservations atomic.
7. Restore a green test gate and decompose the largest modules along their existing domain seams.

Priority labels in this report mean:

- P0: address before material data or usage growth because the work is on a routine hot path or can duplicate paid side effects.
- P1: high-value next work with clear user, operational, or maintenance impact.
- P2: useful cleanup after the main hot paths are controlled.

Effort is directional only. Production traces and representative data should be collected before selecting a storage redesign.

## Audit scope and evidence

The audit combined static call-path review, import-graph analysis, byte measurements, controlled synthetic instrumentation, and the existing test suites. Vendored/minified code was excluded from readability review but included in delivery-size measurements.

| Evidence | Result |
| --- | ---: |
| App runtime/build JavaScript reviewed | 29,233 lines |
| App tests reviewed | 37,285 lines |
| Repository-local automation JavaScript/Python reviewed | 13,996 lines |
| App templates and owned styles reviewed | 3,498 lines |
| Shared browser entry graph | 61 modules; 665,649 raw bytes; 139,616 bytes when each file is gzipped |
| Additional workspace vendor JavaScript | 3 files; 392,592 raw bytes; 129,144 bytes when gzipped |
| Complete app test run | 825 tests; 824 passed; 1 failed |
| Synthetic current migration: 100 cards / 300 locale variants | 504 structuredClone calls |
| Synthetic localization read: one 100-locale card | 5,253 Intl.getCanonicalLocales calls |

The browser size figures describe checked-in bytes and per-file gzip estimates, not a production network trace. Actual transfer depends on the hosting layer, cache state, and negotiated compression.

The one deterministic test failure is apps/katei/test/debug_auth.test.js:90. Its local repository double does not implement resolvePreferredWorkspaceForViewer, which apps/katei/src/routes/boards.js:37 now requires. This is a fixture/interface-drift failure, not a consequence of this report.

## Prioritized recommendations

| ID | Priority | Category | Recommendation | Effort |
| --- | --- | --- | --- | --- |
| PERF-01 | P0 | Database | Replace repeated full collection scans with one indexed viewer-context read | L |
| PERF-02 | P0 | CPU / memory | Normalize records once and use structural sharing for mutations | L |
| PERF-03 | P0 | Storage / network | Stop rewriting and returning the whole workspace for every command | L |
| PERF-04 | P0 | Browser startup | Load route-specific controllers, locale catalogs, and editor assets | M |
| PERF-05 | P0 | Rendering | Hydrate/reconcile SSR and update board DOM incrementally | L |
| PERF-06 | P1 | Mutation design | Save card content, priority, and stage in one atomic command | M |
| PERF-07 | P1 | Read models | Materialize and paginate portfolio data; build derived indexes once | L |
| PERF-08 | P0/P1 | AI cost / latency | Reserve AI operations durably and share a bounded, abortable client | M/L |
| PERF-09 | P1 | Hot-path cleanup | Lazily construct diagnostics and avoid rendering closed UI | S/M |
| READ-01 | P1 | Architecture | Split orchestration monoliths along existing domain boundaries | L |
| READ-02 | P1 | Testability | Use a shared contract-tested repository fixture and gate deploys | M |
| READ-03 | P2 | Consistency | Centralize JSON transport, typed errors, menus, and duplicated markup | M |
| READ-04 | P2 | Tooling ownership | Remove or generate the divergent env-inventory shadow copy | S/M |

## Detailed findings

### PERF-01 — Replace unbounded Mongo scans with one viewer-context read

Evidence:

- apps/katei/src/routes/boards.js:65-78 asks for pending invites and accessible workspaces concurrently.
- apps/katei/src/routes/workspace_api.js:1526-1535 does the same after routine API mutations.
- Both paths independently reach apps/katei/src/workspaces/mongo_workspace_record_repository.js:800-802, which performs find({}).toArray().
- Preferred-workspace fallback can add two further collection scans at mongo_workspace_record_repository.js:572-639.
- Each scan returns complete workspace/card documents and then normalizes/projects them in JavaScript.
- No createIndex/createIndexes initialization exists under apps/katei/src. The common home lookup at mongo_workspace_record_repository.js:875-882 first queries viewerSub/isHomeWorkspace before trying the deterministic indexed _id.

Impact:

- A normal successful board or mutation response performs at least two full collection reads for its extras. Some fallback paths can perform four.
- Database traffic, server memory, migration CPU, and response latency scale with all stored workspace data rather than the current viewer's candidate records.
- The two parallel scans reduce wall-clock time but double database work.

Recommended change:

1. Add one repository operation such as loadViewerWorkspaceContext that returns pending invites and accessible-workspace summaries from one cursor and one pass.
2. Query the canonical home-workspace _id first and keep legacy fallbacks afterward.
3. Project only identity/title/revision/access summary fields when full workspace contents are not needed.
4. Denormalize searchable top-level access principals and pending-invite principals, or add a dedicated board-access read model. Maintain those fields in the same mutation boundary and add appropriate single/compound indexes after reviewing legacy data.
5. Load a complete workspace document only after the viewer-scoped candidate query selects it.

Validation:

- Assert the number of collection find calls and bytes returned for GET /boards and each actor-facing mutation.
- Exercise large multi-workspace fixtures with owner, member, email invite, and inaccessible records.
- Confirm candidate queries with Mongo explain("executionStats"), including examined document counts.
- Preserve invite ordering, legacy-home fallback, access filtering, and secret redaction tests.

### PERF-02 — Normalize once and stop cloning the complete record at every helper boundary

Evidence:

- createWorkspaceRecord at apps/katei/src/workspaces/workspace_record.js:57-114 always validates, migrates, and clones its workspace.
- validateWorkspaceSnapshot at workspace_record.js:234-255 migrates, strips aliases, and validates again.
- Update, activity, receipt, serialization, deserialization, persistence, and projection helpers call createWorkspaceRecord on records that were already normalized.
- A static trace of a successful non-no-op command reaches createWorkspaceRecord roughly 14 times through apps/katei/src/routes/workspace_api.js:236-354, workspace_record.js:158-193 and 308-357, and mongo_workspace_record_repository.js:440-448 and 963-1005.
- apps/katei/public/js/domain/workspace_migrations.js:66,113,170,422 clones at workspace, board, card, and variant levels. A synthetic 100-card/300-variant migration made 504 structuredClone calls.
- The browser repeats current-schema migration for every bootstrap and API response at apps/katei/public/js/repositories/http_workspace_repository.js:392-446.

Impact:

- Small mutations repeatedly perform O(workspace-size) traversals, allocate large short-lived graphs, block the Node event loop, and create browser/server garbage-collection pressure.
- Hidden normalization inside constructors and read helpers makes performance cost and mutation ownership hard to reason about.

Recommended change:

1. Parse, migrate, validate, and clone once at an untrusted boundary: Mongo document, import payload, or legacy browser storage.
2. Treat the resulting object as a trusted normalized record inside command application and persistence. Keep an optional development assertion instead of production re-normalization at each helper.
3. Separate current-schema validation from legacy migration. A valid current version should not run the migration pipeline.
4. Convert nested migrators into private in-place transforms operating on one owned clone, or use path copying without first cloning the entire tree.
5. Apply structural sharing during commands: copy the workspace shell, affected board, affected stage/card, and changed arrays only.
6. Scan already-normalized receipts/activity directly instead of constructing another record.

Validation:

- Preserve input immutability, migration idempotence, legacy alias handling, and output equivalence.
- Count migration and structuredClone calls in a test seam.
- Benchmark command application and parsing with 100, 1,000, and 5,000-card fixtures.
- Track elapsed time, event-loop delay, and peak/allocated heap.

### PERF-03 — Stop full-document writes and full-workspace command responses

Evidence:

- apps/katei/src/workspaces/mongo_workspace_record_repository.js:963-1004 serializes a complete next document and uses replaceOne for persistence.
- apps/katei/src/routes/workspace_api.js:1362-1412 includes the complete projected workspace in every actor-facing success response.
- The browser then parses, migrates, validates, stores, and re-renders that complete response.
- The bootstrap also includes all visible boards and cards even though one board is active.

Impact:

- Editing one card creates O(workspace-size) Mongo write amplification, JSON serialization, response bandwidth, client parsing, and rendering.
- Growth is constrained by a single-document storage model as well as latency.
- The same state is repeatedly materialized across persistence, server response, client state, and DOM.

Recommended change:

1. Keep complete replacement for legacy import and explicit snapshot PUT only.
2. For commands, use revision-guarded targeted updates or normalized board/card storage. Preserve atomic revision, activity-event, and command-receipt semantics.
3. Return an authoritative mutation result containing the changed entities, removed entity IDs, and next revision. Fetch a full snapshot only for initial load, recovery, or conflict repair.
4. Split workspace navigation summaries from active-board detail so inactive boards are loaded on demand.
5. Treat this as a staged migration: first remove redundant normalization and add response-size metrics; then introduce deltas; finally reconsider storage granularity if data warrants it.

Validation:

- Measure Mongo bytes written and HTTP request/response sizes for one-card edit, move, locale update, and invite mutation.
- Keep stale-revision, idempotent replay, projection, hidden-board, and secret-redaction behavior intact.
- Add client tests that apply deltas and recover from an intentionally missed revision by loading a complete snapshot.

### PERF-04 — Split browser resources by surface and interaction

Evidence:

- apps/katei/src/views/layouts/base.njk:23 loads the same /js/app.js entry on every page.
- apps/katei/public/js/app.js:1-27 statically imports and registers every controller: landing, workspace, portfolio, editor, collaboration, session, and stage configuration.
- The resulting graph is 61 modules and 665,649 raw bytes. It includes the 101,348-byte all-locale catalog at apps/katei/public/js/i18n/messages.js.
- apps/katei/src/views/pages/workspace.njk:3-8 eagerly loads EasyMDE, marked, and DOMPurify. Their JavaScript totals 392,592 raw bytes even though EasyMDE is only instantiated when an editor opens.
- express.static is mounted without application-managed compression or immutable content-hashed URLs at apps/katei/src/app.js:53.

Impact:

- Landing and portfolio users download, parse, and evaluate workspace/editor code they cannot use.
- Workspace readers pay the editor cost before opening an editor.
- Native module caching helps repeat visits, but it does not remove initial request, parse, and evaluation work.

Recommended change:

1. Create landing, portfolio, and workspace entries, or dynamically register controllers only when the corresponding data-controller exists.
2. Load EasyMDE on the first create/edit action; optionally prefetch it during browser idle time. Load marked/DOMPurify only where markdown presentation requires them.
3. Generate per-locale, preferably per-surface, message modules. Load English fallback only when a key is missing.
4. Introduce a production browser build with minification, route chunks, content hashes, compression, and long-lived immutable caching. Update the service-worker precache manifest from the build output.
5. Add explicit route budgets before choosing a bundler so the build cannot silently regress.

Validation:

- Landing must not request workspace, editor, repository, or portfolio modules.
- Portfolio must not request board/card editor modules.
- A read-only workspace load must not request EasyMDE.
- First editor open loads the editor once; later opens reuse it and retain current focus/error behavior.
- Measure transfer, request count, parse/evaluation time, first interaction latency, and cache behavior.

### PERF-05 — Hydrate the server board and update DOM incrementally

Evidence:

- apps/katei/src/routes/boards.js:155-207 creates a presentation board and also serializes the complete workspace bootstrap.
- apps/katei/src/views/partials/workspace-shell.njk:34-35 and 89-90 render board markup and embed the full JSON bootstrap.
- On connect, apps/katei/public/js/controllers/workspace_controller.js:81-130 consumes that bootstrap, then runAction calls render at workspace_controller.js:1447-1452.
- renderBoardState at apps/katei/public/js/renderers/board_renderer.js:54-70 clones every stage/card node and replaces the complete board region.
- The server and client presentation contracts differ: card-item.njk:15-27 emits raw detailsMarkdown and raw updatedAt in stored stage order; board_renderer.js:130-176 generates plain-text markdown previews, localized dates, and priority-sorted cards. Visible churn is therefore expected at connect.
- Every later successful action calls the same complete render. Unchanged cards repeat marked/DOMPurify work through apps/katei/public/js/lib/markdown.js:7-25.

Impact:

- Initial HTML duplicates state in markup and JSON, then immediately discards/recreates that markup.
- One-card changes clone and sanitize all card nodes, trigger layout/GC work, and can disturb focus, scroll, and node identity.
- Closed board-options and collaborator dialogs are also re-derived and rebuilt on every workspace render.

Recommended change:

1. Define one presentation view-model/order/formatting contract shared by server and browser.
2. Prefer real hydration/reconciliation so initial server nodes remain in place. If that is not practical, render a stable server skeleton and choose a clear client-rendered path instead of doing both.
3. Implement keyed reconciliation by workspace, board, stage, and card ID. Touch only changed cards, affected stage counts/order, and relevant open dialogs.
4. Cache preview text by localized markdown plus locale/revision, or compute it once in the presentation model.
5. Store dialog context on sync but render board-options/collaborators only while their dialog is open.

Validation:

- Initial card nodes retain identity after Stimulus connects and the page has no presentation reorder/content flash.
- A one-card update preserves unrelated node identity, focus, scroll, and collapsed state.
- Instrument template clones, markdown conversions, replaced nodes, layout shifts, and render duration.
- Compare incremental output against existing renderer snapshots across permissions/locales.

### PERF-06 — Make a card-editor save one atomic mutation

Evidence:

- apps/katei/public/js/controllers/workspace_card_dialog.js:63-119 independently plans localized-content upsert, priority update, and stage move.
- executeWorkspaceCardEditorPlan at workspace_card_dialog.js:136-143 awaits those operations serially.
- Each operation sends a command, advances revision, receives a complete workspace, and triggers complete client normalization.

Impact:

- One Save can require three network round trips and three complete snapshot pipelines.
- A later operation can fail after an earlier operation committed, leaving a partial save.
- Extra revision windows increase conflict probability.

Recommended change:

- Add one card.edit/card.update command that can atomically apply localized content, priority, review effects, and target stage under one expected revision and one command receipt. A generic transactional command batch is an alternative only if it has all-or-nothing validation and a clear result contract.

Validation:

- Editing all supported fields makes one request and increments revision once.
- Invalid stage/content causes no partial mutation.
- Existing workflow-review reset rules, locale protections, permissions, and activity semantics remain correct.

### PERF-07 — Materialize portfolio projections and reuse per-card derived indexes

Evidence:

- apps/katei/src/workspaces/mongo_portfolio_read_model.js:30-82 performs find({}).toArray(), migrates every record, walks every board/card/locale, stores every queue item, and globally sorts the results.
- Search/filtering happens after this work in apps/katei/src/routes/portfolio.js.
- mongo_portfolio_read_model.js:161-169 calls findColumnIdByCardId for every card. That helper scans each stage cardIds array with includes at apps/katei/public/js/domain/workspace_selectors.js:25-33, creating potentially quadratic board traversal.
- apps/katei/public/js/domain/card_localization_requests.js:7-25 and 138-213 repeatedly canonicalizes and scans variants/requests once per locale. The controlled 100-locale case made 5,253 Intl.getCanonicalLocales calls.
- apps/katei/public/js/domain/workspace_validation.js:159-195 allocates a new valid-stage Set for each card.
- Permission derivation independently scans memberships for read/edit/admin checks.

Impact:

- Portfolio time and heap scale with the entire database and every localized variant.
- Repeated derived-state construction multiplies work inside the already unbounded scan.

Recommended change:

1. Maintain a lean portfolio summary/projection on the write path and query totals/queues with pagination and search pushdown.
2. Build one cardId-to-stageId map per board.
3. Build one CardLocalizationSnapshot per card containing normalized policy, ordered locales, variantByLocale, requestByLocale, and statuses.
4. Hoist validStageIds once per board and derive actor membership/permissions once per board/actor.
5. Until a materialized read model exists, stream/project only needed fields and apply explicit result/page limits.

Validation:

- Compare projected results with the current implementation using the existing portfolio fixtures.
- Add scaling tests for cards, stages, workspaces, and locales, including operation counters.
- Measure heap, elapsed time, event-loop delay, and Mongo examined/returned bytes.

### PERF-08 — Reserve AI operations before calling upstream and share a bounded client

Evidence:

- The localization and stage-prompt routes at apps/katei/src/routes/workspace_api.js:463-528 and 620-681 check a receipt, call OpenAI, and only then persist the receipt.
- Concurrent requests with the same clientMutationId can both invoke the paid side effect before one loses optimistic concurrency. Existing duplicate coverage is sequential.
- apps/katei/src/ai/openai_localizer.js:77-105 and openai_stage_prompt_runner.js:89-117 supply neither an application deadline/abort signal nor an explicit output limit.
- HTTP/JSON/output parsing is duplicated and already differs between the two adapters.

Impact:

- Retries/concurrency can duplicate upstream latency and billing.
- An unrelated edit during a long call can make completed paid work unusable.
- Stalled upstreams occupy web-process capacity until the transport/platform times out.

Recommended change:

1. Reserve an operation keyed by workspaceId/clientMutationId before calling upstream, enforced by a unique index. Store pending, completed, and failed state plus a source-content fingerprint.
2. For long-running work, prefer a job-backed flow. Apply the completed result only if the relevant source fingerprint still matches; otherwise surface a deterministic conflict/review state.
3. Extract a shared Responses JSON client with injected deadline, AbortSignal support, explicit output-token/response-size limits, and consistent typed error mapping.

Validation:

- Fire delayed concurrent identical requests and assert one upstream call and one durable result.
- Test a concurrent unrelated edit and a changed source card.
- Use a never-resolving fetch double to verify abort propagation and timeout classification.
- Test oversized, malformed, non-JSON, and non-2xx responses in the shared adapter.

### PERF-09 — Remove avoidable work from quiet hot paths

These smaller changes are low-risk once the P0 design work is underway:

| Opportunity | Evidence | Change |
| --- | --- | --- |
| Lazy diagnostic fields | Browser log arguments traverse boards/invites before logInviteDebug checks its flag: public/js/repositories/http_workspace_repository.js:348-377, 429-493, 740-797. Server no-op loggers still receive eagerly built response summaries in src/routes/boards.js:99-108 and workspace_api.js:1401-1408. | Cache the enabled flag and accept lazy field producers. Build/scan only inside the enabled branch. |
| Closed-dialog work | workspace_controller.js:1583-1588 always dispatches option/collaborator sync; their controllers replace rows even when closed. | Store latest context; derive and render only on open or while open. |
| Static/health middleware | apps/katei/src/app.js:49-55 runs body/cookie/locale middleware before static files; health also reaches global session routing. | Mount static assets and a minimal health route first; scope body parsers to body-consuming routes. |
| Snapshot PUT double read | workspace_api.js:141-177 loads for permission, then mongo repository replaceWorkspaceSnapshot loads again at :365-400. | Make load/authorize/revision/persist one repository operation or pass a trusted loaded record. |
| Service-worker refresh lifetime | public/sw.template.js:97-116 starts a refresh with void after returning the cached response. | Attach the refresh promise to event.waitUntil while returning cached data immediately, then regenerate sw.js. |
| Shutdown resource lifecycle | src/server.js:34-63 closes HTTP connections but never calls the existing closeMongoClient helper in src/data/mongo_client.js:31-44. | Await HTTP drain and Mongo close, clear the force timer on completion, and test repeated signals, close errors, and the grace-period fallback. |
| Development CSS rebuild | apps/katei/package.json:10-13 rebuilds CSS on every Nodemon restart. | Run Tailwind watch separately and keep Nodemon focused on server restarts. |

CSS minification is a secondary win: the measured app CSS changes from 83,557 to 68,796 raw bytes, but only from 11,774 to 11,424 gzip bytes. Route JavaScript and snapshot work have much larger expected impact.

## Readability and maintainability

### READ-01 — Split orchestration monoliths along existing seams

| Module | Current responsibilities | Suggested seam |
| --- | --- | --- |
| public/js/controllers/workspace_controller.js (2,645 lines; more than 80 methods) | Repository creation, navigation, collaboration, editor/view workflows, menus, confirmation, history, deep links, render orchestration | Command runner/state store, card-view controller, history adapter, board reconciler, shared menu primitive |
| src/routes/workspace_api.js (1,633 lines) | Route registration, command orchestration, AI use cases, idempotency, response construction, error mapping | One executeWorkspaceMutation use case plus command, localization, prompt, import/admin routers |
| src/workspaces/apply_workspace_command.js (2,043 lines; 26 command types) | Dispatch, permissions, board schema, collaboration, cards, locales, review, AI settings | Handler registry split by workspace, board/collaboration, card, localization, and review domains |
| src/workspaces/mongo_workspace_record_repository.js (1,458 lines) | Record storage, access discovery, repair, projection, invite scans, title generation | Record store, viewer-access read model, migration/repair service |
| public/js/repositories/http_workspace_repository.js (849 lines) | Workspace state, transport, normalization, debug tracing, import, special admin endpoints | Generic JSON transport, workspace response codec/state, debug adapter |

This should be staged, not a line-count rewrite. Preserve current command and custom-event contracts, extract tested plain modules, then simplify the orchestrators. The performance changes above become safer once normalization, mutation execution, rendering, and access queries each have one owner.

### READ-02 — Consolidate repository test doubles and gate deployment

Evidence:

- The suite currently reports 824/825 passing.
- apps/katei/test/debug_auth.test.js:115-153 has a handwritten repository double missing resolvePreferredWorkspaceForViewer.
- Larger doubles at apps/katei/test/app.test.js:4844 and workspace_api.test.js:2052 implement overlapping versions of the interface.
- Root package.json:8-14 has no test/check script.
- .github/workflows/deploy-katei-heroku.yml:38-45 and 69-94 installs, builds, and deploys without running app or tooling tests.

Recommended change:

1. Create one shared in-memory WorkspaceRecordRepository fixture that satisfies a contract suite.
2. Let tests configure records/failures through that fixture instead of redefining the interface.
3. Add root test:app, test:tooling, test, and check scripts.
4. Gate the deploy job on the check step.
5. Add browser/real-DOM integration coverage for Stimulus event wiring and menu behavior; plain object doubles cannot model DOM Attr behavior reliably.

### READ-03 — Centralize common contracts and remove duplicated UI infrastructure

| Area | Evidence | Recommendation |
| --- | --- | --- |
| JSON transport | create/delete endpoints repeat fetch headers, parse, response.ok, and error creation around public/js/repositories/http_workspace_repository.js:200-283; landing/session duplicate parsers. | Add requestJson with credentials/header merge, typed API errors, optional AbortSignal, and a separate workspace codec/state updater. |
| Error control flow | i18n/errors.js maps many exact English messages while domain modules throw many generic Error strings; Mongo not-found logic compares messages and malformed records can be silently dropped. | Introduce stable DomainError codes/data, central HTTP mapping, structured diagnostics, and keep message matching only as compatibility. |
| Card markup | src/views/partials/board-templates.njk:7-32 duplicates card-item.njk:1-30. | Use one parameterized partial/macro for SSR and template placeholders, with a DOM-contract test. |
| Accessible menus | Status/locale menu keyboard logic is repeated across card_editor_controller.js and workspace_controller.js. | Extract one tested listbox/menu primitive with real-DOM keyboard tests. |
| Stage configuration | board_stage_config_controller.js:55-59 and 273-334 reparses definitions twice and rebuilds two regions for every input event. | Parse once, pass a shared draft to both views, and coalesce input work to an animation frame/debounce. |
| Translation lookup | i18n/translate.js:30-55 splits/trims each dot path and performs locale/fallback traversal repeatedly. | Generate/flatten catalogs or memoize key resolution; add catalog topology and placeholder parity tests. |
| Compatibility barrel | public/js/domain/workspace.js re-exports broad/legacy modules although production usage is narrow. | Use direct imports and retire unused legacy mutators after compatibility confirmation. |

Also correct the stray GET /api/workspace log label at apps/katei/src/routes/workspace_api.js:105-107; it currently says "DEBUG stage prompt route error".

### READ-04 — Make env-inventory ownership unambiguous

Evidence:

- Both .agents/env-inventory and .agents/skills/env-inventory contain 23 tracked files.
- The two trees differ in instructions, generators, renderers, fixtures, and tests.
- AGENTS.md and README.md designate .agents/skills/env-inventory as canonical.
- The shadow .agents/env-inventory/SKILL.md still refers to the stale apps/*/doc path while invoking scripts from the canonical tree.

Recommended change:

- Remove the shadow tree if it has no external packaging contract. If both layouts are required, generate one from the canonical source and add a byte-for-byte/specified-difference check instead of editing both.
- Run the canonical env-inventory tests/check, then regenerate the file-tree artifacts with the repository skill because that removal would be a material structural change.
- Add a simple guard against duplicate `.agents/<skill>` and `.agents/skills/<skill>` ownership.

Lower-priority tooling opportunities:

- Cache compiled globs/file contents and share one scan context across apps in the env-inventory generator. Its measured one-app check is already fast (about 0.61 seconds), so optimize this only for multi-app growth.
- Cache directory listings and build one inventory for root/per-app projections in the monorepo file-tree generator; add exclusion, truncation, idempotence, and generated-guidance tests.
- Extract shared session-page, HTTP, polling, screenshot, and reporting helpers from the auth-debug exercise scripts.
- Cache getStageActions once per stage in public/js/domain/board_schema.js:71-89 instead of deriving it twice while serializing the same stage.
- Group repeated mask sizing/repeat/position declarations in packages/brand/src/components.css:437-525.
- Reconcile apps/katei/package.json's @hotwired/stimulus dependency with the vendored runtime: remove the unused package or create a deterministic vendor-copy/check step.

## Adjacent correctness findings

These were found while tracing performance/readability paths and should be fixed before relying on related optimizations:

| Finding | Evidence | Recommended fix |
| --- | --- | --- |
| Portfolio self-role commands default to revision 0 | portfolio_controller.js:287-325 creates a service with no active/bootstrap revision at :425-446; workspace_service.js:220-230 forwards null; http_workspace_repository.js:154-170 falls back to revision 0. | Include record revision in portfolio rows or resolve it before POST; add a revision-greater-than-zero integration test and preserve stale 409 behavior. |
| Verify-locale event is unhandled | card_editor_controller.js:608-627 dispatches card-editor:verify-locale, but workspace-shell.njk:10-31 has no action and workspace controller has no handler. | Wire a shared request/verify locale-review handler and add a DOM-level Stimulus test asserting one verify command. |
| Selected locale focus reads Attr incorrectly | workspace_controller.js:1094-1097 compares option.attributes['aria-checked'] directly with a string. | Use getAttribute('aria-checked') and cover opening/focus with a real DOM. |
| Cached service-worker refresh may be terminated | sw.template.js:97-116 does not pass background refresh to event.waitUntil. | Tie refresh lifetime to the fetch event and test stale-while-revalidate behavior. |
| Debug-auth integration fixture is stale | debug_auth.test.js:90-153 lacks the repository method used by boards.js:37. | Replace it with the shared contract fixture and restore the suite to green. |

## Suggested implementation sequence

### Phase 0 — Restore trustworthy feedback

1. Fix the stale debug-auth fixture and the adjacent event/revision defects.
2. Add root checks and run them before deployment.
3. Add measurements for Mongo query count/bytes, response size, migration count/time, render work, and AI upstream calls.

### Phase 1 — Low-risk hot-path reductions

1. Combine actor-facing extras into one repository read.
2. Query the canonical home _id first, add reviewed indexes, and narrow projections.
3. Add a current-schema fast path and lazy diagnostic field builders.
4. Split browser entries/catalogs and lazy-load EasyMDE.
5. Add shared OpenAI deadlines/output bounds and shared JSON transport.
6. Avoid rendering closed dialogs and hoist per-board/per-card derived indexes.

### Phase 2 — Atomic operations and coherent rendering

1. Introduce one atomic card-editor command.
2. Define the shared server/browser presentation model.
3. Hydrate/reconcile SSR and implement keyed incremental board updates.
4. Materialize and paginate portfolio projections.
5. Extract the mutation executor and split the largest modules behind existing contracts.

### Phase 3 — Remove full-snapshot amplification

1. Add revisioned command deltas to API responses.
2. Move persistence to targeted updates or normalized entities if measured growth justifies it.
3. Add durable AI operation/job state with unique idempotency reservations and source fingerprints.

## Acceptance criteria for the improvement program

- A normal GET /boards performs one viewer-context candidate query plus at most one selected full-record load; it does not scan the entire collection twice.
- A current-schema command does not re-run legacy migration at each record helper.
- A multi-field card save makes one request, one revision increment, and either applies all fields or none.
- Landing and portfolio do not request workspace/editor modules; a read-only workspace does not request EasyMDE.
- Stimulus connection does not replace already-correct server card nodes.
- A one-card mutation does not recreate or re-sanitize unrelated cards.
- Portfolio queues are paginated and do not require loading every full workspace into application memory.
- Concurrent identical AI operations make one upstream request.
- All app/tooling tests pass and the deployment job is gated on them.

## Deliberate non-priorities

- LocalWorkspaceRepository clone cleanup is valid but lower priority because the current server-rendered app uses HttpWorkspaceRepository and local storage is primarily an import path.
- CSS selector consolidation and production minification improve ownership/bytes modestly but should not displace route splitting or snapshot work.
- Multi-app optimization of the repository-local generators should wait until their measured runtime becomes material.

This report is an implementation backlog, not a claim that every item must be completed. Start with instrumentation and the P0 path reductions, then use production data to decide how far to take storage normalization and read-model materialization.

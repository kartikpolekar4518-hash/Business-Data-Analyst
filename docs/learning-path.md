# Learning Path — becoming the engineer who can build NoPS unaided

This is not a generic "learn to code" list. It is the exact set of skills the
NoPS codebase actually uses, ordered so each tier makes the next one learnable,
with a graduation test per tier written against real files in this repo.

The target is specific and measurable: **you can delete any file in `apps/`,
and rewrite it from a blank editor, from your own understanding, with no AI and
no copying — and the test suite goes green.**

---

## 0. How to study (this part decides whether the rest works)

Six rules. They matter more than the syllabus.

1. **Build-first, theory-second.** Never study a topic you have no immediate use
   for. Learn `JOIN` the week you need a query across `Dataset` and
   `Organization`, not from a SQL book cover-to-cover.
2. **The no-AI rep is the only rep that counts.** Reading AI-written code feels
   like learning and isn't — it's recognition, not recall. Every tier below has
   a "graduation test" you do with the internet limited to official docs.
3. **Delete and rebuild.** The highest-yield exercise in this repo:
   `git rm apps/api/src/engine/forecast.ts`, then make
   `forecast.test.ts` pass again from scratch. The tests are the spec. This is
   why the test suite is your most valuable asset as a *learner*, not just as a
   maintainer.
4. **Explain it out loud.** If you cannot say in plain English why
   `splitPeriods` compares equal *durations* rather than equal *row counts*,
   you don't own that code yet. (The answer is in `comparison.test.ts` and the
   README — at a constant price per row, equal row counts make revenue change
   impossible by construction.)
5. **Read more code than you write.** Specifically: read Express's source,
   Prisma's generated client, and one well-run open-source TS project end to end.
6. **Cadence beats intensity.** 2 focused hours daily for 18 months beats
   12-hour weekends. This path is a ~18–24 month path to genuine independence,
   with real productivity from month 3.

---

## Tier 1 — The foundation layer (weeks 1–8)

Non-negotiable. Everything above collapses without it.

### 1.1 JavaScript, the language
Not "JS syntax" — the semantics that cause real bugs in this repo.

- Values vs. references; what `===` compares for objects.
- `undefined` vs `null` vs missing key — this repo's `Row` type is
  `Record<string, unknown>`, so this distinction *is* the data-quality engine.
- Closures and scope; why a callback captures a stale variable.
- The event loop: call stack, macrotask queue, microtask queue. You must be able
  to predict the print order of a `setTimeout` + `Promise.then` + sync log.
- `Promise`, `async`/`await`, `Promise.all` vs sequential await, error
  propagation through async chains, unhandled rejections.
- Prototypes and `this` binding (you'll meet it in library internals).
- Array methods as data pipeline: `map`/`filter`/`reduce`/`flatMap`/`sort`.
  `sort` mutates and is lexicographic by default — a classic source of wrong
  numbers in analytics code.
- Numbers: IEEE-754 floats, `0.1 + 0.2`, `Number.EPSILON`, when to use integers
  (cents) instead. Directly relevant: every KPI in `engine/analytics.ts`.
- Dates: `Date` is UTC-vs-local trap central. Your comparison windows depend on
  getting this exactly right — see `Date.UTC` usage in `comparison.test.ts`.

**Resources:** *JavaScript: The Definitive Guide* (Flanagan) or MDN's JS guide
end to end; *You Don't Know JS Yet* (Simpson) for scope/closures/types.

**Graduation test:** implement, without help — a deep-equal function, a
`groupBy`, a debounce, a promise pool with concurrency limit, and a function
that sums an array of decimal strings with no float error.

### 1.2 TypeScript, properly
This repo is 100% TS with `strict` on. Half-knowing TS means fighting it forever.

- Structural typing (why TS is *not* Java) — types describe shapes, not names.
- Unions, intersections, literal types, discriminated unions. `ForecastResult.method`
  should teach you why a union of string literals beats `string`.
- Generics: type parameters, constraints (`extends`), inference, `keyof`,
  indexed access `T[K]`, `typeof`.
- Narrowing: type guards, `in`, `instanceof`, custom `x is T` predicates,
  exhaustiveness checks with `never`.
- Utility types: `Partial`, `Pick`, `Omit`, `Record`, `ReturnType`, `Awaited`.
- Declaration files, `@types/*`, module resolution, `"type": "module"` and ESM
  vs CommonJS (why imports here end in `.js` even though the files are `.ts`).
- `unknown` vs `any` — and why parse boundaries must produce `unknown`.
- Runtime validation vs compile-time types: this is why `zod` is a dependency.
  Types vanish at runtime; a CSV upload is `unknown` until validated.

**Resources:** the TypeScript Handbook (all of it), *Effective TypeScript*
(Vanderkam) — this book is the single highest-leverage read on this list.

**Graduation test:** write the type signature for a function that takes a
`SchemaMap` and a `Row[]` and returns only the numeric columns, typed so that
misusing the result is a compile error. Then remove every `any` and every
non-null `!` from a file in `apps/api/src/engine/` without loosening behaviour.

---

## Tier 2 — The runtime and the backend (weeks 6–20)

### 2.1 Node.js as a runtime
- Module systems, `package.json` fields, workspaces (this repo is an npm
  workspace monorepo — `apps/api` and `apps/web`).
- The filesystem and streams API; why streaming an upload beats buffering it.
- `Buffer` and encodings — you hash raw bytes for `rawFileHash`.
- `process.env`, config loading, the twelve-factor config idea (`src/env.ts`).
- Child processes, worker threads, and *when CPU-bound work blocks the loop* —
  relevant the day a 500k-row upload freezes your server.
- The built-in test runner (`node:test`) — this repo uses it directly, no Jest.
- `crypto`: SHA-256, HMAC, `timingSafeEqual`. `engine/crypto.ts` and the
  constant-time login in your security commits use exactly this.

### 2.2 HTTP and the web platform
You cannot design an API without this; it is the physics of your product.

- The request/response model, methods, status codes (and which one to actually
  return — 400 vs 401 vs 403 vs 404 vs 409 vs 422 vs 429).
- Headers: content type, caching (`Cache-Control`, `ETag`), `Authorization`.
- Cookies vs bearer tokens; `HttpOnly`, `Secure`, `SameSite`.
- CORS: preflight, credentials, why `origin: *` and cookies are incompatible.
  You have `cors` in the dependency list — know precisely what it configures.
- TLS: what a certificate proves, what a CA bundle is, why disabling
  verification (which one of your commits gated) breaks the entire guarantee.
- Multipart form uploads (`multer`), content-length limits, and why an
  unbounded upload endpoint is a denial-of-service hole.
- Rate limiting, idempotency, pagination, long-running requests.

**Resources:** MDN HTTP docs; *HTTP: The Definitive Guide* for depth; the
OWASP cheat sheets for the security-adjacent parts.

### 2.3 Express and API design
- Middleware as a pipeline; `next()`; error-handling middleware's 4-arg
  signature; ordering effects (auth before routes, error handler last).
- Routers, params, query parsing, body parsing.
- Centralised error shape — you already have `src/errors.ts`; understand why
  leaking stack traces or ORM errors to a client is an information leak.
- REST resource modelling, versioning, backwards compatibility.
- Request validation at the boundary with `zod`, before anything touches the DB.

**Graduation test:** delete `apps/api/src/auth/middleware.ts` and
`apps/api/src/auth/routes.ts` and rebuild them so `middleware.test.ts` passes:
signup, login, JWT issue/verify, role checks, org scoping, password reset with
hashed tokens.

### 2.4 Databases, SQL, and Prisma
The part most self-taught developers stay weak at forever. Don't.

- **Relational modelling:** entities, keys, foreign keys, 1-N and N-N, and
  normalisation to 3NF — then when to denormalise deliberately.
- **SQL by hand,** not through the ORM: `SELECT`, `WHERE`, `GROUP BY`,
  `HAVING`, all four `JOIN`s, subqueries, CTEs, window functions
  (`ROW_NUMBER`, `LAG`, `SUM() OVER`). Window functions are how real analytics
  products compute period-over-period in the database instead of in Node —
  learning them will eventually change your architecture.
- **Indexes:** B-tree structure, composite index column order, covering
  indexes, why an index on `organizationId` is mandatory in a multi-tenant app,
  and how to read `EXPLAIN ANALYZE`.
- **Transactions:** ACID, isolation levels, what a "dirty read" and a
  "phantom read" actually are, deadlocks, optimistic vs pessimistic locking.
- **Postgres specifics:** types (`jsonb`, `numeric` vs `float` — use `numeric`
  for money), `generate_series`, `date_trunc`, partial indexes, connection
  pooling limits.
- **Prisma:** schema DSL, relations, migrations (`migrate dev` vs
  `migrate deploy` — the difference matters the day you have production data),
  the generated client's types, `select`/`include`, N+1 query problem,
  `$transaction`, raw queries and when to drop to them.
- **Migrations discipline:** forward-only, reversible, zero-downtime patterns
  (expand → backfill → contract). This is the skill that prevents your first
  real outage.

**Resources:** *SQL for Smarties* is optional; do practical work instead —
`pgexercises.com` end to end, then *Designing Data-Intensive Applications*
(Kleppmann) chapters 1–4 and 7. DDIA is the most important book on this
entire list; read it slowly, twice, over a year.

**Graduation test:** write, in raw SQL against your own schema, a query that
returns per-organization monthly revenue with the previous month's value and
percent change in the same row — using a window function, no application code.
Then explain its query plan.

---

## Tier 3 — The frontend (weeks 12–26, in parallel)

### 3.1 The browser platform
- The DOM, event bubbling/capture, delegation.
- CSS you actually need: the box model, flexbox, grid, stacking contexts,
  specificity, `position`, media queries, and *why* Tailwind's utility approach
  is a bet on locality over abstraction.
- The rendering pipeline: layout → paint → composite; what causes reflow;
  why animating `transform`/`opacity` is cheap and animating `top` is not
  (directly relevant to your `framer-motion` usage).
- Accessibility: semantic HTML, focus management, keyboard navigation, ARIA
  only where semantics run out, contrast. A B2B product that fails a
  procurement accessibility review loses the deal — this is commercial, not
  charity.
- Browser storage: `localStorage` vs cookies vs memory, and where a JWT should
  actually live (and the XSS trade-off in that choice).

### 3.2 React (v19, as used here)
- Components, props, composition over inheritance.
- State: `useState`, `useReducer`, lifting state, derived state (and why
  storing derived state is the #1 React bug).
- `useEffect` — the correct mental model is *synchronising with an external
  system*, not "run after render". Most `useEffect` in most codebases should
  not exist. Learn the dependency array, cleanup, and the effect-vs-event
  distinction cold.
- Rendering and reconciliation, keys, `memo`, `useMemo`, `useCallback` — and
  measuring before optimising.
- Context, and why it is not a state manager.
- Refs, portals, error boundaries, Suspense.
- Server state ≠ client state: this is why `@tanstack/react-query` exists.
  Learn query keys, staleness, cache invalidation, optimistic updates.
- Routing: `react-router` v7 — nested routes, loaders, URL as state. Your
  analytics filters live in the URL; understand why that's the right call
  (shareable views, back-button correctness, no state duplication).

**Resources:** react.dev's full learn track (it's genuinely excellent — do all
the challenges), then Dan Abramov's *A Complete Guide to useEffect* and
*Overreacted* archive.

### 3.3 Data visualisation
- Recharts' composition model and its escape hatches.
- Underneath it: SVG coordinates, scales (linear/time/ordinal), axes, ticks.
  Learn enough D3-scale to build a chart from scratch once — after that
  every charting library is legible to you.
- Visual honesty: truncated axes, dual axes, colour that survives colour
  blindness, when a table beats a chart.

**Graduation test:** rebuild one dashboard page in `apps/web/src/pages/` from
scratch — data fetching, loading/error/empty states, filters synced to the URL,
a chart, and keyboard-accessible controls.

---

## Tier 4 — Your actual moat: the analytics engine (months 4–12)

**This is the tier that decides whether NoPS is a product or a CRUD app.**
Anyone can build auth and file upload. Almost nobody can build a correct,
auditable, deterministic analytics engine. Spend disproportionate time here.

### 4.1 Statistics — the real prerequisite
- Descriptive: mean, median, mode, variance, standard deviation, and *when the
  mean lies* (skewed revenue distributions — almost always, in business data).
- Quantiles and percentiles, and the several different interpolation
  definitions (you have `engine/quantiles.ts` — know which definition you chose
  and why, because two "p90"s can differ).
- Distributions: normal, log-normal, Poisson, power law. Business revenue is
  usually log-normal or power law, which is why outlier rules built on
  normality misfire.
- Outlier detection: z-score, modified z-score (MAD), IQR fences. Know each
  one's failure mode — this is `engine/anomaly.ts`.
- Correlation: Pearson vs Spearman, correlation ≠ causation, spurious
  correlation from trend, confounders. `engine/correlate.ts` must never imply
  causation in its wording — that's a product-integrity issue, not a nicety.
- Hypothesis testing basics, confidence intervals, and what a 95% band means
  (your `forecast.ts` emits one — you must be able to defend it to a CFO).
- Sampling bias, Simpson's paradox, survivorship bias. A dashboard that
  reverses its conclusion when segmented is a Simpson's paradox demo.

**Resources:** *Practical Statistics for Data Scientists* (Bruce) — best fit
for your use. Then *Statistics Done Wrong* (Reinhart) for the failure modes,
and *How to Lie with Statistics* (Huff) as a checklist of what not to ship.

### 4.2 Time series and forecasting
- Trend, seasonality, cycles, residuals; additive vs multiplicative decomposition.
- Stationarity and differencing; autocorrelation (ACF/PACF).
- Methods, in the order they should be tried: naive/seasonal-naive baseline →
  moving average → linear regression on time → exponential smoothing (SES,
  Holt, Holt-Winters) → ARIMA/SARIMA → gradient-boosted or ML methods.
  **Always baseline first.** A forecast that doesn't beat seasonal-naive is
  worse than useless, because it's confidently wrong.
- Backtesting: rolling-origin / walk-forward validation, train-test splitting
  for time series (never random splits), horizon-dependent error.
- Error metrics: MAE, RMSE, MAPE (and why MAPE explodes near zero and is
  asymmetric), sMAPE, MASE. Choosing the metric *is* choosing the model.
- Prediction intervals: residual-based bands, why they widen with horizon, and
  why they are almost always too narrow in practice.

**Resources:** *Forecasting: Principles and Practice* (Hyndman & Athanasopoulos)
— free online, the definitive practical text. Read all of chapters 1–9.

**Graduation test:** delete `engine/forecast.ts` and rebuild it against
`forecast.test.ts`: baseline, linear regression, additive seasonal, model
selection by backtest, residual-based 95% band. Then write a one-page memo
justifying every choice to a sceptical finance director.

### 4.3 Data engineering
- CSV is not a format, it's a family of dialects: quoting, escaping, embedded
  newlines, BOM, encodings, delimiter sniffing. Read the papaparse source.
- Excel is worse: serial-number dates, 1900 leap-year bug, floats that display
  as integers, merged cells, multiple sheets. Your README already documents the
  CSV-vs-XLSX hash divergence — that honesty is a strength; understanding the
  cause deeply is how you eventually fix it (canonical typed coercion at ingest).
- Type inference and schema detection: what makes a column a date vs a string
  vs an ID; why `"01234"` must not become `1234`.
- Data quality dimensions: completeness, uniqueness, validity, consistency,
  accuracy, timeliness. Your quality engine should map to these explicitly.
- Idempotency and lineage: same input → same dataset id; recording *which*
  inputs produced an output (you do this) vs replaying them (you correctly say
  you don't).
- Streaming vs batch; chunked parsing; memory limits on large uploads.

### 4.4 Determinism and reproducibility as an engineering discipline
This is your product's central claim, so treat it as a first-class skill.

- Sources of nondeterminism: hash/map iteration order, floating-point
  associativity, `Date.now()`, `Math.random()`, locale/timezone, concurrency,
  library version drift.
- Canonicalisation: stable key ordering, normalised number formatting, explicit
  UTC. You already canonicalise rows for `datasetHash` — know exactly what that
  guarantees and what it doesn't.
- Content addressing and Merkle-style hashing; engine versioning; calculation
  fingerprints.
- Property-based testing (see Tier 5) is how you *prove* determinism instead of
  asserting it.
- Read about reproducible builds (Nix, Bazel) — the ideas transfer directly.

---

## Tier 5 — Correctness: testing and types (continuous, start month 2)

- The pyramid: unit → integration → end-to-end, and the right ratio. This repo
  already splits `*.test.ts` (unit) and `*.itest.ts` (integration against real
  Postgres in CI) — that's the right shape.
- Writing tests as *specification*: `comparison.test.ts` is a written policy
  document that executes. Learn to write tests that read like requirements.
- Test doubles: stub vs mock vs fake vs spy; why mocking the database usually
  produces tests that pass while production breaks.
- Fixtures and factories; deterministic seed data.
- **Property-based testing** (`fast-check`): instead of "August compares to
  July", assert "for all date ranges, previous window duration === current
  window duration". This is the single biggest testing upgrade available to
  your engine. Add it.
- Snapshot testing — and its trap (approving wrong output).
- Mutation testing (Stryker) to measure whether your tests actually detect bugs.
- Coverage as a diagnostic, never a target.
- **Frontend testing is your current gap:** `apps/web` has no test runner.
  Learn Vitest + React Testing Library + Playwright for E2E, and close it.
- Debugging as a discipline: Node inspector, breakpoints, `--inspect-brk`,
  React DevTools profiler, bisecting with `git bisect`, minimal reproductions.

**Graduation test:** add `fast-check` to the API, and write property tests for
`splitPeriods`, the quantile function, and the dataset hash canonicaliser.

---

## Tier 6 — Computer science that actually pays off (months 6–18)

Skip the interview-grinding framing; learn these because your engine needs them.

- **Complexity:** Big-O for time and space, amortised analysis. Your analytics
  code does nested passes over rows; know when you've written an accidental
  O(n²) over a 500k-row upload.
- **Data structures:** arrays, hash maps, sets, linked lists, stacks, queues,
  heaps (top-K rankings — your product ranks constantly), trees, tries, graphs.
  Know the real cost of each operation, and JS's actual implementations.
- **Algorithms:** sorting (and stability — matters for tie-breaking rankings),
  binary search, two pointers, sliding window (time-series windows!), grouping
  and aggregation, streaming algorithms (running mean/variance via Welford —
  use it, naive variance loses precision), reservoir sampling, approximate
  quantiles (t-digest) for when exact ones stop fitting in memory.
- **Recursion and dynamic programming** — lighter priority for you.
- **Concurrency:** race conditions, locks, idempotency, at-least-once vs
  exactly-once delivery. Relevant to `scheduler.ts` — a scheduled report must
  not double-send.
- **Numerical computing:** catastrophic cancellation, summation error and
  Kahan/Neumaier summation, condition number. If you sum a million revenue
  floats naively, your "deterministic" total is deterministically slightly wrong.
- **Systems basics:** processes vs threads, memory model, GC and heap pressure
  in V8, file descriptors, sockets, DNS. Enough to read a stack trace and a
  `top` output and know what's happening.
- **Compilers, lightly:** lexing/parsing/AST. You have an intent parser
  (`engine/intent.ts`) — that *is* a small language. Learning parsing properly
  turns your regex-based fallback parser into a real grammar, which is both
  more capable and more auditable than an LLM path.

**Resources:** *Grokking Algorithms* to start, *The Algorithm Design Manual*
(Skiena) for depth, *Computer Systems: A Programmer's Perspective* for the
systems layer (heavy, worth it, do it slowly).

---

## Tier 7 — Architecture and design (months 8–20)

- **Design principles that survive scrutiny:** cohesion and coupling,
  separation of concerns, dependency inversion, composition over inheritance,
  YAGNI. Your repo's split — `engine/` (pure, testable, no I/O) vs `modules/`
  (HTTP + DB) — is already the right instinct. Learn to name and defend it:
  **functional core, imperative shell.** Protect that boundary religiously; it
  is why your engine is unit-testable at all.
- Design patterns — learn to *recognise* them, resist applying them
  speculatively (your CLAUDE.md already says no speculative abstractions).
- Domain modelling: ubiquitous language, bounded contexts, value objects vs
  entities. From DDD, take the modelling, skip the ceremony.
- API design: REST maturity, versioning, deprecation policy, error taxonomies,
  webhooks, and when GraphQL or tRPC would actually help you (probably tRPC,
  given a single TS client).
- **Multi-tenancy architecture:** shared-schema-with-tenant-column (what you
  have) vs schema-per-tenant vs database-per-tenant. Know the migration path,
  and that enterprise buyers will eventually demand isolation guarantees.
- Caching: layers (browser, CDN, app, DB), invalidation strategies, cache keys
  that must include `organizationId` (a cache key missing the tenant is a data
  breach).
- Background jobs and queues: BullMQ/Redis, retries with backoff, dead-letter
  queues, idempotent handlers. Your `scheduler.ts` will outgrow in-process
  scheduling the moment you run two instances.
- Scaling: vertical vs horizontal, statelessness, sticky sessions, read
  replicas, connection pooling (PgBouncer), sharding by tenant. Do none of this
  early; know all of it before you need it.
- Event-driven patterns, outbox pattern, eventual consistency, CQRS — read
  about them, apply almost none of them yet.
- **Writing design docs and ADRs.** Every significant decision gets a one-page
  record: context, options, decision, consequences. This is how a solo
  founder's judgement becomes a company's institutional memory.

**Resources:** DDIA (again — it is the architecture book), *A Philosophy of
Software Design* (Ousterhout, short and excellent), *Software Engineering at
Google* for how process scales.

---

## Tier 8 — Security (months 6 onward, continuous)

You store other companies' business data. Security is existential, not optional.

- **OWASP Top 10**, each item, with a working exploit and fix in a sandbox.
- **AuthN vs AuthZ.** Password hashing (bcrypt cost factors, why not SHA),
  constant-time comparison, credential-stuffing defence, account enumeration
  (your login timing work), password reset token hashing + expiry + single use,
  session invalidation on password change.
- **JWT specifically:** signing vs encryption, `alg: none` attack, key
  rotation, why you cannot revoke a stateless JWT, access + refresh token
  patterns, safe storage in the browser.
- **Multi-tenant authorization — your highest-risk area.** Every query must be
  tenant-scoped; the failure mode is silently serving org A's revenue to org B.
  Learn: deny-by-default, centralised policy enforcement, and **row-level
  security in Postgres** as defence in depth so a forgotten `where` clause
  cannot leak data. Write tests that specifically attempt cross-tenant access.
- **Injection:** SQL injection (and why Prisma's parameterisation protects you
  until you write raw SQL), formula injection in CSV exports (`=cmd|...` in a
  cell — very real for an export feature), path traversal, SSRF (your DB
  connectors accept user-supplied hosts — that is an SSRF surface: block
  private IP ranges and metadata endpoints).
- **XSS** and CSP; React escapes by default, `dangerouslySetInnerHTML` doesn't.
- **File upload security:** type sniffing vs extension trust, size caps (you
  added a row cap), zip bombs, malicious spreadsheets, storing uploads outside
  the web root.
- **Secrets management:** never in git (your gitleaks CI), env vars vs a secret
  manager, rotation, least privilege.
- **Transport and infra:** TLS everywhere, HSTS, security headers (helmet),
  rate limiting (you have it), DoS via expensive queries.
- **Dependency security:** `npm audit`, lockfile integrity, supply-chain
  attacks, pinning, Dependabot/Renovate.
- **Compliance, when enterprise buyers arrive:** SOC 2 Type II, GDPR (lawful
  basis, DSARs, deletion, data residency), DPAs, audit logging, retention
  policy, breach notification. This is the difference between selling to a
  10-person shop and a bank.

**Resources:** OWASP cheat sheets (all of them, over time), *The Web
Application Hacker's Handbook*, PortSwigger's free Web Security Academy — do
its labs, they're hands-on and excellent.

---

## Tier 9 — Operations: shipping and keeping it up (months 8–18)

- **Git properly:** branching, rebase vs merge, interactive rebase, cherry-pick,
  bisect, reflog (your undo button), conflict resolution, writing commit
  messages that explain *why*. Your history is already good — keep it.
- **Linux and the shell:** filesystem, permissions, processes, signals,
  `systemd`, `ps`/`top`/`htop`, `lsof`, `netstat`/`ss`, `journalctl`, `curl`,
  `jq`, `grep`/`sed`/`awk`, ssh keys, cron.
- **Docker:** images vs containers, layers and caching, multi-stage builds,
  volumes, networks, compose (you have `docker-compose.yml`), image size and
  security, non-root users.
- **CI/CD:** GitHub Actions in depth — jobs, services (your Postgres service
  container), caching, matrices, secrets, permissions and least-privilege
  `GITHUB_TOKEN`, reusable workflows. Then: deployment strategies (blue/green,
  canary, rolling), feature flags, migration-safe deploys.
- **Hosting:** understand the ladder before choosing — PaaS (Render/Fly/Railway)
  → containers on a VM → managed Kubernetes. Pick the lowest rung that works;
  most SaaS never needs Kubernetes. Learn what a load balancer, reverse proxy
  (nginx/Caddy), and CDN each do.
- **Observability — you are currently flying blind here:**
  - *Structured logging* (pino), correlation IDs per request, log levels, never
    logging PII or customer data rows.
  - *Metrics* (Prometheus/OpenTelemetry): the RED method (rate, errors,
    duration) per endpoint; the four golden signals.
  - *Tracing* for slow requests across API → DB.
  - *Error tracking* (Sentry) with source maps.
  - *Alerting* on symptoms users feel, not causes; on-call and runbooks.
- **Reliability:** SLIs/SLOs/error budgets, graceful degradation, timeouts and
  retries with jitter, circuit breakers, health checks, **backups you have
  actually restored from** (an untested backup is not a backup), disaster
  recovery drills, postmortems without blame.
- **Performance:** measure first — profiling Node (`--prof`, clinic.js), flame
  graphs, DB slow query logs, Lighthouse and Core Web Vitals for the frontend,
  bundle analysis and code splitting for Vite.
- **Cost engineering:** unit economics per tenant, per-query cost, storage
  growth, egress. Know your gross margin per customer.

---

## Tier 10 — The product and business layer (continuous)

Technical mastery alone does not produce a large company. These are learnable
skills, not talents.

- **Product:** talking to users without leading them (*The Mom Test* — read it
  this month, it's short), problem vs solution interviews, JTBD, defining an
  ICP, ruthless scope control, the difference between a feature and a wedge.
- **Positioning:** why "deterministic, auditable analytics" is a *sales*
  argument in regulated industries — your differentiator is a compliance story,
  not a technical one. Read *Obviously Awesome* (Dunford).
- **Pricing and packaging:** per-seat vs usage vs tier, land-and-expand, why
  your `billing` module's model shapes your growth ceiling.
- **SaaS metrics:** MRR/ARR, churn (logo vs revenue), NRR, CAC, LTV, payback
  period, magic number. Know which one is currently your constraint.
- **Go-to-market:** founder-led sales for the first ~50 customers (there is no
  substitute and no automating it), pipeline, demos, security questionnaires,
  procurement, pilots and their conversion.
- **Onboarding and activation:** time-to-first-value. For you, that's
  upload → first correct dashboard. Every second there is worth more than a
  new feature.
- **Support as product intelligence:** every support ticket is a spec bug.
- **Legal and financial basics:** entity, cap table, contracts, IP assignment,
  terms of service, DPAs, insurance.
- **Hiring, later:** your first engineering hires inherit your standards. The
  test suite, the docs, and the ADRs *are* your onboarding.
- **Writing.** The single most underrated skill. Your README is already better
  than most Series-A products' docs — that honesty table ("Supported / No") is
  a genuine trust asset. Keep writing that way.

---

## What NOT to learn (yet)

Deliberate exclusions. Each of these is a common self-taught detour that costs
6+ months and returns nothing at your stage:

- Kubernetes, service meshes, microservices. You are one product with two
  services. A monolith with a clean internal boundary is correct.
- Rust/Go/another backend language "for performance." Your bottleneck is
  Postgres and algorithm choice, not V8.
- Training your own ML models. Your differentiator is explicitly *not* ML.
- Blockchain, WebAssembly, edge runtimes, event sourcing, CQRS.
- Leetcode grinding. You're not interviewing; do the algorithms in Tier 6
  because your engine needs them.
- Rewriting the frontend in another framework.
- Reading a compiler textbook cover to cover before writing a parser.

Revisit any of these only when a concrete, measured problem demands it.

---

## Suggested sequencing

| Months | Primary focus | Secondary |
|---|---|---|
| 1–2 | JS semantics + TypeScript strict | Git, shell, HTTP basics |
| 3–4 | Node, Express, API design, zod | React fundamentals |
| 5–6 | SQL + Postgres + Prisma migrations | Testing discipline, CI |
| 7–9 | Statistics + forecasting (Tier 4) | React Query, frontend testing |
| 10–12 | Data engineering + determinism | Security Top 10, DDIA part 1 |
| 13–15 | Algorithms/complexity for the engine | Observability, deployment |
| 16–18 | Architecture, multi-tenancy, scaling | Compliance, DDIA part 2 |
| 19+ | Depth wherever the product is hurting | Business/GTM continuously |

**Weekly shape:** ~10h. 4h building the product with no AI assistance,
3h structured study, 2h rebuilding an existing file from its tests, 1h reading
other people's code.

---

## The honest part

Two things are true at once.

**First:** this list is completable. Nothing here requires talent you either
have or don't. It requires roughly 2,000 focused hours, which at 10h/week is
about four years, or about two years at 20h/week. Every professional engineer
you admire went through a version of it. The codebase you already have is a
strong starting position — the `engine/` boundary, the tests-as-specification,
and the README's refusal to overclaim are all judgement calls that most
experienced engineers get wrong.

**Second:** technical mastery is necessary and not sufficient. Products become
large because they solve an urgent problem for people who can pay, distributed
through a channel that works. Bill Gates' advantage was not that he wrote the
best BASIC interpreter; it was the IBM licensing deal. Your engineering skill
determines whether NoPS is *good*; your customer conversations determine
whether it *matters*. Do not let the study plan become a way to avoid selling.

The highest-leverage thing you can do in any given week is usually one of:
talk to a real prospective customer, or delete a file and rebuild it from its
tests without help. Alternate.

<p align="center">
  <img src="docs/LogoTMWTP.svg" alt="TellMeWhatToPlay" width="220" />
</p>

<h1 align="center">TellMeWhatToPlay</h1>

<p align="center">
  AI-powered game recommendations through natural-language conversation.
</p>

<p align="center">
  <a href="#demo">Demo</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#local-development">Get started</a>
</p>

---

## Demo

<p align="center">
  <a href="https://youtu.be/7ljLRe9s_7E">
    <img src="docs/demo-thumbnail.jpg" alt="TellMeWhatToPlay demo video" width="720" />
  </a>
</p>

<p align="center"><em>Click the thumbnail to watch the demo.</em></p>

---

## What is TellMeWhatToPlay?

Store browsing makes it hard to find the next game you actually want to play. TellMeWhatToPlay replaces that flow with a single conversational interface: you describe what you feel like playing, in your own words, and it returns a ranked set of games with reasons that explain why each one is a match.

Two examples of the kind of input it understands:

> _"Something like Dark Souls, but less punishing."_

> _"A cozy game with good art for short sessions on the Switch."_

The service keeps the full-stack pipeline behind that interaction — intent recognition, catalog discovery, web-based enrichment and deterministic ranking — running as a single application.

---

## How it works

A user message flows through a pipeline where every step has one clearly defined responsibility:

```mermaid
flowchart LR
    A[User message] --> B[Relation classifier]
    B --> C{new / refine / unrelated}
    C -->|new| D[Intent extraction]
    C -->|refine| E[Refinement delta]
    C -->|unrelated| F[Reject]
    D --> G[Discovery]
    E --> G
    G --> H[Enrichment]
    H --> I[Deterministic matching]
    I --> J[Ranking]
    J --> K[Explanation]
    K --> L[Ranked results]
```

**AI responsibilities** (OpenAI via LangChain, constrained by Structured Output):

- Classify whether the message starts a new search, refines the previous one, or is unrelated to games.
- Extract a structured search intent (genres, themes, platforms, keywords, release year, 13 semantic dimensions).
- Extract a refinement delta when the user adjusts an existing search.
- Enrich newly discovered games using web research — descriptions plus semantic attributes.
- Compose a conversational explanation of why each result was chosen.

**Deterministic responsibilities** (pure code, no LLM):

- Filter games against hard constraints: must-have genres, keywords, platforms, year, and explicit exclusions.
- Score semantic alignment across 13 dimensions (pacing, darkness, coziness, tension, humor, and more).
- Rank candidates into tiers (`excellent` / `valid` / `invalid`) with per-result contribution scores.
- Canonicalize keywords against a local vocabulary using embeddings.
- Auth, session management, pagination, and caching.

The LLM never decides which games are shown. It interprets what the user asked and explains what was chosen; the choice itself is made by deterministic, testable logic.

---

## Architecture

```
Frontend (Next.js 16 · React 19 · Tailwind CSS 4)
│  App Router · SSE streaming · same-origin API proxy
▼
Fastify 5 API (Node 22 · TypeScript)
│
├─ Routes: HTTP + SSE contracts, request validation
├─ Orchestrator: intent → discovery → matching → response
│    ├─ DiscoveryManager: IGDB search, catalog growth, enrichment
│    ├─ Matching engine: pure, deterministic filter + score
│    ├─ Ranker: tier assignment
│    └─ Explainer: LLM explanation with template fallback
├─ Services: enrichment, research, keyword lexicon, auth, user library
├─ Repositories: Prisma behind CatalogLayer interface
└─ Discovery cache + pagination offset store (in-memory, interface-based)

PostgreSQL 18 · Prisma 7 · keyword_lexicon (embeddings)
```

Key boundaries:

- **Routes** only translate HTTP/SSE to application calls and validate requests. No business logic.
- **The orchestrator depends on interfaces, never on concrete implementations.** It receives an `IntentExtractor`, a `CatalogLayer`, a `DiscoveryManager`, and an `ExplanationComposer`. This is what makes the pipeline testable without Prisma, HTTP, or a real LLM.
- **Matching is a pure function**: `intent + game → score + reasons`. Identical inputs produce identical outputs; there is no nondeterminism to debug.
- **Discovery is owned by components behind interfaces.** The IGDB client, the discovery cache, and the pagination offset store are all replaceable implementations of small contracts — the in-memory versions can be swapped for distributed stores without touching callers.
- **Repositories isolate the database.** Prisma queries are contained in one layer; domain types never leak through.

---

## AI integration

AI is used only where natural-language understanding is genuinely required, and every integration is a bounded, verifiable boundary.

| Purpose                                            | Model                  | Mechanism                                 |
| -------------------------------------------------- | ---------------------- | ----------------------------------------- |
| Relation classification (new / refine / unrelated) | gpt-4o-mini            | Structured Output, strict schema          |
| Search intent extraction                           | gpt-4o-mini            | Structured Output, strict schema          |
| Refinement delta extraction                        | gpt-4o-mini            | Structured Output, strict schema          |
| Game enrichment (web-assisted)                     | gpt-4o-mini            | Structured Output + Brave Search research |
| Result explanation                                 | gpt-4o-mini            | Free-form text + template fallback        |
| Keyword normalization                              | text-embedding-3-small | Embeddings + local canonical vocabulary   |

Design choices worth noting:

- **The recommendation decision is intentionally not AI.** Matching and ranking stay deterministic so the system is reproducible, cheap, and debuggable. AI interprets the request and explains the outcome; it does not pick the winners.
- **Language understanding is constrained by schema.** Every model call uses strict Structured Output, so the model can only emit data that already fits the application's TypeScript types. Parsing failures are effectively eliminated at the API boundary.
- **The keyword vocabulary is closed.** User terms are matched against a canonical dictionary seeded from IGDB through embeddings; unknown terms are dropped with a trace, never invented. The catalog and the matching logic cannot drift.
- **Prompt injection is treated as a real threat.** The intent-extraction prompt instructs the model to behave as an interpreter rather than a recommender and to refuse content unrelated to game search.

---

## Tech stack

| Layer          | Technology                                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| Frontend       | Next.js 16 · React 19 · Tailwind CSS 4 · TypeScript                                   |
| Backend        | Fastify 5 · Node.js 22 · TypeScript                                                   |
| Database       | PostgreSQL 18 · Prisma 7 (6 migrations)                                               |
| AI             | OpenAI (gpt-4o-mini, text-embedding-3-small) via LangChain                            |
| External APIs  | IGDB (catalog) · Brave Search (enrichment research)                                   |
| Auth           | Google OAuth 2.0 · JWT (15 min) · session + refresh tokens in httpOnly cookies (24 h) |
| Testing        | Vitest (unit / integration / E2E) · v8 coverage · Testing Library                     |
| Infrastructure | Docker Compose · GitHub Actions CI                                                    |
| Tooling        | ESLint · Prettier · tsx                                                               |

---

## Engineering decisions

**Dependency injection over frameworks.** The orchestration layer consumes interfaces, not concrete modules. This allowed the whole recommendation pipeline — including the classifier and the LLM extraction — to be exercised in tests with hand-written fakes instead of mocking libraries. External systems enter the composition root only (`orchestrator/index.ts`).

**Deterministic matching, separate from the LLM.** The matching engine is a pure function with no I/O. Every result is reproducible and carries explicit, per-dimension contribution scores. This makes the "why" of a recommendation auditable and keeps the hot path fast and cheap — LLM calls are reserved for the edges (input understanding, enrichment, explanation).

**Relation classification before intent extraction.** A message is first classified as new / refine / unrelated. Only then is intent extracted or a delta applied. This avoids burning an extraction call on unrelated input and lets refinement operate on changes to the previous intent rather than re-interpreting the whole conversation.

**Graceful degradation at every external call.** Each LLM and API call has a timeout and a fallback: explanation retries and then falls back to a deterministic template; a failed enrichment skips that candidate and continues; if the AI layer is entirely unavailable, the endpoint answers `503` with a clear message instead of crashing.

**Closed, conservative keyword lexicon.** The vocabulary is sourced only from IGDB and updated by explicit tooling. This keeps every filter comparable across the catalog and prevents low-quality or invented keywords from degrading recommendations over time.

**Testable state, made explicit.** Cross-request pagination offsets and the discovery cache are small, interface-based stores with in-memory implementations. Their contracts are trivial enough to reason about, yet clearly marked as swappable for shared storage if the service ever runs multi-process.

---

## Testing & Quality

Three tiers, one runner (Vitest):

| Tier                  | Scope                                                              | Isolation                                 |
| --------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| Unit (27 files)       | Matching, intent service, IGDB normalizers, lexicon, lib utilities | In-memory fakes · no DB · no network      |
| Integration (5 files) | Discovery pipeline, catalog writes, orchestration                  | PostgreSQL test database · mocked LLM/API |
| E2E (6 files)         | Full HTTP lifecycle through Fastify                                | In-process server on a free port          |

Current state:

- **Backend: 543 tests** across 38 files.
- **Frontend: 25 tests** across 2 files targeting the recommendation state reducer and its hook.

Practices applied:

- **Fakes over mocks.** Hand-written test doubles via dependency injection keep tests resilient to implementation changes.
- **Type-level tests.** The keyword-branding boundary uses compile-time assertions (`@ts-expect-error`) to prove an invalid value cannot be assigned — the guard exists at compile time, not just at runtime.
- **Concurrency tests.** Race conditions around the discovery cache and library updates are explicitly exercised.
- **CI enforcement.** A real PostgreSQL 18 instance runs migrations and the full suite on every push and pull request.

---

## Security & Reliability

**Implemented:**

- Google OAuth 2.0 sign-in with JWT access tokens (15 min) and a 24-hour session: the refresh token and its httpOnly web cookie share the same 24 h TTL.
- Refresh-token rotation: every refresh invalidates the previous token; logout revokes the whole session.
- Role-based access (`USER` / `ADMIN`) mapped through a permissions table.
- Authorization derived from the verified token, never from client-supplied parameters.
- Request validation on every route (body, params, query) via Fastify schemas.
- Input sanitization before external API calls (query injection characters removed).
- Anti-prompt-injection guardrails on LLM prompts; model output constrained to strict schemas.
- Timeouts plus exponential-backoff retries on the IGDB client; fallbacks at every AI call site.

**Known production considerations — not yet implemented:**

- No rate limiting on public endpoints (the recommendation endpoint consumes paid external APIs per request).
- No dedicated security-headers middleware beyond Fastify defaults.
- In-memory discovery cache and pagination offsets are per-process; a multi-process deployment would need the swappable shared-store implementations to be wired in.

---

## Local Development

### Prerequisites

Node.js 22, PostgreSQL 18 and npm. Prefer Docker Compose if you have Docker available.

### Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
# Database
POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tellmewhattoplay
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/tellmewhattoplay

# Auth
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback  # proxied by Next.js rewrite
FRONTEND_URL=http://localhost:3000

# AI
OPENAI_API_KEY=your_openai_api_key

# External APIs
BRAVE_SEARCH_API_KEY=your_brave_api_key

# IGDB catalog API (Twitch credentials)
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
```

### Run

```bash
# Backend (port 3001)
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run dev

# Frontend (port 3000, separate terminal)
cd ../frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Tests

```bash
cd backend && npm test       # unit + integration + E2E
cd frontend && npm test      # frontend
```

---

## Docker

```bash
docker compose up
```

| Service    | Role                           |
| ---------- | ------------------------------ |
| `postgres` | PostgreSQL 18 with healthcheck |
| `migrate`  | Applies Prisma migrations      |
| `seed`     | Seeds roles and permissions    |
| `backend`  | Fastify API on port 3001       |
| `frontend` | Next.js app on port 3000       |

The frontend image is built with `API_URL=http://backend:3001` so API calls are proxied through the Next.js rewrite layer inside the Docker network.

---

## CI/CD

**Continuous integration (GitHub Actions)** runs on every push and pull request to `main`:

- **Backend job:** lint → build → Prisma migrations → full test suite against a PostgreSQL 18 service container.
- **Frontend job:** lint → build.

**Continuous deployment** is not configured yet. The Docker Compose setup is portable to any container platform, but no deploy pipeline exists in this repository.

---

## Project status

TellMeWhatToPlay is a working, full-stack SaaS application — not a mockup. It combines a real catalog (IGDB), web-assisted enrichment (Brave Search + OpenAI), conversational intent handling, a deterministic ranking engine, accounts with a game library, and a complete test suite and CI pipeline.

The engineering effort is concentrated where it matters most for a recommendation product:

- a pipeline whose every decision is explainable and testable;
- a clear separation between AI (interpreting language) and deterministic logic (deciding and ranking);
- an API and data layer designed to swap in-memory stores for distributed ones without changing callers;
- security and auth handled seriously from day one.

It was built as a demonstration of full-stack web engineering by a developer whose background is in game development (Unity/C#) and Android applications — evidence of the ability to reason about architecture, external APIs, machine-assisted products, and production-quality testing beyond that experience.

---

## License

No license is declared for this repository.

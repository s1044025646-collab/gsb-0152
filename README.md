# Rational Polynomial Real-Root Isolation & Signed Interval Analysis Backend

A Windows-local, offline backend for isolating **all distinct real roots** of a
univariate polynomial of **degree ≤ 12** whose coefficients are **exact
integers or fractions** (`"p/q"`). It is built with TypeScript + Node.js and
persists to an embedded SQLite database (Node's built-in `node:sqlite`, no
native compilation). It exposes a JSON HTTP API, a CLI, an algebraic example
generator, automated tests, and a repeatable demo.

There is **no web UI** and **no external computer-algebra/root service**. Every
root claim is produced by exact BigInt rational arithmetic.

## What it guarantees

- **Exact arithmetic only as evidence.** Rational numbers are normalized
  BigInt pairs (`src/core/frac.ts`). Decimal numbers are rejected on input;
  decimals appear only as clearly-labelled display hints.
- **No reliance on sign sampling or floating Newton iteration.** Roots are
  found and certified by:
  - polynomial division and gcd over `Q[x]` (`src/core/poly.ts`),
  - square-free decomposition giving each factor's **multiplicity**
    (`src/core/squarefree.ts`),
  - a canonical **Sturm sequence** with exact sign-variation counting
    (`src/core/sturm.ts`),
  - exact bisection that narrows every root into a disjoint rational interval
    of the requested width (`src/core/isolation.ts`).
  Even-multiplicity roots (which never change sign) are therefore never
  missed.
- **Disjoint rational intervals for every distinct real root**, each with its
  multiplicity and an exact justification ("why exactly one root is in this
  interval" or "the endpoint evaluates exactly to zero").
- **Endpoint semantics are explicit.** A rational endpoint that is exactly a
  root is emitted as a degenerate `[r,r]` `exact-root` interval and excluded
  from the adjacent open interval so it is never double counted.
- **Zero and constant polynomials.** The zero polynomial is recognized; its
  root set is the whole real line, so a finite root count is reported
  undefined (`422` / a dedicated error code) rather than "0". A non-zero
  constant has zero roots.
- **Budget safety.** You supply a target `maxWidth`, `maxIterations`, and
  `maxBits`. If either budget is exhausted before the target width is reached,
  the affected roots are kept as **`undecided` intervals**, and the proof
  explicitly refuses to claim that the root set is complete.
- **Versioning without overwrite.** Re-running analysis with revised
  parameters creates a new monotonic **version**; prior runs, intervals, and
  proofs are retained and can be compared.
- **Idempotency.** A client-supplied `requestKey` makes repeated submissions
  return the same stored result.
- **Proofs are not just decimals.** Each proof (`src/core/proof.ts`) records
  the Sturm chains, the square-free factors, an exact recomposition/divisibility
  check against the original polynomial, the per-interval justifications, and a
  completeness declaration.

## Requirements

- Node.js **>= 22.5** (developed/tested on Node 25; uses the built-in
  `node:sqlite` module, enabled with `--experimental-sqlite`).
- npm. All runtime code uses only the Node standard library; TypeScript/tsx are
  dev-time dependencies.

## Install

```powershell
npm install
```

## Build

```powershell
npm run build
```

Emits compiled JS to `dist/` (e.g. `dist/cli/cli.js`, `dist/api/server.js`).

## Run the API server (localhost only, automatic port)

```powershell
npm start
```

- The server listens on `127.0.0.1` only and uses **port 0**, so the OS assigns
  a free ephemeral port. The chosen port is written to `.data/server.port` and
  the process id to `.data/server.pid`. Both files stay inside the project.
- Override the data location with `$env:POLY_DATA_DIR` (defaults to `.data`).

Stop the project's recorded server:

```powershell
npm run stop
```

Delete project-generated data and the build output only:

```powershell
npm run clean
```

`stop` and `clean` only act on `.data/`, `dist/`, and a PID this project
recorded; they never manage unrelated processes or paths.

## CLI

Run from source with `npm run cli -- ...` or the built `dist/cli/cli.js`.

```powershell
# create (coefficients ascending by degree; integers or fractions)
npm run cli -- put --coeffs 2,-3,0,1 --alias cubic

# list / show
npm run cli -- list
npm run cli -- show cubic

# isolate (shows state before and after; optional budgets)
npm run cli -- analyze cubic --width 1/1000000 --max-iter 5000 --max-bits 1024

# continue refining to a tighter width (creates a new version)
npm run cli -- refine cubic --width 1/1000000000

# root counts (whole line if endpoints omitted; bounded otherwise)
npm run cli -- count cubic
npm run cli -- count cubic --left 0 --right 2

# sign on a certified root-free open interval
npm run cli -- sign cubic --left 2 --right 3

# versions, one run, paginated intervals, and proof export
npm run cli -- runs cubic
npm run cli -- run cubic --version 1
npm run cli -- intervals cubic --version 2 --limit 50 --offset 0
npm run cli -- proof cubic --version 2

# emit the deterministic algebraic fixtures as JSON
npm run cli -- fixtures

npm run cli -- help
```

Coefficients may also be passed as a JSON array, e.g.
`--coeffs "[\"1/2\",\"0\",\"-3/4\"]"`. Decimal strings such as `"0.5"` are
rejected.

## HTTP API

Base URL is `http://127.0.0.1:<port>` (read `.data/server.port`). All request
and response bodies are JSON. Errors have the shape
`{ "error": { "code", "message", "details" } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. |
| `POST` | `/polynomials` | Create/get canonical polynomial (idempotent). Body: `{coefficients | terms, alias?}`. |
| `GET` | `/polynomials?limit&offset` | Paginated list. |
| `GET` | `/polynomials/:idOrAlias` | One polynomial (pretty form included). |
| `POST` | `/polynomials/:id/analyze` | Run isolation. Body: `{maxWidth?, maxIterations?, maxBits?, requestKey?}`. Returns run, intervals, proof. |
| `GET` | `/polynomials/:id/runs?limit&offset` | List versions (newest first). |
| `GET` | `/polynomials/:id/runs/latest` | Latest run + intervals + proof. |
| `GET` | `/polynomials/:id/runs/:version` | A specific version. |
| `GET` | `/polynomials/:id/intervals?version&limit&offset` | Paginated intervals. |
| `POST` | `/polynomials/:id/count-roots` | `{left?, right?}`; omit both for the whole real line. |
| `POST` | `/polynomials/:id/sign` | `{left, right}`; sign on a certified root-free open interval. |
| `GET` | `/polynomials/:id/proof?version` | Exact proof summary. |

**Error codes:** `VALIDATION_ERROR`, `DEGREE_EXCEEDED`, `NOT_FOUND`,
`BAD_INTERVAL`, `BAD_PAGINATION`, `INTERVAL_CONTAINS_ROOT` (HTTP 409),
`ZERO_POLYNOMIAL_ROOT_COUNT_UNDEFINED` (HTTP 422), `INTERNAL`.

**Pagination:** `limit` is an integer in `[1,500]` (default 50), `offset` a
non-negative integer. Responses include `{items,total,limit,offset}`.

Example (PowerShell):

```powershell
$port = Get-Content .data/server.port
$base = "http://127.0.0.1:$port"
Invoke-RestMethod "$base/polynomials" -Method POST -ContentType 'application/json' `
  -Body '{"coefficients":["0","-1","0","1"],"alias":"cubic"}'
Invoke-RestMethod "$base/polynomials/cubic/analyze" -Method POST -ContentType 'application/json' `
  -Body '{"maxWidth":"1/1000000","requestKey":"run-1"}'
```

## Algebraic example generator

`src/generator/index.ts` produces deterministic, independently-checkable cases
(seeded PRNG, no ambient randomness):

- `no-real-roots` — `(x^2+1)^2(x^2+2)`, even factors that defeat sign samplers,
- `repeated-roots` — known multiplicities `3,2,1`,
- `close-roots` — two rational roots separated by `10^-9`,
- `zero-root` — `x^4(x-1)^2` (exact zero root, multiplicity 4),
- `big-numerator-denominator` — large integer numerators/denominators,
- `endpoint-roots` — roots exactly on common query endpoints,
- deterministic random square-free products of degree 5 and 12.

Print them:

```powershell
npm run fixtures
```

## Tests

```powershell
npm test
```

Runs 37+ tests under Node's built-in test runner covering:

- exact rational/polynomial arithmetic, division and gcd,
- square-free decomposition and multiplicities,
- Sturm variation counts (whole-line and bounded),
- no-real-root, repeated-root, close-root, zero-root, large-number, and
  endpoint-root cases,
- independent cross-check of root counts/multiplicities against known factor
  products from the generator,
- **scaling invariance** (multiplying by a non-zero rational scalar),
- **refinement containment** (tighter intervals stay inside earlier ones),
- **interruption/resume consistency** (undecided first, complete later, with the
  old version retained),
- parameter validation and error codes,
- pagination,
- idempotency by canonical polynomial and by `requestKey`,
- **transaction rollback** on failure,
- HTTP end-to-end behavior and **persistence across a restart**,
- repeatability of the generator.

Time and UUID generation are injectable at the storage layer; tests use fixed
clocks/IDs.

## Repeatable end-to-end demo

```powershell
npm run demo
```

Uses an isolated `.data/demo` database and a fixed clock/ID source. It shows:
fixture generation, polynomial creation, whole-line vs bounded root counts, a
deliberately interrupted analysis (undecided, no false completeness claim),
resumption to completion, a sign query, version comparison, exact proof export,
and an idempotency check.

## Project layout

```
src/
  core/        frac, poly (division/gcd), squarefree, sturm, isolation, sign, proof
  db/          SQLite migrations (re-runnable) and repository (versioning, paging)
  service/     orchestration, validation, error codes
  api/         localhost HTTP server
  cli/         command line interface
  generator/   deterministic algebraic fixtures
test/          node:test suites
scripts/       demo, stop, clean, sanity
```

Migrations are tracked in `schema_migrations` and are safe to run repeatedly;
opening a database always migrates it.

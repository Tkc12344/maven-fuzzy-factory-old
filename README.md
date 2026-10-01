# Maven Fuzzy Factory Intelligence

React + Node platform on the Maven Fuzzy Factory commerce dataset (March 2012 – March 2015).

CSVs are converted to Parquet once. The API queries DuckDB. Conversion, AOV, gross margin, and refund rate are defined in one module and reused by the dashboard, AI, and alerts.

```
CSVs  →  ETL (Parquet)  →  DuckDB
                              │
                    ┌─────────┼──────────┐
                    ▼         ▼          ▼
                 Data      AI + SerpAPI  Automation
              (SQL KPIs)   (narrative,   (cron, Slack/
                            schema,       Teams/email,
                            circuit       persisted
                            breaker)      state)
                              │
                              ▼
                       React dashboard
```

## Open the app

| Mode | URL | What you get |
| --- | --- | --- |
| Production-style | http://localhost:4000 | API + dashboard together |
| Dev hot reload | http://localhost:5173 | Vite frontend, proxied to `/api/v1` |

If `http://localhost:4000` shows **Cannot GET /**, build the client first: `npm run build`.

## Quick start

```bash
npm install
npm run install:all
cp .env.example .env
npm run etl          # CSV → Parquet (skipped on later boots if inputs are unchanged)
npm run dev
```

- Dashboard: http://localhost:5173
- API: http://localhost:4000/api/v1/health
- Prometheus: http://localhost:4000/metrics

One process after a client build:

```bash
npm run build
npm start
```

Then open http://localhost:4000.

LLM and SerpAPI keys are optional. Without them, insights use the warehouse heuristic and market search is disabled.

## What changed in this architecture

1. **Store** — DuckDB + Parquet, not in-memory JS objects. Replicas share a warehouse volume; a restart reuses Parquet instead of re-parsing 90+ MB of CSVs into heap.
2. **Metrics** — `server/src/metrics/kpis.js` is the only definition of conversion, AOV, margin, and refund rate.
3. **Forecasts** — STL + MAD, 95% intervals, 6-month backtest, March 2015 flagged/excluded as partial. 1–12 months = forecast, 13–36 = outlook, beyond that = **scenario** through 2030.
4. **AI** — model receives structured facts, must return JSON, invented numbers are rejected. Timeouts, retries, and a circuit breaker fall back to the heuristic. Cache key is `dataVersion + promptVersion + provider`.
5. **Automation** — `node-cron` evaluates rules, persists `fired / acknowledged / resolved` in `warehouse/alerts.json`, and can POST to Slack, Teams, or an email webhook. Cooldown stops daily duplicates.
6. **API** — `/api/v1/...` (unversioned `/api/...` still aliases). Zod, ETag / Cache-Control, helmet, rate limits, CORS allowlist, optional `API_TOKEN`.
7. **Ops** — multi-stage image, non-root, CSVs not in the image, volume-mounted data, startupProbe, `readOnlyRootFilesystem`. No HPA while you still run one writer for alert state.
8. **Hygiene** — data-contract tests (32,313 orders, $1,938,510 revenue), engine unit tests, GitHub Actions (lint, test, image, Trivy, push), pino + request IDs + Prometheus.

## Docker

The image does **not** contain CSVs or `.env`. Compose mounts the repo at `/data` and a named volume for Parquet.

```bash
docker compose up --build
```

Open http://localhost:4000. Memory limit is 1 GB — enough for DuckDB, not for the old in-memory loader.

## Kubernetes

```bash
docker build -t maven-fuzzy-factory:latest .
kubectl apply -k k8s
cp k8s/secret.yaml.example k8s/secret.yaml
# fill keys — do not commit secret.yaml
kubectl apply -f k8s/secret.yaml
# copy the CSVs into the mff-data PVC (or change the volume to a hostPath)
```

| Item | Value |
| --- | --- |
| Namespace | `maven-fuzzy-factory` |
| Service | `mff` |
| Ingress host | `fuzzy-factory.local` |
| Startup / liveness | `GET /api/v1/health` |
| Readiness | `GET /api/v1/ready` |
| Data | PVC `mff-data` → `/data` |
| Warehouse | PVC `mff-warehouse` → `/var/lib/mff/warehouse` |

Do not add a HorizontalPodAutoscaler until alert state is moved to an external store. One replica is the supported shape.

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `4000`) |
| `API_TOKEN` | If set, required as `x-api-key` or `Bearer` on `/api` except health/ready |
| `CORS_ORIGIN` | Comma-separated allowlist |
| `LLM_PROVIDER` | `auto`, `mistral`, `gemini`, `openai`, or `none` |
| `MISTRAL_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` | LLM |
| `SERPAPI_KEY` | Live Google search |
| `DATA_DIR` | Folder that contains the CSVs |
| `WAREHOUSE_DIR` | Parquet + DuckDB file |
| `SLACK_WEBHOOK_URL` / `TEAMS_WEBHOOK_URL` / `EMAIL_WEBHOOK_URL` | Alert delivery |
| `SMTP_URL` / `ALERT_EMAIL_TO` | Optional SMTP (dynamic nodemailer) |
| `ALERT_CRON` | Scheduler (default hourly) |
| `ALERT_*` / `ANOMALY_MAD_THRESHOLD` | Rule thresholds |
| `VITE_API_TOKEN` | Client copy of `API_TOKEN` if the dashboard must send it |

## Dashboard

| Page | Notes |
| --- | --- |
| Overview | Shared KPIs, complete months only |
| Charts | Product mix, funnel, campaigns, landings |
| Forecasts | Intervals, backtest, scenario labels through 2030 |
| Anomalies | STL remainder, MAD robust z ≥ 3.5 |
| AI insights | Narrative only; warehouse numbers are source of truth |
| Market search | SerpAPI |
| Alerts / reports | Ack / resolve, persisted state |

## API

Unversioned `/api/...` routes still work. Prefer `/api/v1/...`. Contract: [openapi.yaml](openapi.yaml).

| Route | Notes |
| --- | --- |
| `GET /api/v1/health` | Process status |
| `GET /api/v1/ready` | 503 until DuckDB is queryable |
| `GET /metrics` | Prometheus |
| `GET /api/v1/kpis` | Shared metrics + trend |
| `GET /api/v1/analysis` | Warehouse tables |
| `GET /api/v1/forecasts` | STL scenario + backtest |
| `GET /api/v1/anomalies` | MAD flags |
| `GET /api/v1/insights` | `?refresh=1` bypasses cache |
| `GET /api/v1/research` | SerpAPI |
| `GET /api/v1/alerts` | Persisted alerts |
| `POST /api/v1/alerts/:id/ack` | Acknowledge |
| `POST /api/v1/alerts/:id/resolve` | Resolve |
| `GET /api/v1/report` | Automation report |
| `GET /api/v1/dashboard` | Overview payload |

## Project layout

```
├── client/                      React dashboard
├── server/
│   ├── src/metrics/kpis.js      Single KPI definitions
│   ├── src/warehouse/           ETL, DuckDB, SQL
│   ├── src/engines/             AI, SerpAPI, automation
│   ├── src/lib/forecast.js      STL + MAD + backtest
│   └── test/                    Contract + unit tests
├── openapi.yaml
├── k8s/
├── Dockerfile                   Multi-stage, non-root, no CSVs
└── .github/workflows/ci.yml
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run install:all` | Server and client deps |
| `npm run etl` | CSV → Parquet |
| `npm run dev` | API :4000 and Vite :5173 |
| `npm test` / `npm run lint` | Server tests and ESLint |
| `npm run build` / `npm start` | Built dashboard + API |
| `npm run docker:up` | Compose |
| `npm run k8s:apply` | `kubectl apply -k k8s` |

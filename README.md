# Lifeline OS

AI-powered community resilience command center. This repo currently contains the **backend** (Engineer 2): local API + AWS CDK stack.

## Run the API locally (no AWS required)

```bash
npm install
npm run dev:api
```

API: [http://localhost:3001](http://localhost:3001)

```bash
curl http://localhost:3001/health
curl http://localhost:3001/state
curl -X POST http://localhost:3001/simulate
curl -X POST http://localhost:3001/requests \
  -H 'content-type: application/json' \
  -d '{"text":"My grandmother needs insulin and our power went out."}'
```

Frontend: set `NEXT_PUBLIC_API_URL=http://localhost:3001`.

## Verify (no AWS required)

Runs the full earthquake → survival clock → request → approve → impact loop and asserts the result:

```bash
npm run smoke -w @lifeline/backend
```

## Contract for Engineer 1

| Method | Path | Body |
|---|---|---|
| GET | `/state` | snapshot: incident, facilities, clocks, alerts, actions, impact, `metrics`, `priorityQueue` |
| GET | `/impact` | simulation totals |
| POST | `/simulate` | earthquake scenario + recommended actions |
| POST | `/simulate/road-close` | Event 04 reroute |
| POST | `/simulate/reset` | back to seed |
| POST | `/requests` | `{ "text": "..." }` → `{ parsed, state }` |
| POST | `/actions/:id/approve` | |
| POST | `/actions/:id/decline` | |
| POST | `/actions/:id/alternative` | |
| POST | `/connection` | `{ "mode": "edge" \| "cloud" }` |
| POST | `/sync` | `{ "events": OfflineEvent[] }` |
| GET | `/contract` | this list |

Facility `failureAt` is an ISO timestamp. `refrigerationHoursRemaining` and `alerts[].remainingSeconds` are derived on every read — countdown in the UI from `remainingSeconds`.

## Deploy AWS (when credentials are ready)

Region: `us-west-2` (enable Bedrock model access in that region before turning `USE_BEDROCK=true`).

```bash
export CDK_DEFAULT_REGION=us-west-2
npx cdk bootstrap   # once per account/region, from infra/
npm run deploy
```

Stack creates:

- API Gateway HTTP API → Lambda
- DynamoDB world state
- EventBridge `lifeline-events`
- Step Functions `lifeline-detect-think-act`
- SNS alerts
- SQS offline sync queue
- S3 artifacts
- CloudWatch dashboard `LifelineOs`

After deploy, set Lambda env `USE_BEDROCK=true` once the Haiku (or Nova) model is enabled.

## Bedrock

Default is **rules parser** so the grandma-insulin demo works offline. Bedrock is used only to structure natural language; the matcher and approvals stay in code.

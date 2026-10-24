# Lifeline OS

**Keep what matters moving.**

An AI resilience autopilot for emergency operations. When a disaster knocks out normal infrastructure, Lifeline OS predicts which critical resource will **fail next** and coordinates the **highest-impact intervention** before food, medicine, or power runs out.

> Built for the SpartHill Hacks 2026 Sustainable AI Hackathon — AWS track (AI-Driven Automation & Critical Service Continuity).

This repo is the **frontend demo**: a self-contained, dependency-free web app that runs the full judge-facing demo (disaster simulation, survival clocks, Amazon Bedrock request parsing, AI interventions with explanations, human approval, edge mode, and impact dashboard). No build step, no framework — it runs by opening a file.

## The loop

**Predict → Prioritize → Coordinate → Protect → Measure**

## Run it locally

No build required. Either open `index.html` in a browser, or serve it:

```bash
npm run dev        # starts a local static server (via npx serve)
# or
python3 -m http.server 8080
```

Then visit the printed URL (e.g. http://localhost:8080).

## What's in the demo

| Screen | What it shows |
| --- | --- |
| Entry | Role select — **Coordinator** (command center) or **Resident** (request help). No passwords; a lightweight role switch, not real auth. |
| Resident (mobile-first) | A victim submits a plain-language need → **Amazon Bedrock Analysis** → match + dispatch status |
| Overview | Live radar map, survival-clock gauges, stat tiles, **Simulate Disaster** |
| Network | Status of every resource node |
| Requests | Natural-language emergency intake → **Amazon Bedrock Analysis** |
| Actions | AI recommendation, **Why this action?**, do-nothing comparison, human **Approve** |
| Impact | Meals/doses/people rescued, 91% donut, response-time and district charts |

Operator persona (**Maya Chen · Emergency Operations Coordinator**), light/dark themes, sound, and an offline **Edge Mode** are built in.

## Project structure

```
index.html    # markup + <head> (fonts, meta)
styles.css    # all styling (light + dark themes via CSS tokens)
app.js        # all interactivity (simulation, clocks, parsing, charts)
```

Everything is vanilla HTML/CSS/JS so the whole team can edit without a toolchain, and it deploys as a static site.

## Deploy to AWS Amplify (static hosting)

1. Push this repo to GitHub (see below).
2. AWS Console → **Amplify** → **Host web app** → connect this repo/branch.
3. Build settings: **no build needed** — it's a static site. Use this `amplify.yml` if prompted:

   ```yaml
   version: 1
   frontend:
     phases:
       build:
         commands: []
     artifacts:
       baseDirectory: /
       files:
         - '**/*'
     cache:
       paths: []
   ```
4. Deploy → Amplify gives you a live URL.

## Architecture (full product)

The frontend talks to a serverless backend (separate repo/stack):

```
Browser (this repo, on Amplify)
      │
API Gateway → Lambda
      ├── Amazon Bedrock   (parse request + explain recommendation)
      └── DynamoDB         (resources · requests · actions)
      │
Priority engine → Recommended action → Human approval → Impact log
```

Amazon SNS (real SMS) and AWS IoT Greengrass (production edge/offline) are a **future production path**, not part of this demo.

## Responsible AI

Bedrock **understands and explains**; a deterministic priority engine **decides**; a human **approves** every high-impact action. *Automate coordination, not human judgment.*

## License

MIT — see [LICENSE](LICENSE).

# HARIS — Hyper-Adaptive Real-time Intervention System

**ElevenLabs × Ignyte Future of Voice AI Challenge 2026**  
Track: Banking & Insurance — Real-Time Fraud Intervention

---

## What is HARIS?

HARIS is a multilingual AI voice agent that calls customers the instant a fraud signal is raised — verifies identity without ever requesting a PIN, executes a pre-approved card freeze, and warm-transfers to a human agent with full context. All in under 90 seconds.

**The problem it solves:** UAE banks average 4–8 minutes to reach a customer after a fraud signal. In that window, scams complete. Only 9% of UAE victims recover full losses. HARIS cuts time-to-contact to under 30 seconds.

---

## Architecture

```
FRAUD ENGINE (Bank)
      │ webhook {customer_id, risk_signal, anomaly_details}
      ▼
HARIS INTAKE LAYER
  ├─ CRM lookup → preferred_language, mobile_number
  ├─ Calling hours check (08:00–22:00 GST)
  └─ ElevenLabs Batch Calling dispatch
            │
            ▼
    ┌──────────────────────────────────────────────┐
    │         ELEVENLABS AGENT WORKFLOW            │
    │                                              │
    │  ┌─────────────┐                            │
    │  │  VERIFIER   │ Tools: verify_identity     │
    │  │  Sub-Agent  │ (read-only, scoped)        │
    │  └──────┬──────┘                            │
    │         │                                    │
    │   verified? ──no──► LIAISON sub-agent        │
    │         │                                    │
    │        yes                                   │
    │         ▼                                    │
    │  ┌─────────────┐                            │
    │  │    GUARD    │ Tools: freeze_card ONLY    │
    │  │  Sub-Agent  │ (single sandboxed write)   │
    │  └──────┬──────┘                            │
    │         ▼                                    │
    │  ┌─────────────┐                            │
    │  │   LIAISON   │ Tools: post_call_data,     │
    │  │  Sub-Agent  │ transfer_to_human          │
    │  └──────┬──────┘                            │
    └─────────┼────────────────────────────────────┘
              │ post-call webhook
              ▼
    BANK CASE MANAGEMENT SYSTEM
```

**Key compliance property:** GUARD's tool scope contains exactly ONE tool (`freeze_card`). No irreversible actions (account closure, fund transfer) are registered. This is enforced by the ElevenLabs Agent Workflows tool scoping system — it is a structural guarantee, not a prompt instruction.

---

## ElevenLabs Stack Used

| Component | How HARIS uses it |
|---|---|
| **Agent Workflows** | Three-sub-agent graph: VERIFIER → GUARD → LIAISON with branch conditions |
| **Sub-agents + tool scoping** | Each sub-agent has only the tools its role requires; GUARD has only `freeze_card` |
| **Eleven v3 TTS** | Warm, unhurried voice — trust signal that distinguishes HARIS from spam calls |
| **Scribe v2 Realtime STT** | Keyterm biasing for "Emirates ID", "IBAN", "AED", card suffixes |
| **Knowledge Base (RAG)** | Bank's verification challenge rules and approved wording scripts |
| **Webhook tools** | `verify_identity`, `freeze_card`, `post_call_data` → mock server |
| **Batch Calling** | Outbound campaign triggered by fraud engine webhook |
| **Twilio integration** | Outbound calls to UAE mobile numbers |
| **Post-call webhooks + analysis** | Every call produces structured JSON + transcript + audio |
| **Agent Testing** | 15 scenarios, 50-run pass rate test on `freeze_card` tool call |
| **Multilingual** | English, Arabic (Gulf), Hindi, Urdu — selected per customer profile |

---

## Supported Languages

| Language | Coverage in UAE |
|---|---|
| English | Business + professional expats |
| Arabic (Gulf dialect) | Emirati nationals + Gulf expats |
| Hindi | ~28% of UAE workforce |
| Urdu | ~8% of UAE workforce |

---

## Guardrails (Mechanisms, Not Statements)

| Guardrail | Mechanism |
|---|---|
| Never request PIN/password | VERIFIER prompt prohibits it + post-call analysis criterion flags any occurrence |
| Only pre-approved protective action | GUARD tool scope = `freeze_card` only, enforced by ElevenLabs tool scoping |
| Action only after verification | Workflow graph: `freeze_card` node only reachable from `verification == VERIFIED` branch |
| Permitted calling hours only | Intake layer checks timezone before dispatching — call never placed outside 08:00–22:00 GST |
| Opt-out honoured immediately | Keyterm biasing detects opt-out in any supported language → stops flow instantly |
| Full auditability | Every call: audio + transcript + structured JSON + case record via post-call webhook |

---

## Repository Structure

```
haris/
├── index.html                    # Live demo page (ElevenLabs widget)
├── README.md                     # This file
├── agent/
│   ├── agent-config.json         # Full agent architecture spec
│   ├── verifier-system-prompt.txt
│   ├── guard-system-prompt.txt
│   └── liaison-system-prompt.txt
└── mock-server/
    ├── package.json
    └── server.js                 # Three webhook endpoints
```

---

## Running the Mock Server Locally

```bash
cd mock-server
npm install
npm start
# Server runs on http://localhost:3000
```

**Endpoints:**
- `POST /verify-identity` — identity challenge result logger
- `POST /freeze-card` — card freeze executor (sandbox only)
- `POST /post-call-data` — audit trail creator
- `GET /call-log` — inspect last 20 events (for judges/demo)

---

## Deploying the Mock Server (Railway.app — free, takes 5 minutes)

1. Go to [railway.app/new](https://railway.app/new)
2. "Deploy from GitHub repo" → select this repo → select `mock-server/` as root
3. Railway auto-detects Node.js and deploys. Copy the generated URL.
4. In ElevenLabs agent tools, replace `https://haris-mock.up.railway.app` with your Railway URL.

---

## Live Demo & Endpoints

👉 **[Talk to HARIS Live Demo](https://haris-livid.vercel.app/)** — experience the intervention flow and dashboard

- **Health check**: `https://haris-livid.vercel.app/api`
- **Verify Identity Webhook**: `POST https://haris-livid.vercel.app/verify-identity`
- **Freeze Card Webhook**: `POST https://haris-livid.vercel.app/freeze-card`
- **Audit Data Webhook**: `POST https://haris-livid.vercel.app/post-call-data`
- **Live Call Log**: `GET https://haris-livid.vercel.app/call-log`

---

## Baseline vs. Target KPIs

| KPI | Baseline | Target |
|---|---|---|
| Time to first outbound contact | 4–8 min | < 30 sec |
| Contact success rate | 32% | > 70% |
| Language match (native) | 22% | > 85% |
| Card freeze before fund exit | ~40% | > 85% |
| CBUAE audit compliance | Manual, sampled | 100% automated |

---

## Regulatory Compliance

- CBUAE Consumer Protection Regulations — no coercive pressure, calling hours enforced
- CBUAE Circular 2024/88 — zero PIN/password requests by design
- CBUAE Notice 2025/3057 — phishing-resistant verification challenge (not SMS OTP)
- Full call recording + transcript + structured audit trail per CBUAE requirements

---

*Built on the ElevenLabs Conversational AI Platform. Sandbox only — no real financial data.*

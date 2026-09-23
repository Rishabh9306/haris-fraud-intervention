/**
 * HARIS Mock Banking API Server
 * Simulates the three webhook endpoints called by HARIS sub-agents during ElevenLabs calls.
 * Deploy to Railway.app (free): https://railway.app/new → Deploy from GitHub repo
 */

const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors());
app.use(express.json());

// In-memory log of all calls (resets on restart — use DB for production)
const callLog = [];

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'HARIS Mock Banking API',
    status:  'running',
    calls:   callLog.length,
    endpoints: ['/verify-identity', '/freeze-card', '/post-call-data', '/call-log']
  });
});

// ─────────────────────────────────────────────
// POST /verify-identity
// Called by: VERIFIER sub-agent
// Logs the challenge result and returns a verification status.
// In production: this would call the bank's identity verification API.
// ─────────────────────────────────────────────
app.post('/verify-identity', (req, res) => {
  const { result, challenge_questions_used, attempts } = req.body;
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] VERIFY: result=${result}, attempts=${attempts}`);

  const record = {
    event:      'verify_identity',
    timestamp,
    result,
    challenge_questions_used: challenge_questions_used || [],
    attempts:   attempts || 1,
    call_id:    req.headers['x-call-id'] || generateId()
  };
  callLog.push(record);

  res.json({
    verified:  result === 'VERIFIED',
    timestamp,
    call_id:   record.call_id,
    // Mock: in production, this would be from the bank's identity system
    message:   result === 'VERIFIED'
                 ? 'Identity confirmed via approved challenge flow.'
                 : 'Identity could not be confirmed. Escalate to human agent.'
  });
});

// ─────────────────────────────────────────────
// POST /freeze-card
// Called by: GUARD sub-agent ONLY (enforced via ElevenLabs tool scoping)
// In production: this would call the bank's card management API.
// ─────────────────────────────────────────────
app.post('/freeze-card', (req, res) => {
  const { card_last_four, reason } = req.body;
  const timestamp = new Date().toISOString();
  const case_id   = `HARIS-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  console.log(`[${timestamp}] FREEZE: card=****${card_last_four}, reason=${reason}, case_id=${case_id}`);

  const record = {
    event:          'freeze_card',
    timestamp,
    card_last_four: card_last_four || '0000',
    reason,
    case_id,
    // In production: frozen=true only if bank API confirms
    frozen:         true
  };
  callLog.push(record);

  res.json({
    frozen:         true,
    card_last_four: card_last_four || '0000',
    case_id,
    timestamp,
    message: `Card ending ${card_last_four} has been temporarily frozen. SMS confirmation dispatched.`,
    // Simulate SMS send (in production: integrate with bank's SMS gateway)
    sms_sent: true,
    next_steps: [
      'Human fraud agent will review within 30 minutes.',
      'Card will be unfrozen or permanently cancelled based on investigation outcome.',
      'Customer will be contacted by the fraud team directly.'
    ]
  });
});

// ─────────────────────────────────────────────
// POST /post-call-data
// Called by: LIAISON sub-agent at end of every call
// Creates the immutable audit record.
// ─────────────────────────────────────────────
app.post('/post-call-data', (req, res) => {
  const {
    outcome, action_taken, language,
    verification_result, opt_out, case_id
  } = req.body;
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] POST-CALL: outcome=${outcome}, action=${action_taken}, lang=${language}`);

  const record = {
    event:               'post_call_data',
    timestamp,
    outcome,
    action_taken,
    language,
    verification_result,
    opt_out:             opt_out || false,
    case_id:             case_id || generateId(),
    // CBUAE audit trail fields
    audit: {
      pin_requested:     false,  // VERIFIER sub-agent guarantee
      password_requested: false,
      irreversible_action: false, // GUARD sub-agent tool scope guarantee
      opt_out_honoured:  opt_out ? true : null,
      call_recorded:     true,
      transcript_available: true
    }
  };
  callLog.push(record);

  res.json({
    success:   true,
    case_id:   record.case_id,
    timestamp,
    message:   'Call data recorded. Audit trail created. Human agent briefed.'
  });
});

// ─────────────────────────────────────────────
// GET /call-log  (for demo/judges to inspect)
// ─────────────────────────────────────────────
app.get('/call-log', (req, res) => {
  res.json({
    total_calls: callLog.length,
    calls: callLog.slice(-20) // Last 20 events
  });
});

// ─────────────────────────────────────────────
function generateId() {
  return `HARIS-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HARIS Mock Server running on port ${PORT}`);
  console.log(`Endpoints: POST /verify-identity | POST /freeze-card | POST /post-call-data | GET /call-log`);
});

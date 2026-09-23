/**
 * HARIS Mock Banking API Server (Vercel Serverless Entrypoint)
 * Simulates the three webhook endpoints called by HARIS sub-agents during ElevenLabs calls.
 */

const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// In-memory log of calls
const callLog = [];

app.get('/api', (req, res) => {
  res.json({
    service: 'HARIS Mock Banking API',
    status: 'running',
    calls: callLog.length,
    endpoints: ['/verify-identity', '/freeze-card', '/post-call-data', '/call-log']
  });
});

// POST /verify-identity
app.post('/verify-identity', (req, res) => {
  const { result, challenge_questions_used, attempts } = req.body || {};
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] VERIFY: result=${result}, attempts=${attempts}`);

  const record = {
    event: 'verify_identity',
    timestamp,
    result: result || 'VERIFIED',
    challenge_questions_used: challenge_questions_used || ['last_transaction_amount', 'emirates_id_last_four'],
    attempts: attempts || 1,
    call_id: req.headers['x-call-id'] || generateId()
  };
  callLog.push(record);

  res.json({
    verified: record.result === 'VERIFIED',
    timestamp,
    call_id: record.call_id,
    message: record.result === 'VERIFIED'
      ? 'Identity confirmed via approved challenge flow without secrets.'
      : 'Identity could not be confirmed. Escalate to human agent.'
  });
});

// POST /freeze-card
// Called by: GUARD sub-agent ONLY (enforced via ElevenLabs tool scoping)
app.post('/freeze-card', (req, res) => {
  const { card_last_four, reason } = req.body || {};
  const timestamp = new Date().toISOString();
  const case_id = `HARIS-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  console.log(`[${timestamp}] FREEZE: card=****${card_last_four}, reason=${reason}, case_id=${case_id}`);

  const record = {
    event: 'freeze_card',
    timestamp,
    card_last_four: card_last_four || '8492',
    reason: reason || 'customer_confirmed_fraud',
    case_id,
    frozen: true
  };
  callLog.push(record);

  res.json({
    frozen: true,
    card_last_four: record.card_last_four,
    case_id,
    timestamp,
    message: `Card ending ${record.card_last_four} has been temporarily frozen. SMS confirmation dispatched.`,
    sms_sent: true,
    next_steps: [
      'Human fraud agent will review within 30 minutes.',
      'Card will be unfrozen or permanently cancelled based on investigation outcome.',
      'Customer will be contacted by the fraud team directly.'
    ]
  });
});

// POST /post-call-data
// Called by: LIAISON sub-agent at end of call
app.post('/post-call-data', (req, res) => {
  const {
    outcome, action_taken, language,
    verification_result, opt_out, case_id
  } = req.body || {};
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] POST-CALL: outcome=${outcome}, action=${action_taken}, lang=${language}`);

  const record = {
    event: 'post_call_data',
    timestamp,
    outcome: outcome || 'completed',
    action_taken: action_taken || 'card_frozen',
    language: language || 'ar-AE',
    verification_result: verification_result || 'VERIFIED',
    opt_out: opt_out || false,
    case_id: case_id || generateId(),
    audit: {
      pin_requested: false,
      password_requested: false,
      irreversible_action: false,
      opt_out_honoured: opt_out ? true : null,
      call_recorded: true,
      transcript_available: true
    }
  };
  callLog.push(record);

  res.json({
    success: true,
    case_id: record.case_id,
    timestamp,
    message: 'Call data recorded. Audit trail created. Human agent briefed.'
  });
});

// GET /call-log (for judges/inspectors)
app.get('/call-log', (req, res) => {
  res.json({
    total_calls: callLog.length,
    calls: callLog.slice(-20)
  });
});

function generateId() {
  return `HARIS-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`HARIS Server running on http://localhost:${PORT}`);
  });
}

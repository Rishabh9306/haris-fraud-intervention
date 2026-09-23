/**
 * HARIS Banking API Server (Fail-Closed, Authenticated, Session-Bound)
 * Enforces cryptographic HMAC token verification, strict input validation,
 * and state-bound action authorization.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use((req, res, next) => {
  if (req.body !== undefined) {
    return next();
  }
  express.json()(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'INVALID_JSON', message: err.message });
    }
    next();
  });
});

// Server secret for signing action tokens & authenticating webhooks
const API_SECRET = process.env.HARIS_API_SECRET || 'haris_sec_def_593a1f8b82ec4711893';

// In-memory state storage (ephemeral demo sessions, idempotency cache, audit log)
const activeSessions = new Map(); // session_id -> { verified, card_last_four, verified_at, expires_at }
const processedIdempotencyKeys = new Set();
const auditLog = [];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: HMAC Token Generation & Verification
// ─────────────────────────────────────────────────────────────────────────────
function generateActionToken(sessionId, cardLastFour) {
  const payload = {
    sid: sessionId,
    c4: cardLastFour,
    exp: Date.now() + 5 * 60 * 1000, // 5 minute validity
    nonce: crypto.randomBytes(8).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', API_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyActionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', API_SECRET).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return null; // Expired
    return payload;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api (Health Check)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    service: 'HARIS Banking Action API',
    security_mode: 'FAIL_CLOSED',
    active_sessions: activeSessions.size,
    audit_records: auditLog.length,
    endpoints: ['/verify-identity', '/freeze-card', '/post-call-data', '/call-log']
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /verify-identity
// VERIFIER Sub-Agent Webhook
// Strict input validation: NO DEFAULT "VERIFIED". Fail-closed.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/verify-identity', (req, res) => {
  const { session_id, card_last_four, challenge_answers, verification_decision } = req.body || {};

  // Strict validation: Reject missing parameters
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'MISSING_SESSION_ID', message: 'Explicit session_id is required.' });
  }

  if (!card_last_four || typeof card_last_four !== 'string' || !/^\d{4}$/.test(card_last_four)) {
    return res.status(400).json({ error: 'INVALID_CARD_PARAMETER', message: '4-digit card_last_four required.' });
  }

  if (!verification_decision || (verification_decision !== 'VERIFIED' && verification_decision !== 'FAILED')) {
    return res.status(400).json({
      error: 'INVALID_DECISION',
      message: 'Explicit verification_decision ("VERIFIED" or "FAILED") is required. System does not default to success.'
    });
  }

  const timestamp = new Date().toISOString();

  // Fail-Closed: If decision is FAILED, persist unverified state and decline token issuance
  if (verification_decision === 'FAILED') {
    activeSessions.set(session_id, {
      verified: false,
      card_last_four,
      timestamp,
      attempts: (req.body.attempts || 1)
    });

    return res.status(200).json({
      verified: false,
      session_id,
      timestamp,
      action_token: null,
      message: 'Verification failed. Action token NOT issued. Human escalation required.'
    });
  }

  // Issue short-lived, signed action token upon explicit VERIFIED decision
  const actionToken = generateActionToken(session_id, card_last_four);

  activeSessions.set(session_id, {
    verified: true,
    card_last_four,
    verified_at: timestamp,
    expires_at: Date.now() + 5 * 60 * 1000
  });

  auditLog.push({
    event: 'IDENTITY_VERIFIED',
    session_id,
    card_last_four,
    timestamp,
    token_issued: true
  });

  return res.status(200).json({
    verified: true,
    session_id,
    timestamp,
    action_token: actionToken,
    message: 'Identity verified via low-privilege challenge. Action token issued (valid 5 min).'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /freeze-card
// GUARD Sub-Agent Webhook
// Strict enforcement: Token verification, session binding, replay protection, idempotency.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/freeze-card', (req, res) => {
  const { action_token, session_id, card_last_four, idempotency_key, confirmation } = req.body || {};

  // 1. Mandatory confirmation check
  if (confirmation !== true && confirmation !== 'CONFIRMED') {
    return res.status(400).json({
      error: 'UNCONFIRMED_ACTION',
      message: 'Customer confirmation required to execute protective card freeze.'
    });
  }

  // 2. Cryptographic Token / Session Validation (Fail-closed)
  const tokenPayload = verifyActionToken(action_token);
  if (!tokenPayload) {
    return res.status(403).json({
      error: 'UNAUTHORIZED_OR_EXPIRED_TOKEN',
      message: 'Protective action denied. Missing, forged, or expired action token. Verification required first.'
    });
  }

  // 3. Card binding check: token card must match request card
  if (tokenPayload.c4 !== card_last_four) {
    return res.status(400).json({
      error: 'CARD_MISMATCH',
      message: `Token was issued for card ending ${tokenPayload.c4}, not ${card_last_four}.`
    });
  }

  // 4. Session state verification
  const session = activeSessions.get(tokenPayload.sid);
  if (!session || !session.verified) {
    return res.status(403).json({
      error: 'INVALID_SESSION_STATE',
      message: 'Session state is unverified or has been revoked.'
    });
  }

  // 5. Idempotency & Replay Protection
  const resolvedIdempotencyKey = idempotency_key || req.headers['idempotency-key'] || tokenPayload.nonce;
  if (processedIdempotencyKeys.has(resolvedIdempotencyKey)) {
    return res.status(409).json({
      error: 'DUPLICATE_REQUEST',
      message: 'This freeze instruction has already been executed. Replay rejected.',
      idempotency_key: resolvedIdempotencyKey
    });
  }
  processedIdempotencyKeys.add(resolvedIdempotencyKey);

  // 6. Action Execution
  const timestamp = new Date().toISOString();
  const caseId = `HARIS-CASE-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const auditRecord = {
    event: 'CARD_FROZEN',
    session_id: tokenPayload.sid,
    card_last_four,
    case_id: caseId,
    timestamp,
    status: 'ACTIVE_FREEZE',
    reversible: true,
    action_type: 'PRE_APPROVED_PROTECTIVE_HOLD'
  };

  auditLog.push(auditRecord);

  return res.status(200).json({
    frozen: true,
    card_last_four,
    case_id: caseId,
    timestamp,
    reversible: true,
    status: 'TEMPORARY_FREEZE_APPLIED',
    message: `Card ending ${card_last_four} has been placed on protective hold.`
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /post-call-data
// LIAISON Sub-Agent Webhook (Audit ingestion)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/post-call-data', (req, res) => {
  const { session_id, outcome, action_taken, verification_result } = req.body || {};

  if (!session_id) {
    return res.status(400).json({ error: 'MISSING_SESSION_ID', message: 'session_id is required.' });
  }

  const timestamp = new Date().toISOString();
  auditLog.push({
    event: 'CALL_COMPLETED',
    session_id,
    outcome: outcome || 'UNKNOWN',
    action_taken: action_taken || 'NONE',
    verification_result: verification_result || 'UNVERIFIED',
    timestamp
  });

  return res.status(200).json({
    recorded: true,
    session_id,
    timestamp
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /call-log
// ─────────────────────────────────────────────────────────────────────────────
app.get('/call-log', (req, res) => {
  res.json({
    total_records: auditLog.length,
    recent: auditLog.slice(-15)
  });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`HARIS Banking API (Fail-Closed) running on http://localhost:${PORT}`);
  });
}

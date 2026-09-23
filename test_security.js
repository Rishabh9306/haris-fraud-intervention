const http = require('http');
const app = require('./api/index.js');

const server = http.createServer(app);
server.listen(4001, async () => {
  console.log('Testing security invariants on local server :4001...');

  async function post(path, body) {
    const res = await fetch(`http://localhost:4001${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    // 1. Attack 1: Direct unauthenticated /freeze-card call
    const atk1 = await post('/freeze-card', { card_last_four: '9999', confirmation: true });
    console.log('ATTACK 1 (Direct freeze without token): Status =', atk1.status, atk1.data.error);
    if (atk1.status !== 403) throw new Error('Security failure: Direct unauthenticated freeze was not blocked!');

    // 2. Attack 2: Forged token /freeze-card call
    const atk2 = await post('/freeze-card', { action_token: 'fake.signature', card_last_four: '9999', confirmation: true });
    console.log('ATTACK 2 (Forged token): Status =', atk2.status, atk2.data.error);
    if (atk2.status !== 403) throw new Error('Security failure: Forged token was not blocked!');

    // 3. Attack 3: Empty body /verify-identity
    const atk3 = await post('/verify-identity', {});
    console.log('ATTACK 3 (Empty /verify-identity): Status =', atk3.status, atk3.data.error);
    if (atk3.status !== 400) throw new Error('Security failure: Empty verification was not blocked!');

    // 4. Legit flow Step 1: Verify identity
    const legitVerify = await post('/verify-identity', {
      session_id: 'test_sess_001',
      card_last_four: '8492',
      verification_decision: 'VERIFIED',
      challenge_answers: { eid_suffix: '8492' }
    });
    console.log('LEGIT STEP 1 (/verify-identity): Status =', legitVerify.status, 'Token issued =', !!legitVerify.data.action_token);
    const token = legitVerify.data.action_token;

    // 5. Attack 4: Card mismatch (token issued for 8492, request asks for 1111)
    const atk4 = await post('/freeze-card', { action_token: token, card_last_four: '1111', confirmation: true });
    console.log('ATTACK 4 (Card mismatch attack): Status =', atk4.status, atk4.data.error);
    if (atk4.status !== 400) throw new Error('Security failure: Card mismatch was not blocked!');

    // 6. Legit flow Step 2: Freeze with valid token and matching card
    const legitFreeze = await post('/freeze-card', {
      action_token: token,
      card_last_four: '8492',
      confirmation: true,
      idempotency_key: 'idemp_key_001'
    });
    console.log('LEGIT STEP 2 (/freeze-card with token): Status =', legitFreeze.status, 'Frozen =', legitFreeze.data.frozen);
    if (legitFreeze.status !== 200 || !legitFreeze.data.frozen) throw new Error('Failure on legitimate freeze flow');

    // 7. Attack 5: Replay attack with same idempotency key
    const atk5 = await post('/freeze-card', {
      action_token: token,
      card_last_four: '8492',
      confirmation: true,
      idempotency_key: 'idemp_key_001'
    });
    console.log('ATTACK 5 (Replay duplicate attack): Status =', atk5.status, atk5.data.error);
    if (atk5.status !== 409) throw new Error('Security failure: Replay attack was not blocked!');

    console.log('\n>>> ALL 5 SECURITY INVARIANTS RIGOROUSLY PASSED! <<<');
  } catch (err) {
    console.error('TEST ERROR:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});

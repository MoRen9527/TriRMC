import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  GatewayClient,
  buildRpcMessage,
  cookieHeaderFrom,
  normalizeBase,
  parseTokenFromStartupLog,
  redact,
} from '../scripts/dsh-gateway-client.mjs';

describe('normalizeBase', () => {
  it('keeps only protocol and authority', () => {
    assert.equal(normalizeBase('http://127.0.0.1:8791/?token=abc'), 'http://127.0.0.1:8791');
    assert.equal(normalizeBase('https://example.test/dsh/'), 'https://example.test');
  });

  it('rejects non-http protocols', () => {
    assert.throws(() => normalizeBase('ftp://example.test'), /unsupported base protocol/);
  });
});

describe('parseTokenFromStartupLog', () => {
  it('extracts the token for the requested origin', () => {
    const log = 'dsh web: http://127.0.0.1:8799/?token=tok_ABC-123\n';
    assert.equal(parseTokenFromStartupLog(log, 'http://127.0.0.1:8799'), 'tok_ABC-123');
  });

  it('falls back to any startup URL then to a bare token file', () => {
    assert.equal(parseTokenFromStartupLog('ready at http://127.0.0.1:9000/?token=xyz', 'http://127.0.0.1:8791'), 'xyz');
    assert.equal(parseTokenFromStartupLog('plain-token\n', 'http://127.0.0.1:8791'), 'plain-token');
  });
});

describe('redact', () => {
  it('masks launch tokens, cookies, and api keys', () => {
    const text = 'GET /?token=secret-token cookie: dsh=abc sk-0123456789abcdef';
    const masked = redact(text);
    assert.equal(masked.includes('secret-token'), false);
    assert.equal(masked.includes('dsh=abc'), false);
    assert.equal(masked.includes('sk-0123456789abcdef'), false);
  });
});

describe('buildRpcMessage', () => {
  it('builds the Connection client-request envelope', () => {
    const message = buildRpcMessage('session/list', { _request: {} }, 'rpc-1');
    assert.deepEqual(message, {
      type: 'client-request',
      rpcId: 'rpc-1',
      method: 'session/list',
      payload: { args: { _request: {} } },
    });
  });

  it('rejects endpoints outside namespace/method shape', () => {
    assert.throws(() => buildRpcMessage('session', {}, 'rpc-1'), /invalid Remote endpoint/);
    assert.throws(() => buildRpcMessage('session/list/extra', {}, 'rpc-1'), /invalid Remote endpoint/);
  });
});

describe('cookieHeaderFrom', () => {
  it('drops cookie attributes and joins multiple cookies', () => {
    assert.equal(
      cookieHeaderFrom(['a=1; Path=/; HttpOnly', 'b=2; SameSite=Strict']),
      'a=1; b=2',
    );
  });

  it('throws when the exchange returned no cookie', () => {
    assert.throws(() => cookieHeaderFrom([]), /no session cookie/);
  });
});

describe('GatewayClient transport', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('exchanges a token for a cookie and sends the RPC with rpcId correlation', async () => {
    const seen = [];
    globalThis.fetch = async (url, init = {}) => {
      seen.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
      if (String(url).includes('?token=')) {
        return new Response(null, { status: 303, headers: { 'set-cookie': 'dsh_session=signed; Path=/; HttpOnly' } });
      }
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: true, value: { items: [{ sessionId: 's1', running: false }] } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const client = new GatewayClient({ base: 'http://127.0.0.1:8799', token: 'launch' });
    const items = await client.listSessions();

    assert.equal(items.length, 1);
    assert.equal(client.cookie, 'dsh_session=signed');
    assert.equal(seen[1].url, 'http://127.0.0.1:8799/api/session/list');
    assert.equal(seen[1].method, 'POST');
    assert.equal(JSON.parse(seen[1].body).payload.args._request !== undefined, true);
  });

  it('surfaces RemoteError codes from the result envelope', async () => {
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('?token=')) {
        return new Response(null, { status: 303, headers: { 'set-cookie': 'dsh_session=signed; Path=/' } });
      }
      const request = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: false, error: { code: 'gateway/signature-invalid', message: 'bad args', details: {} } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const client = new GatewayClient({ base: 'http://127.0.0.1:8799', token: 'launch' });
    await assert.rejects(() => client.rpc('session/prompt', { request: {} }), /gateway\/signature-invalid: bad args/);
  });
});

#!/usr/bin/env node
/**
 * dsh Gateway Remote minimal client (A2 / LG-087 window 2, item #7).
 *
 * Talks to a running `dsh web` host without a browser:
 *   1. GET /?token=<launch-token>  -> signed HttpOnly cookie (303 redirect)
 *   2. POST /api/<namespace>/<method> with the Connection RPC envelope
 *   3. WS  /api/remote.mux for Gateway-owned logical streams ($events, ...)
 *
 * Protocol anchors (dsh 0.2.0-rc.2, host assets read-only):
 *   dsh-client-connection/lib/index.js  clientRequestSchema (type/rpcId/method/payload)
 *   dsh-client-connection/lib/client.js POST `${channel}/${endpoint}` + rpcId correlation
 *   dsh-api-gateway/lib/client.js       {type:'open',streamId,endpoint,payload} frame
 *   dsh-api-session-controller/lib/typert.remote-client.js
 *                                       session/list, session/create, session/prompt
 *
 * Deliberately dependency-free (Node >= 22: global fetch + WebSocket).
 * Zero access to the live 8791/13-seat sessions unless the caller names them.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BASE = 'http://127.0.0.1:8791';
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Strip userinfo, trailing slash, and query from a host URL. */
export function normalizeBase(input) {
  const raw = String(input ?? DEFAULT_BASE).trim();
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported base protocol: ${url.protocol}`);
  }
  return `${url.protocol}//${url.host}`;
}

/** Hide launch tokens / cookie values from logs and error text. */
export function redact(text) {
  return String(text)
    .replace(/([?&]token=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/\b(cookie|set-cookie):\s*[^\n]+/gi, '$1: <redacted>')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '<redacted-key>');
}

/**
 * Read the launch token from a `dsh web` startup line or a bare token file.
 * The token in a startup log is `http://host:port/?token=...`.
 */
export function parseTokenFromStartupLog(text, base = DEFAULT_BASE) {
  const source = String(text ?? '');
  const wanted = normalizeBase(base);
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchored = new RegExp(`${escaped}/?\\?token=([A-Za-z0-9._~-]+)`);
  const hit = source.match(anchored);
  if (hit) return hit[1];
  const any = source.match(/https?:\/\/[^\s]+\?token=([A-Za-z0-9._~-]+)/);
  return any ? any[1] : source.trim();
}

/** Connection unary envelope (`client-request`). */
export function buildRpcMessage(method, args, rpcId) {
  if (typeof method !== 'string' || !/^[A-Za-z0-9_$.-]+\/[A-Za-z0-9_$.-]+$/.test(method)) {
    throw new Error(`invalid Remote endpoint: ${method}`);
  }
  return { type: 'client-request', rpcId, method, payload: { args: args ?? {} } };
}

/** Split a Set-Cookie response into one request Cookie header. */
export function cookieHeaderFrom(setCookies) {
  const pairs = (setCookies ?? []).map((line) => String(line).split(';', 1)[0]).filter(Boolean);
  if (pairs.length === 0) throw new Error('no session cookie in token exchange response');
  return pairs.join('; ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GatewayClient {
  /**
   * @param {object} options
   * @param {string} [options.base]     dsh web origin, default http://127.0.0.1:8791
   * @param {string} [options.token]    launch token (prefer tokenFile/env over argv)
   * @param {string} [options.cookie]   pre-existing Cookie header (skip exchange)
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    this.base = normalizeBase(options.base ?? process.env.DSH_WEB_BASE);
    this.token = options.token ?? process.env.DSH_WEB_TOKEN;
    this.cookie = options.cookie;
    this.timeoutMs = Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  /** Exchange the launch token for the signed browser-session cookie. */
  async authenticate() {
    if (this.cookie) return this;
    if (!this.token) throw new Error('no token: pass --token/--token-file or DSH_WEB_TOKEN, or a Cookie via --cookie');
    const url = `${this.base}/?token=${encodeURIComponent(this.token)}`;
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    if (response.status !== 303 && response.status !== 302 && response.status !== 200) {
      throw new Error(`token exchange failed: HTTP ${response.status} (${redact(this.base)})`);
    }
    this.cookie = cookieHeaderFrom(setCookies);
    return this;
  }

  /** One unary Remote call; returns the endpoint value or throws its RemoteError. */
  async rpc(method, args = {}) {
    if (!this.cookie) await this.authenticate();
    const message = buildRpcMessage(method, args, crypto.randomUUID());
    const response = await fetch(`${this.base}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 401) throw new Error(`${method}: authentication failed (401): token/cookie expired`);
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const full = await response.json();
    if (full?.rpcId !== message.rpcId) throw new Error(`${method}: rpcId mismatch`);
    if (!full?.result?.ok) {
      const error = full?.result?.error ?? {};
      throw new Error(`${method}: ${error.code ?? 'remote-error'}: ${redact(error.message ?? 'unknown')}`);
    }
    return full.result.value;
  }

  async listSessions() {
    const value = await this.rpc('session/list', { _request: {} });
    return value.items ?? [];
  }

  async createSession({ cwd, sessionId, agentPreset } = {}) {
    const request = {};
    if (cwd) request.cwd = cwd;
    if (sessionId) request.sessionId = sessionId;
    if (agentPreset) request.agentPreset = agentPreset;
    return this.rpc('session/create', { request });
  }

  /** Send one user message into a Session inbox; returns the Host receipt. */
  async sendPrompt({ sessionId, text, mode = 'queue', requestId } = {}) {
    if (!sessionId) throw new Error('sendPrompt: sessionId is required');
    if (typeof text !== 'string' || text.trim().length === 0) throw new Error('sendPrompt: non-empty text is required');
    return this.rpc('session/prompt', {
      request: {
        requestId: requestId ?? crypto.randomUUID(),
        sessionId,
        mode,
        content: [{ type: 'text', text }],
      },
    });
  }

  /**
   * Open one Gateway logical stream and yield Host items.
   * Caller owns early termination: `for await` breaking sends `cancel`.
   */
  async *openStream(endpoint, payload = { args: {} }, { signal } = {}) {
    if (!this.cookie) await this.authenticate();
    const socketUrl = `${this.base.replace(/^http/, 'ws')}/api/remote.mux`;
    const socket = new WebSocket(socketUrl, { headers: { cookie: this.cookie } });
    const streamId = crypto.randomUUID();
    const inbox = [];
    let done = false;
    let failure;
    let wake;
    const notify = () => { if (wake) { const fn = wake; wake = undefined; fn(); } };
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload }));
    });
    socket.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.streamId !== streamId) return;
        if (frame.type === 'item') inbox.push(frame.value);
        else if (frame.type === 'error') { failure = new Error(`stream ${endpoint}: ${frame.error?.code ?? 'error'}: ${frame.error?.message ?? ''}`); done = true; }
        else if (frame.type === 'end') done = true;
      } catch (error) {
        failure = new Error(`stream ${endpoint}: invalid frame (${redact(error.message)})`);
        done = true;
      }
      notify();
    });
    socket.addEventListener('error', () => { failure = new Error(`stream ${endpoint}: WebSocket failed`); done = true; notify(); });
    socket.addEventListener('close', () => { done = true; notify(); });
    const abort = () => { socket.close(); done = true; notify(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      while (!done || inbox.length > 0) {
        if (inbox.length > 0) { yield inbox.shift(); continue; }
        if (failure) throw failure;
        if (done) return;
        await new Promise((resolve) => { wake = resolve; });
      }
      if (failure) throw failure;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'cancel', streamId }));
        socket.close();
      } else {
        try { socket.close(); } catch { /* already closed */ }
      }
    }
  }

  /**
   * Wait until a Session settled: it was observed running, or its durable
   * activity advanced past the pre-prompt baseline. Polls session/list.
   */
  async waitSettled(sessionId, { timeoutMs = 120_000, intervalMs = 1_000, baselineUpdatedAt = 0 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let sawRunning = false;
    let last;
    while (Date.now() < deadline) {
      const items = await this.listSessions();
      last = items.find((item) => item.sessionId === sessionId);
      if (last?.running) sawRunning = true;
      if (last && !last.running && (sawRunning || last.updatedAt > baselineUpdatedAt)) return last;
      await sleep(intervalMs);
    }
    throw new Error(`waitSettled: ${sessionId} not settled after ${timeoutMs}ms`);
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const [key, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) out[key] = inline;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function loadToken(args) {
  if (args['token-file']) {
    const text = readFileSync(args['token-file'], 'utf8');
    return parseTokenFromStartupLog(text, args.base ?? DEFAULT_BASE);
  }
  return args.token;
}

async function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0] ?? 'help';
  const client = new GatewayClient({
    base: args.base,
    token: loadToken(args),
    cookie: args.cookie,
    timeoutMs: args.timeout ? Number(args.timeout) : undefined,
  });
  if (args.cookie) client.cookie = args.cookie;

  if (command === 'list') {
    const items = await client.listSessions();
    console.log(JSON.stringify(items.map(({ sessionId, running, agentAvailable, blank, cwd, updatedAt }) => ({ sessionId, running, agentAvailable, blank, cwd, updatedAt })), null, 2));
    return 0;
  }
  if (command === 'create') {
    console.log(JSON.stringify(await client.createSession({ cwd: args.cwd, sessionId: args['session-id'], agentPreset: args.preset }), null, 2));
    return 0;
  }
  if (command === 'send') {
    const sessionId = args.session ?? args._[1];
    const text = args.text ?? args._.slice(2).join(' ');
    console.log(JSON.stringify(await client.sendPrompt({ sessionId, text }), null, 2));
    return 0;
  }
  if (command === 'stream') {
    const endpoint = args.endpoint ?? '$events';
    const deadline = Date.now() + (args.timeout ? Number(args.timeout) : 10_000);
    for await (const item of client.openStream(endpoint)) {
      console.log(JSON.stringify(item));
      if (Date.now() > deadline) break;
    }
    return 0;
  }
  if (command === 'selftest') {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-gateway-selftest-'));
    const created = await client.createSession({ cwd });
    const ready = client.openStream('$events')[Symbol.asyncIterator]();
    const first = await ready.next();
    if (first.value?.type !== 'ready') throw new Error(`selftest: expected $events ready, got ${JSON.stringify(first.value)}`);
    await ready.return?.();
    const before = (await client.listSessions()).find((item) => item.sessionId === created.sessionId);
    const receipt = await client.sendPrompt({ sessionId: created.sessionId, text: '只回复两个字：收到' });
    const settled = await client.waitSettled(created.sessionId, {
      timeoutMs: args.timeout ? Number(args.timeout) : 120_000,
      baselineUpdatedAt: before?.updatedAt ?? 0,
    });
    console.log(JSON.stringify({ ok: true, sessionId: created.sessionId, cwd, ready: first.value.type, accepted: receipt.accepted, running: settled.running, updatedAt: settled.updatedAt }, null, 2));
    return 0;
  }
  console.log(`usage:
  dsh-gateway-client.mjs list [--base URL] [--token T | --token-file F | --cookie C]
  dsh-gateway-client.mjs create --cwd PATH [--preset ID]
  dsh-gateway-client.mjs send --session ID --text TEXT [--mode queue|steer]
  dsh-gateway-client.mjs stream [--endpoint $events] [--timeout MS]
  dsh-gateway-client.mjs selftest   # creates one real Session + one model call`);
  return command === 'help' ? 0 : 2;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => {
    console.error(redact(error?.stack ?? error?.message ?? error));
    process.exit(1);
  });
}

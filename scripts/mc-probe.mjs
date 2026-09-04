#!/usr/bin/env node
// ── MC 服务面合成 probe（LG-032 案 a 件④）──
// 模拟 TriRLC 消费端请求形态（src/server/app.ts postHeartbeat/postReplay 同构）：
//   1. healthz（无 token，公开面）
//   2. heartbeat ×3 连发（带 token，5s 超时同消费端）
//   3. events/replay 合成事件 ×3（带 token，10s 超时）+ seq-report 连续性复核
//   4. 401 面：无 token POST heartbeat → 预期 401
//   5. tasks/result 合成一笔回传台账
// 用法：node scripts/mc-probe.mjs [baseUrl] [token]
//   baseUrl 默认 http://127.0.0.1:8710；token 默认 env TRIMC_INTERNAL_TOKEN。
// 退出码：0=全过；1=任一探针失败。

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:8710').replace(/\/$/, '');
const token = process.argv[3] ?? process.env.TRIMC_INTERNAL_TOKEN ?? '';
// 每轮 probe 独立 nodeId（独立 seq 空间——seq-report 按 nodeId 隔离，避免跨轮 dup 误报）
const probeNodeId = `probe-node-${Date.now()}`;

let failures = 0;
function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function req(pathname, { method = 'GET', body, withToken = true, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'content-type': 'application/json' };
    if (withToken && token) headers['X-Internal-Token'] = token;
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. healthz（公开面） ──
{
  const r = await req('/healthz', { withToken: false, timeoutMs: 5000 });
  report('healthz', r.status === 200 && r.json?.ok === true, `mcLedger=${r.json?.mcLedger} cron.enabled=${r.json?.cron?.enabled}`);
}

// ── 2. heartbeat ×3 连发（TriRLC 消费端载荷形态） ──
{
  let allOk = true;
  const details = [];
  for (let i = 0; i < 3; i++) {
    const r = await req('/internal/v1/heartbeat', {
      method: 'POST',
      body: {
        nodeId: probeNodeId,
        state: 'connected',
        queueSize: i,
        uptimeSeconds: 1000 + i,
        agentCoreVersion: 'lg032-probe',
      },
      timeoutMs: 5000,
    });
    const ok = r.status === 200 && r.json?.ok === true;
    allOk = allOk && ok;
    details.push(`#${i + 1}:${ok ? 'ok' : `http=${r.status}`}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  report('heartbeat x3', allOk, details.join(' '));
}

// ── 3. replay 合成事件 ×3 + seq-report 连续性 ──
{
  const events = [1, 2, 3].map((seq) => ({
    eventId: `probe-ev-${Date.now()}-${seq}`,
    type: 'agent_run',
    timestamp: Date.now(),
    seqNo: seq,
    payload: { probe: 'lg032-case-a' },
  }));
  const r = await req('/internal/v1/events/replay', {
    method: 'POST',
    body: { nodeId: probeNodeId, connectionId: 'probe-conn', events },
  });
  const replayOk = r.status === 200 && r.json?.ok === true && r.json?.accepted === 3;
  report('replay x3 accepted', replayOk, `accepted=${r.json?.accepted} conflicts=${r.json?.conflicts?.length ?? '?'} lastSeqNo=${r.json?.lastSeqNo}`);

  const s = await req(`/internal/v1/events/seq-report?nodeId=${encodeURIComponent(probeNodeId)}`);
  const rep = s.json?.report;
  const seqOk = s.status === 200 && rep?.gaps?.length === 0 && rep?.duplicates === 0;
  report('seq continuity', seqOk, `total=${rep?.total} gaps=${rep?.gaps?.length} dups=${rep?.duplicates} lastSeqNo=${rep?.lastSeqNo}`);
}

// ── 4. 401 面（无 token → 401） ──
{
  const r = await req('/internal/v1/heartbeat', { method: 'POST', body: { nodeId: 'probe' }, withToken: false });
  report('401 without token', r.status === 401, `http=${r.status}`);
}

// ── 5. tasks/result 合成一笔 ──
{
  const r = await req('/internal/v1/tasks/result', {
    method: 'POST',
    body: { taskId: `probe-task-${Date.now()}`, sessionId: 'probe-session', status: 'success', result: 'lg032 probe sample' },
  });
  report('tasks/result', r.status === 200 && r.json?.ok === true, `taskId=${r.json?.taskId}`);
}

console.log(failures === 0 ? '\nALL PROBES PASSED' : `\n${failures} PROBE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

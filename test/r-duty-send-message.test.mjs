// ── T4 桥工具白盒族（notice-168·门禁绿 A=plain register 主形·FD 主刀）──
// 运行形（sg 面）: ~/node22/bin/node --test test/r-duty-send-message.test.mjs
// 覆盖面：tool 形断言（plain register 契约面）/bridgeBase 解析序（env→config→缺省
// 8710）/execute 六面（200 回执文本/502 bridge_failed+timedOut/404 not found/网络
// 不可达/自环拒/越形拒·message 必载）——POST 形断言（url/body）+D-46 零信值断言
// （错误面零 message 正文回显）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, resolveBridgeBase, DEFAULT_BRIDGE_BASE } from '../scripts/dsh/r-duty-send-message/index.mjs';

/** fake ctx：register 捕获面。 */
function fakeCtx() {
  const registered = [];
  return { ctx: { tools: { register: (t) => registered.push(t) } }, registered };
}

function makeFetch(responder) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return responder({ url, init });
  };
  return { fetch, calls };
}

function jsonRes(status, doc) {
  return { status, json: async () => doc };
}

/** 装载工具并取 send_message handle（io 缝注入）。 */
function loadTool({ fetch, selfSeat = 'fsd', env, config } = {}) {
  const { ctx, registered } = fakeCtx();
  const io = {};
  if (fetch) io.fetch = fetch;
  if (selfSeat !== undefined) io.selfSeat = selfSeat;
  if (env) io.env = env;
  apply(ctx, config ?? {}, io);
  assert.equal(registered.length, 1, 'register 恰一件');
  const tool = registered[0];
  assert.equal(tool.name, 'send_message');
  return { tool, calls: [] };
}

test('T4: tool 形断言——plain register 契约面（name/parameters/execute）', () => {
  const { tool } = loadTool({ fetch: async () => jsonRes(200, { ok: true, reply: '' }) });
  assert.equal(tool.name, 'send_message');
  assert.ok(typeof tool.description === 'string' && tool.description.length > 10);
  assert.ok(tool.parameters.target_seat, 'target_seat 参数面在');
  assert.equal(tool.parameters.target_seat.required, true);
  assert.ok(tool.parameters.message, 'message 参数面在');
  assert.equal(tool.parameters.message.required, true);
  assert.equal(typeof tool.execute, 'function');
});

test('T4: bridgeBase 解析序——env→config→缺省 8710（本位）', () => {
  assert.equal(resolveBridgeBase({}, { TRIRMC_BRIDGE_BASE: 'http://10.0.0.9:9999' }), 'http://10.0.0.9:9999', 'env 优先');
  assert.equal(resolveBridgeBase({ bridgeBase: 'http://cfg:1' }, {}), 'http://cfg:1', 'config 次之');
  assert.equal(resolveBridgeBase({}, {}), DEFAULT_BRIDGE_BASE, '缺省=127.0.0.1:8710');
  assert.equal(DEFAULT_BRIDGE_BASE, 'http://127.0.0.1:8710');
});

test('T4: execute 200 面——POST 形断言+reply 文本返回', async () => {
  const { fetch, calls } = makeFetch(async ({ url, init }) => {
    assert.equal(url, `${DEFAULT_BRIDGE_BASE}/internal/v1/agents/r-duty-cto/message`, 'url=桥面 lookupKey name 匹配键');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { message: '测试信正文' }, 'body 形=app.ts 桥面契约');
    return jsonRes(200, { ok: true, reply: 'B 席应答回执文本' });
  });
  const { tool } = loadTool({ fetch });
  const reply = await tool.execute({ target_seat: 'cto', message: '测试信正文' });
  assert.equal(reply, 'B 席应答回执文本');
  assert.equal(calls.length, 1);
});

test('T4: execute 502 面——bridge_failed+timedOut 载明', async () => {
  const { fetch } = makeFetch(async () => jsonRes(502, { ok: false, error: 'bridge_failed', timedOut: true }));
  const { tool } = loadTool({ fetch });
  await assert.rejects(() => tool.execute({ target_seat: 'cto', message: 'x' }), /bridge_failed.*timedOut/s);
});

test('T4: execute 404 面——target not found', async () => {
  const { fetch } = makeFetch(async () => jsonRes(404, { ok: false, error: 'agent_not_found' }));
  const { tool } = loadTool({ fetch });
  await assert.rejects(() => tool.execute({ target_seat: 'ghost', message: 'x' }), /not found/);
});

test('T4: execute 网络不可达面——unreachable 载 bridgeBase（零信值）', async () => {
  const { fetch } = makeFetch(async () => { throw new Error('ECONNREFUSED-leak-marker'); });
  const { tool } = loadTool({ fetch, config: { bridgeBase: 'http://cfg-base:1' } });
  await assert.rejects(() => tool.execute({ target_seat: 'cto', message: 'SECRET-MSG-MARKER' }),
    (err) => {
      const m = err.message;
      return m.includes('unreachable') && m.includes('http://cfg-base:1')
        && !m.includes('ECONNREFUSED-leak-marker') && !m.includes('SECRET-MSG-MARKER');
    }, '底层异常与信值双零回显（D-46）');
});

test('T4: 自环守卫——target=self seat 拒（fail-visible）', async () => {
  const { fetch, calls } = makeFetch(async () => { throw new Error('must-not-be-called'); });
  const { tool } = loadTool({ fetch, selfSeat: 'fsd' });
  await assert.rejects(() => tool.execute({ target_seat: 'fsd', message: 'x' }), /自环/);
  assert.equal(calls.length, 0, '自环拒=零 fetch 面');
});

test('T4: 越形与必载守卫——target_seat 形/message 必载', async () => {
  const { fetch, calls } = makeFetch(async () => { throw new Error('must-not-be-called'); });
  const { tool } = loadTool({ fetch });
  await assert.rejects(() => tool.execute({ target_seat: 'BAD SEAT', message: 'x' }), /越形/);
  await assert.rejects(() => tool.execute({ target_seat: 'cto' }), /message 必载/);
  await assert.rejects(() => tool.execute({ target_seat: 'cto', message: '   ' }), /message 必载/);
  assert.equal(calls.length, 0, '守卫拒=零 fetch 面');
});

test('T4: D-46 零信值断言——错误面族全扫零 message 正文回显', async () => {
  const MARK = 'CONFIDENTIAL-BODY-MARKER';
  const cases = [
    makeFetch(async () => jsonRes(502, { ok: false })),
    makeFetch(async () => jsonRes(404, { ok: false })),
    makeFetch(async () => jsonRes(400, { ok: false })),
    makeFetch(async () => { throw new Error('down'); }),
  ];
  for (const { fetch } of cases) {
    const { tool } = loadTool({ fetch });
    try {
      await tool.execute({ target_seat: 'cto', message: MARK });
      assert.fail('预期 throw');
    } catch (err) {
      assert.ok(!err.message.includes(MARK), `错误面零信值: ${err.message.slice(0, 60)}`);
    }
  }
});

// ── token 面补测（2026-11-18 SDE 活体窗前置实勘·daemon TRIRMC_INTERNAL_TOKEN 门
// active 形下 POST 头须带 x-internal-token·app.ts L172-184 读头形）──
test('T4: token 面——env 设值=POST 头带 x-internal-token（io.env 域）', async () => {
  const { fetch, calls } = makeFetch(async () => jsonRes(200, { ok: true, reply: 'pong' }));
  const { tool } = loadTool({ fetch, env: { TRIRMC_INTERNAL_TOKEN: 'tok-abc-123' } });
  const reply = await tool.execute({ target_seat: 'cto', message: 'ping' });
  assert.equal(reply, 'pong');
  assert.equal(calls.length, 1);
  const headers = calls[0].init.headers;
  assert.equal(headers['x-internal-token'], 'tok-abc-123', 'token 头携带');
  assert.equal(headers['content-type'], 'application/json');
});

test('T4: token 面——env 零值=头省略（既有开放形零变）+process.env 回退域', async () => {
  const { fetch, calls } = makeFetch(async () => jsonRes(200, { ok: true, reply: 'pong' }));
  const { tool } = loadTool({ fetch, env: {} });
  await tool.execute({ target_seat: 'cto', message: 'ping' });
  const headers = calls[0].init.headers;
  assert.ok(!('x-internal-token' in headers), '零值形头省略');
  assert.equal(headers['content-type'], 'application/json');
  // process.env 回退域（io.env 未注入形）
  const { fetch: fetch2, calls: calls2 } = makeFetch(async () => jsonRes(200, { ok: true, reply: 'pong' }));
  const { tool: tool2 } = loadTool({ fetch: fetch2 });
  const prev = process.env.TRIRMC_INTERNAL_TOKEN;
  process.env.TRIRMC_INTERNAL_TOKEN = 'tok-proc-456';
  try {
    await tool2.execute({ target_seat: 'cto', message: 'ping' });
    assert.equal(calls2[0].init.headers['x-internal-token'], 'tok-proc-456', 'process.env 回退域携带');
  } finally {
    if (prev === undefined) delete process.env.TRIRMC_INTERNAL_TOKEN;
    else process.env.TRIRMC_INTERNAL_TOKEN = prev;
  }
});

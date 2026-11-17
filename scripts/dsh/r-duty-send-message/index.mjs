// ── r-duty-send-message：席间互发桥工具（T4 桥工具面·notice-168·FD 主刀）──
// 任务书 §三 T4：13 席 preset 挂 SendMessage 桥工具·席间互发经 bridge HTTP API
// （非 dsh 原生 agent-team 面——⑤边界·subagent 族 disabled 照守）。
//
// 形面（T4 门禁绿裁定承录）：
//   · plain register 主形（零 import 依赖=耦合面最少·defineTool=类型 helper 非运行
//     时必需——白盒+活体窗双验证兜契约面失配风险）
//   · execute=fetch POST {bridgeBase}/internal/v1/agents/r-duty-<seat>/message
//     （TriRMC app.ts 现役桥面·寻址三键 name 匹配键=工作区名形）
//   · token 面（2026-11-18 SDE 活体窗前置实勘补装）：daemon TRIRMC_INTERNAL_TOKEN
//     已设=门 active（app.ts L172-184 实勘）——POST 头带 x-internal-token（env 域
//     照 bridgeBase 同序 io.env→process.env）；零值形=头省略（照既有开放形零变）。
//     D-46：token 零回显零落错误面。
//   · 自环守卫（target=self seat=拒 fail-visible·R_DUTY_SEAT env 注入形）
//   · D-46 零信值：错误面/读数面零 message 正文回显
//
// 零 import：ctx.tools.register(plain object)+node 内置 fetch（node ≥18）——
// 插件落位=TriRMC scripts/dsh/（R 面域内聚·patch 条目 name=绝对路径 file 形照
// tricompass-context 先例）。
//
// 挂载面：headless patch 每席 preset plugins 尾追加（T3 生成器 --with-bridge-tool
// flag 产形）——patch 条目形：
//     - id: r-duty-send-message
//       name: /srv/fleet/TriRMC/scripts/dsh/r-duty-send-message/index.mjs
//       config:
//         bridgeBase: http://127.0.0.1:8710   # 可省（缺省形）
//
// io 缝（apply 第三参·白盒注入面·运行时 cordis 只传两参）：
//   io.fetch=fetch 实现 stub；io.selfSeat=自环守卫 seat 名 stub；
//   io.env=bridgeBase env 域 stub。

const name = 'r-duty-send-message';
const inject = ['tools'];
const DEFAULT_BRIDGE_BASE = 'http://127.0.0.1:8710';

/** bridgeBase 解析序：env TRIRMC_BRIDGE_BASE → config.bridgeBase → 缺省 8710（本位）。 */
export function resolveBridgeBase(config, env) {
  const e = env ?? process.env;
  const fromEnv = typeof e.TRIRMC_BRIDGE_BASE === 'string' ? e.TRIRMC_BRIDGE_BASE.trim() : '';
  if (fromEnv) return fromEnv;
  const fromConfig = typeof config?.bridgeBase === 'string' ? config.bridgeBase.trim() : '';
  if (fromConfig) return fromConfig;
  return DEFAULT_BRIDGE_BASE;
}

export function apply(ctx, config, io = {}) {
  const fetchImpl = io.fetch ?? globalThis.fetch;
  const selfSeat = typeof io.selfSeat === 'string' ? io.selfSeat : (process.env.R_DUTY_SEAT ?? '').trim();
  const env = io.env;

  ctx.tools.register({
    name: 'send_message',
    description:
      'Send a message to another duty-seat session (r-duty-<seat>) through the TriRMC message bridge. ' +
      'Delivers the text and returns the target session reply text. Do not use for file delivery; ' +
      'one message per call; the reply is the other seat answer, not an acknowledgement.',
    parameters: {
      target_seat: {
        type: 'string',
        required: true,
        description: 'Target duty seat short name (e.g. "cto" delivers to r-duty-cto). Must not be your own seat.',
      },
      message: {
        type: 'string',
        required: true,
        description: 'Message text delivered verbatim to the target session.',
      },
    },
    async execute(args) {
      const target = String(args?.target_seat ?? '').trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(target)) {
        throw new Error('send_message: target_seat 越形（短名域 [a-z0-9-]）');
      }
      if (selfSeat && target === selfSeat) {
        throw new Error(`send_message: 自环投递拒（target=self seat ${selfSeat}·fail-visible）`);
      }
      const message = args?.message;
      if (typeof message !== 'string' || message.trim() === '') {
        throw new Error('send_message: message 必载（非空串）');
      }
      const base = resolveBridgeBase(config, env);
      const envDomain = env ?? process.env;
      const internalToken = typeof envDomain.TRIRMC_INTERNAL_TOKEN === 'string'
        ? envDomain.TRIRMC_INTERNAL_TOKEN.trim()
        : '';
      const url = `${base}/internal/v1/agents/r-duty-${target}/message`;
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: internalToken
            ? { 'content-type': 'application/json', 'x-internal-token': internalToken }
            : { 'content-type': 'application/json' },
          body: JSON.stringify({ message }),
        });
      } catch {
        throw new Error(`send_message: bridge unreachable（${base}·TriRMC daemon 面勘定候）`);
      }
      let doc = null;
      try {
        doc = await res.json();
      } catch {
        doc = null;
      }
      if (res.status === 200 && doc?.ok) {
        return String(doc.reply ?? '');
      }
      if (res.status === 404) {
        throw new Error('send_message: target not found（registry 无此席·list 面对表）');
      }
      if (res.status === 502) {
        throw new Error(`send_message: bridge_failed${doc?.timedOut ? '（timedOut）' : ''}`);
      }
      throw new Error(`send_message: bridge error status=${res.status}`);
      // D-46：以上错误面全部零 message 正文回显 ✓
    },
  });
}

export { name, inject, DEFAULT_BRIDGE_BASE };

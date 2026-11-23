// ── FADE-001 D7 真发活体段·点火入口件（装配+判读打印形） ──
// D1 卷 §三点火钥匙与 IO 面照铸：点火指令消费+装配 runner（makeChainRunner+runLoop）+
// LoopOutcome 白名单投影打印——零新判读逻辑（三层判据族零新增·两件白盒已锚）。
//
// checks 采集位=调用面（值席起跑前采集 A1-A4 四布尔·activation_gate.py 白名单 schema）：
//   A1_d1_d5_done / A2_whitebox_zero_new_red / A3_guard_anchors_ok / A4_equivalence_and_zero_touch
//   可选 release_ref=放行令面（在=released·缺=首轮毕停点正形）——本件零隐式缺省值
//   （采集显式性=值席面职责·--checks-json 必传面）。
// 首轮毕知情停点（COO 释放令条款④）：gate first_round_pending=stop→链毕停面候 CEO 知情
// 放行→呈报 BOD 链→放行候 COO 定谳令（停点语义=gateVerdict fail-closed 铸形）。
//
// 用法（产线跑面=sg /srv/fleet/TriRMC·TC 检出=/srv/fleet/TriCompany 929 现位）：
//   tsx scripts/fade001-ignite.ts --run-dir <dir> --run-id <id> \
//     --from-week 2026-W47 --to-week 2026-W48 --start-date 2026-11-23 \
//     --tmv-root /srv/fleet/TriMetaverse --tri-company-root /srv/fleet/TriCompany \
//     --queue-root /srv/fleet/TriRMC/round-queue \
//     --checks-json '{"A1_d1_d5_done":true,...}'
//
// 护栏承录：GLM 轨单跑（同窗并发 1·本件串行零并发点火）·D-46 打印白名单投影·
// D-47 nowIso=进程内现查原值（件内零推算）。

import { makeChainRunner } from '../src/fade001/chain_runner.js';
import { probeActivationGate, runLoop } from '../src/fade001/round_runner.js';
import type { RoundRunnerIo } from '../src/fade001/round_runner.js';
// DP-20261123-032（D-91 链跑期禁推）：链跑态 marker——启动写/退出删/闸端 stale>2h 保护
import { writeChainMarker, clearChainMarker, writeChainMarkerRef, clearChainMarkerRef } from '../src/fade001/chain_marker.js';

interface IgniteArgs {
  runDir: string;
  runId: string;
  fromWeek: string;
  toWeek: string;
  startDate: string;
  tmvRoot: string;
  triCompanyRoot: string;
  queueRoot: string;
  checksJson: string;
  pythonBin?: string;
}

function parseArgs(argv: string[]): IgniteArgs {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined) throw new Error(`参数缺值: --${key}`);
      m.set(key, val);
      i++;
    }
  }
  const req = (k: string): string => {
    const v = m.get(k);
    if (!v) throw new Error(`必载参数缺: --${k}`);
    return v;
  };
  return {
    runDir: req('run-dir'),
    runId: req('run-id'),
    fromWeek: req('from-week'),
    toWeek: req('to-week'),
    startDate: req('start-date'),
    tmvRoot: req('tmv-root'),
    triCompanyRoot: req('tri-company-root'),
    queueRoot: req('queue-root'),
    checksJson: req('checks-json'),
    pythonBin: m.get('python-bin'),
  };
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const checks = JSON.parse(a.checksJson) as Record<string, unknown>;
  // DP-032 R 形（CTO 裁）：跨机 marker=bare ref（主）；push 失败=本地文件兜底+告警（闸端 fail-open）
  if (!writeChainMarkerRef(a.triCompanyRoot, a.runId)) {
    writeChainMarker(a.runId);   // 兜底：本地文件哨（同机闸可用面）
  }
  try {

  const chain = makeChainRunner({ triCompanyRoot: a.triCompanyRoot, pythonBin: a.pythonBin });
  const io: RoundRunnerIo = {
    queueRoot: a.queueRoot,
    chainRunner: chain,
    nowIso: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),   // D-47 进程内现查原值
    activationProbe: (c) => probeActivationGate({ triCompanyRoot: a.triCompanyRoot, pythonBin: a.pythonBin }, c),
  };

  const outcome = await runLoop(io, {
    params: {
      run_id: a.runId,
      runDir: a.runDir, runId: a.runId, fromWeek: a.fromWeek, toWeek: a.toWeek,
      startDate: a.startDate, tmvRoot: a.tmvRoot, queueRoot: a.queueRoot, round: 0,   // DP-038/T4：flag 门读面
    },
    checks,
  });

  // 白名单投影打印（D-46：LoopOutcome 面+stages_run 段名读数·零原始卷 dump 零密值）
  process.stdout.write(JSON.stringify({
    exit: outcome.exit,
    rounds_run: outcome.rounds_run,
    rounds_started: outcome.rounds_started,   // DP-037/T5：尝试轮计数（失败轮可见）
    final_state: outcome.final_state,
    stages_run: chain.stagesRun,
  }, null, 2) + '\n');
  } finally {
    clearChainMarkerRef(a.triCompanyRoot);   // R 形撤哨（ref 删）
    clearChainMarker();                      // 兜底文件撤哨（pid 归属比对防误删他链）
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`ignite failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

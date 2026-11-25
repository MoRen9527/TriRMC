/**
 * 任务书生成器（COS 主笔·fade-001 自进化 loop·P4 直接启用形）
 *
 * 依据：CTO P4 定稿卷 be7afadff（§一 落形七步/§二 接口两字段/§三 两红线）
 *       + CTO 块一 f46628ec（五字段 schema 来源）
 *       + D-86（§二 自动拾取五款·缺批不拾取 fail-closed）
 *       + CEO 定夺（自动拾取直接启用·评批分离 CEO 批本批）
 *
 * 职责：debug 轮 7 席联审产出 opinions.json → 五字段机械映射 → 任务书 JSON
 *   - 五字段强制：title / target / change / verify / rollback（+来源指针 opinion_id / run_id）
 *   - 缺 target/verify/rollback = 退回人工（不生成·fail-closed 不静默降级）
 *   - auto_dispatch 默认不置 true（红线二：CEO 批面显式赋予·脚本层兜死）
 *   - 产物即 pending_approval 态（审批 gate=CEO/COS 人环·生成本身零批准效力）
 *
 * 纯函数核心 + CLI 薄壳（与 round_runner.ts 同风格·零第三方依赖）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 任务书 schema 版本（与 fsd P4 接口面 schema_version 对齐·1.0.0） */
export const CHARTER_SCHEMA_VERSION = '1.0.0';

/** opinions.json 单条意见（最小必填面；其余字段透传不校验） */
export interface OpinionEntry {
  opinion_id: string;
  title: string;
  owner_seat?: string;   // R10-CHO-01（CEO 批讫）：improvements owner_seat 枚举席位面（可选·有则校验非空透传）
  target?: string | null;
  change?: string | null;
  verify?: string | null;
  rollback?: string | null;
  seat?: string | null;
  [k: string]: unknown;
}

/** opinions.json 文档形（debug 轮联审产出） */
export interface OpinionsDoc {
  schema_version?: string | null;
  run_id?: string | null;
  round?: number | null;
  opinions: OpinionEntry[];
}

/** 任务书条目（五字段全齐形） */
export interface CharterItem {
  opinion_id: string;
  title: string;
  target: string;
  change: string;
  verify: string;
  rollback: string;
  owner_seat?: string;                                  // DP-035（五→六字段）
  covered_dims?: string[];                              // T1② 覆盖校验原料
  [k: string]: unknown;                                 // 透传位（六字段外扩展容忍）
}

/** 任务书草稿（pending_approval·不含 auto_dispatch 除显式授予） */
export interface CharterDraft {
  schema_version: string;
  charter_id: string;
  source: { run_id: string | null; round: number | null; opinion_ids: string[] };
  approver_pending: 'CEO' | 'COS';
  status: 'pending_approval';
  items: CharterItem[];
  auto_dispatch?: true;
  aggregation?: { items_before?: number; items_included?: number; dropped?: unknown[] };
}

export interface GenerateResult {
  ok: boolean;
  charter?: CharterDraft;
  /** 退回人工的意见（缺字段族） */
  rejects: Array<{ opinion_id: string; missing: string[] }>;
  reason?: string;
}

/** 五字段机械映射强制面（title 单独校验；空串视同缺失） */
// T1/R5（任务书 v2·CEO 批）：改进项**六字段**强制（五字段+owner_seat）
const REQUIRED_FIELDS = ['target', 'change', 'verify', 'rollback', 'owner_seat'] as const;

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 生成任务书草稿（纯函数·零副作用）。
 * @param doc opinions.json 解析对象
 * @param opts.approver 审批人分配（debug 链=CEO；test/prod 代批=COS）·默认 CEO
 * @param opts.date 日期戳 YYYYMMDD（charter_id 用）·默认取 opts.now
 * @param opts.now 时点注入（测试用）
 * @param opts.autoDispatch 仅 CEO 批面显式授予时传 true（红线二·默认不置）
 */
export function generateCharter(
  doc: OpinionsDoc,
  opts: { approver?: 'CEO' | 'COS'; date?: string; now?: Date; autoDispatch?: boolean } = {},
): GenerateResult {
  const approver = opts.approver ?? 'CEO';
  const rejects: Array<{ opinion_id: string; missing: string[] }> = [];

  // 两形兼容（CTO 令 2026-11-25·COS 核 R-HY）：A 形=doc.opinions 数组（照旧）；
  // B 形=per-seat 文件 {schema_version,seat,face{dimensions,improvements,violations}} →
  // 顶层 doc.face.improvements 当意见数组（五字段已在 improvement 内·owner_seat 取 seat）。
  const _anyDoc = doc as unknown as Record<string, unknown>;
  let _opsIn: unknown[] = Array.isArray(_anyDoc.opinions) ? (_anyDoc.opinions as unknown[]) : [];
  if (_opsIn.length === 0) {
    const face = _anyDoc.face as Record<string, unknown> | undefined;
    const imps = face && Array.isArray(face.improvements) ? (face.improvements as unknown[]) : [];
    if (imps.length > 0) {
      const seat = String(_anyDoc.seat ?? 'seat');
      const ownerSeat = String(_anyDoc.owner_seat ?? seat);
      _opsIn = imps.map((it, i) => {
        const rec = (it ?? {}) as Record<string, unknown>;
        return { ...rec, opinion_id: nonEmpty(rec.title) ? String(rec.title) : `${seat}-${i}`, owner_seat: ownerSeat };
      });
    }
  }
  if (_opsIn.length === 0) {
    return { ok: false, rejects, reason: 'opinions 空或非数组——无可映射意见（A/B 两形皆空）' };
  }

  const items: CharterItem[] = [];
  for (const o of _opsIn as Array<Record<string, unknown>>) {
    const missing: string[] = [];
    if (!nonEmpty(o.opinion_id as string)) missing.push('opinion_id');
    if (!nonEmpty(o.title as string)) missing.push('title');
    for (const f of REQUIRED_FIELDS) {
      if (!nonEmpty((o as Record<string, unknown>)[f])) missing.push(f);
    }
    if (missing.length > 0) {
      rejects.push({ opinion_id: nonEmpty(o.opinion_id as string) ? String(o.opinion_id) : '<missing>', missing });
      continue;
    }
    items.push({
      opinion_id: String(o.opinion_id),
      title: String(o.title),
      target: o.target as string,
      change: o.change as string,
      verify: o.verify as string,
      rollback: o.rollback as string,
      owner_seat: String((o as Record<string, unknown>).owner_seat),
    });
  }

  // ── T1②（任务书 v2·R5/R16/R18）：族归并 ≤5 条/轮 + 低分维覆盖校验（两级形·D3）──
  const itemsBefore = items.length;
  // 去重：同 (title,target) 视为同族重复意见 → 合一件（v8 item12：全纳重写——条数不限）
  const seen = new Set<string>();
  const mergedReport: Array<{ opinion_id: string; title: string; target: string }> = [];
  const deduped = items.filter((it) => {
    const k = `${it.title}|${it.target}`;
    if (seen.has(k)) {
      mergedReport.push({ opinion_id: it.opinion_id, title: it.title, target: it.target });   // 去重合并可溯源（原 opinion_id/title/target·r34 落痕）
      return false;
    }
    seen.add(k);
    return true;
  });
  const capped = deduped;          // v8 item12（CEO 批）：每席直提条数不限——全纳
  const dropped = mergedReport;    // 语义改=仅「去重合并报告」（{opinion_id,title}·非截断清单）
  // 低分维覆盖：opinions[].scores 中 <60 的维，须被任一件 target/covered_dims 覆盖
  const lowDims: string[] = [];
  for (const o of _opsIn as Array<Record<string, unknown>>) {
    const scores = o.scores;
    if (scores && typeof scores === 'object') {
      for (const [dim, sc] of Object.entries(scores as Record<string, unknown>)) {
        if (typeof sc === 'number' && sc < 60) lowDims.push(dim);
      }
    }
  }
  const coverageText = capped.map((it) => `${it.target} ${String((it as Record<string, unknown>).covered_dims ?? '')}`).join(' ');
  const uncovered = [...new Set(lowDims)].filter((dim) => dim && !coverageText.includes(dim));
  const coverageGate = (process.env.TRICO_COVERAGE_GATE ?? 'lenient').toLowerCase();
  if (uncovered.length && coverageGate === 'strict') {
    return { ok: false, rejects, reason: `低分维未覆盖：${uncovered.slice(0, 8).join(',')}（T1② strict 形）` };
  }
  if (uncovered.length) {
    console.error(`[charter-generator][WARN] 低分维未覆盖（lenient 留痕）: ${uncovered.slice(0, 8).join(',')}`);
  }
  items.length = 0;
  items.push(...capped);

  // fail-closed：任何一条不可机械映射 = 整卷退回人工（缺 target/verify/rollback 族）
  if (rejects.length > 0) {
    return {
      ok: false,
      rejects,
      reason: `${rejects.length} 条意见缺五字段面——退回人工补全（缺 target/verify/rollback 不可机械映射·CTO 块一）`,
    };
  }

  const now = opts.now ?? new Date();
  const date = opts.date ?? `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const round = doc.round ?? null;
  const charter: CharterDraft = {
    schema_version: CHARTER_SCHEMA_VERSION,
    charter_id: `r${round ?? 'N'}-task-${date}`,
    source: {
      run_id: doc.run_id ?? null,
      round,
      opinion_ids: items.map((i) => i.opinion_id),
    },
    approver_pending: approver,
    status: 'pending_approval',
    items,
    // T1②：聚合计（族归并/截断留痕·供审计）
    aggregation: { items_before: itemsBefore, items_included: capped.length, dropped },
  };
  // 红线二：auto_dispatch 仅显式授予才写·默认不置（脚本层兜死·防误扩大自动面）
  if (opts.autoDispatch === true) charter.auto_dispatch = true;
  return { ok: true, charter, rejects };
}

/** 从磁盘读 opinions.json 并生成（CLI/集成共用） */
export function generateCharterFromFile(
  opinionsPath: string,
  opts: { approver?: 'CEO' | 'COS'; date?: string; autoDispatch?: boolean } = {},
): GenerateResult {
  if (!existsSync(opinionsPath)) {
    return { ok: false, rejects: [], reason: `opinions 文件不存在: ${opinionsPath}` };
  }
  let doc: OpinionsDoc;
  try {
    doc = JSON.parse(readFileSync(opinionsPath, 'utf8')) as OpinionsDoc;
  } catch (e) {
    return { ok: false, rejects: [], reason: `opinions JSON 解析失败: ${(e as Error).message}` };
  }
  if (nonEmpty(doc.schema_version) && doc.schema_version !== CHARTER_SCHEMA_VERSION) {
    // 版本适配提示（不阻断：字段面兼容由校验兜底·CTO P4 卷 §二 schema_version 读版本适配）
    process.stderr.write(`[charter_generator] schema_version ${doc.schema_version} != ${CHARTER_SCHEMA_VERSION}（按字段面校验继续）\n`);
  }
  return generateCharter(doc, opts);
}

// ── CLI 薄壳：node --import tsx src/fade001/charter_generator.ts <opinions.json> [out.json] ──
const isMain = process.argv[1] && basename(fileURLToPath(import.meta.url)) === basename(process.argv[1]);
if (isMain) {
  const [, , opinionsPath, outPath] = process.argv;
  if (!opinionsPath) {
    process.stderr.write('usage: charter_generator <opinions.json> [charter_out.json]\n');
    process.exit(2);
  }
  const res = generateCharterFromFile(opinionsPath);
  if (!res.ok) {
    process.stderr.write(`[charter_generator] 退回人工: ${res.reason}\n`);
    for (const r of res.rejects) process.stderr.write(`  - ${r.opinion_id}: missing ${r.missing.join(',')}\n`);
    process.exit(1);
  }
  const out = outPath ?? join(dirname(opinionsPath), `${res.charter!.charter_id}.json`);
  writeFileSync(out, JSON.stringify(res.charter, null, 2), 'utf8');
  process.stdout.write(`[charter_generator] ok charter=${res.charter!.charter_id} approver=${res.charter!.approver_pending} status=pending_approval -> ${out}\n`);
}

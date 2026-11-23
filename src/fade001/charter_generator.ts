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
}

export interface GenerateResult {
  ok: boolean;
  charter?: CharterDraft;
  /** 退回人工的意见（缺字段族） */
  rejects: Array<{ opinion_id: string; missing: string[] }>;
  reason?: string;
}

/** 五字段机械映射强制面（title 单独校验；空串视同缺失） */
const REQUIRED_FIELDS = ['target', 'change', 'verify', 'rollback'] as const;

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

  if (!Array.isArray(doc.opinions) || doc.opinions.length === 0) {
    return { ok: false, rejects, reason: 'opinions 空或非数组——无可映射意见' };
  }

  const items: CharterItem[] = [];
  for (const o of doc.opinions) {
    const missing: string[] = [];
    if (!nonEmpty(o.opinion_id)) missing.push('opinion_id');
    if (!nonEmpty(o.title)) missing.push('title');
    for (const f of REQUIRED_FIELDS) {
      if (!nonEmpty((o as Record<string, unknown>)[f])) missing.push(f);
    }
    if (missing.length > 0) {
      rejects.push({ opinion_id: nonEmpty(o.opinion_id) ? o.opinion_id : '<missing>', missing });
      continue;
    }
    items.push({
      opinion_id: o.opinion_id,
      title: o.title,
      target: o.target as string,
      change: o.change as string,
      verify: o.verify as string,
      rollback: o.rollback as string,
      ...(nonEmpty((o as Record<string, unknown>).owner_seat)
        ? { owner_seat: String((o as Record<string, unknown>).owner_seat) }
        : {}),
    });
  }

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

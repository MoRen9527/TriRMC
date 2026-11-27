// CAO 批门规范 v1.1（TC@1bc7098+e11f1e0·指纹=唯一内容绑定）——独立模块
// （charter_generator 签名侧/round_runner 消费侧/测试三方共用·零循环依赖）。
// 指纹实现与 taskcharter-fingerprint-ref.mjs 逐字同义；门全序与
// taskcharter-gate-ref.py gate() 同构+三裁定（CTO 2026-11-27T23:11 令）：
//   R-a 缺 cao_approval 块／非对象／approved 非 true → CAO_NOT_APPROVED（非 GATE_TOOL_FAIL）
//   R-b commit 键可缺=合法（信息字段·不判·指纹置空对缺失键=no-op·n 判=指纹键命中≥1）
//   R-c 指纹值畸形（非 16 位小写 hex）→ FINGERPRINT_MISSING（detail「指纹畸形」·修复=重签）
import { createHash } from 'node:crypto';

const FP_KEYS = ['content_sha256_16', 'commit'];
const FP_BACKSLASH = String.fromCharCode(92);

function fpFindKey(line: string, key: string, quoted: boolean): [number, number] | null {
  const pat = quoted ? '"' + key + '"' : key;
  const a = line.indexOf(pat); if (a < 0) return null;
  if (!quoted && a > 0 && /[A-Za-z0-9_]/.test(line[a - 1]!)) return null;
  const c = line.indexOf(':', a + pat.length); if (c < 0) return null;
  const o = line.indexOf('"', c + 1); if (o < 0) return null;
  let p = o + 1;
  while (p < line.length) { if (line[p] === FP_BACKSLASH) { p += 2; continue; } if (line[p] === '"') break; p++; }
  if (p >= line.length) return null;
  return [o, p];
}
function fpBlankLine(line: string, quoted: boolean): [string, number] {
  let hits = 0;
  for (const key of FP_KEYS) { const r = fpFindKey(line, key, quoted); if (!r) continue; line = line.slice(0, r[0] + 1) + line.slice(r[1]); hits++; }
  return [line, hits];
}
function fpBlankJson(text: string): [string, number] {
  const a = text.indexOf('"cao_approval"'); if (a < 0) return [text, 0];
  const head = text.slice(0, a), lines = text.slice(a).split('\n'); let n = 0;
  for (let i = 0; i < lines.length; i++) { const [l, h] = fpBlankLine(lines[i]!, true); lines[i] = l; n += h; }
  return [head + lines.join('\n'), n];
}
function fpBlankYaml(text: string): [string, number] {
  const lines = text.split('\n'); let n = 0;
  const i = lines.findIndex(l => l.trimEnd().endsWith('cao_approval:')); if (i < 0) return [text, 0];
  const ind = lines[i]!.length - lines[i]!.trimStart().length;
  for (let k = i + 1; k < lines.length; k++) {
    const l2 = lines[k]!; if (l2.trim() === '') continue;
    if (l2.trim() === '---' || (l2.length - l2.trimStart().length) <= ind) break;
    const [l, h] = fpBlankLine(lines[k]!, false); lines[k] = l; n += h;
  }
  return [lines.join('\n'), n];
}
/** 规范 v1.1 指纹：严格 UTF-8（U+FEFF 计入——ignoreBOM:true=「不剥 BOM」反直觉
 *  命名·跨语言对表 V04 实锚）→ 文本层置空两键值（JSON 形自首个 "cao_approval"
 *  起·YAML 形仅首个 cao_approval: 块内·禁 parse→dump）→ 只换 CRLF→LF（孤立
 *  \r 不动）→ sha256 前 16 hex。非 UTF-8 原字节走原字节分支（n=-1·V06 形）。
 *  n=两键在文件中的命中数（与值是否为空无关）。 */
export function fingerprintBytes(buf: Buffer): [string, number] {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf); }
  catch { return [createHash('sha256').update(buf).digest('hex').slice(0, 16), -1]; }
  const isYaml = text.split('\n').slice(0, 200).some(l => l.trimEnd().endsWith('cao_approval:'));
  const [s, n] = isYaml ? fpBlankYaml(text) : fpBlankJson(text);
  const norm = s.replace(/\r\n/g, '\n');
  return [createHash('sha256').update(Buffer.from(norm, 'utf8')).digest('hex').slice(0, 16), n];
}

export type CharterGateCode = 'PASS' | 'CAO_NOT_APPROVED' | 'FINGERPRINT_MISSING' | 'CONTENT_CHANGED' | 'GATE_TOOL_FAIL';
export interface CharterGateResult { code: CharterGateCode; detail: string }

/** CAO 批门规范 v1.1 全序门（G0→G3·与 taskcharter-gate-ref.py gate() 同构+三裁定）：
 *  G0 工具/解析 → G1 准入 → G2 指纹在位 → G3 内容绑定。fail-closed：任何读/解码/
 *  计算/指纹计算异常一律 GATE_TOOL_FAIL——「取值失败≠空值」；文件内容问题一律
 *  内容层码（R-a/R-c·修复动作不同）。BOM（§六 裁定 B）：解析层取字段前剥串首
 *  U+FEFF；指纹层对原字节算（BOM 计入）——两步勿混。 */
export function charterGateCheck(raw: Buffer): CharterGateResult {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }   // 指纹层口径：严格·U+FEFF 保留
  catch { return { code: 'GATE_TOOL_FAIL', detail: 'not UTF-8' }; }
  let d: unknown;
  try { d = JSON.parse(text.replace(new RegExp('^' + String.fromCharCode(0xFEFF) + '+', 'u'), '')); }   // 解析层：仅此一步剥 BOM
  catch (e) { return { code: 'GATE_TOOL_FAIL', detail: 'parse ' + (e instanceof Error ? e.name : 'Error') }; }
  // R-a：内容层码——缺块/非对象/approved 非 true 均 CAO_NOT_APPROVED（非 GATE_TOOL_FAIL）
  if (typeof d !== 'object' || d === null) return { code: 'CAO_NOT_APPROVED', detail: 'cao_approval 块缺失' };
  const ca = (d as Record<string, unknown>).cao_approval;
  if (typeof ca !== 'object' || ca === null || Array.isArray(ca)) return { code: 'CAO_NOT_APPROVED', detail: 'cao_approval 块缺失/非对象' };
  const caRec = ca as Record<string, unknown>;
  if (caRec.approved !== true) return { code: 'CAO_NOT_APPROVED', detail: `approved=${JSON.stringify(caRec.approved)}（需 true）` };
  const fpv = caRec.content_sha256_16;
  if (typeof fpv !== 'string' || fpv === '') return { code: 'FINGERPRINT_MISSING', detail: `content_sha256_16=${JSON.stringify(fpv)}` };
  let now = ''; let n = 0;
  try { [now, n] = fingerprintBytes(raw); }                                                // 原字节·含 BOM
  catch (e) { return { code: 'GATE_TOOL_FAIL', detail: 'fingerprint ' + (e instanceof Error ? e.name : 'Error') }; }
  // R-b：commit 键可缺=合法——n 判=指纹键命中≥1（非恰 2）
  if (n < 1) return { code: 'GATE_TOOL_FAIL', detail: `expected fingerprint key hit n>=1, got n=${n}` };
  // R-c：指纹畸形=内容层码 FINGERPRINT_MISSING（修复=重签）
  if (!/^[0-9a-f]{16}$/.test(fpv)) return { code: 'FINGERPRINT_MISSING', detail: `指纹畸形（须 16 位小写 hex）=${JSON.stringify(fpv)}` };
  if (fpv !== now) return { code: 'CONTENT_CHANGED', detail: `file=${now} signed=${fpv}` };
  return { code: 'PASS', detail: `commit_info=${JSON.stringify(caRec.commit ?? '')}` };
}

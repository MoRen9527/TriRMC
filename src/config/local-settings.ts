// ── LG-058 N5 方案三：本域本地配置落地（拉→落→效链的「落」兑现点）──
// settings.json 系 CEO 原话词汇=「该域本地落地配置」语义；本仓实态落地文件=
// $TRIRMC_CONFIG_DIR/settings.json（BOD 转嘱：不硬造文件——本文件由 readEnv
// 经 settingOrEnv 真消费）。写入=原子写（tmp+rename 同族）；读容错=缺文件/
// 畸形→空表（daemon 维持现值，诚实降级）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function trirmcConfigDir(): string {
  return process.env.TRIRMC_CONFIG_DIR?.trim() || 'data';
}

export function localSettingsPath(): string {
  return join(trirmcConfigDir(), 'settings.json');
}

export interface LocalSettingsDoc {
  updated_at: string | null;
  items: Record<string, string>;
}

export function readLocalSettings(): LocalSettingsDoc {
  const p = localSettingsPath();
  if (!existsSync(p)) return { updated_at: null, items: {} };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<LocalSettingsDoc>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.items !== 'object' || parsed.items === null) {
      return { updated_at: null, items: {} };
    }
    const items: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.items)) {
      if (typeof v === 'string') items[k] = v;
    }
    return { updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : null, items };
  } catch {
    return { updated_at: null, items: {} };
  }
}

export interface LocalSettingsWriteResult {
  ok: boolean;
  file: string;
  error?: string;
}

export function writeLocalSettings(items: Record<string, string>): LocalSettingsWriteResult {
  const p = localSettingsPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ updated_at: new Date().toISOString(), items }, null, 2)}\n`, 'utf-8');
    renameSync(tmp, p);
    return { ok: true, file: p };
  } catch (err) {
    return { ok: false, file: p, error: err instanceof Error ? err.message : String(err) };
  }
}

/** readEnv 叠加读取：env 钉定项以 env 为准（安全——误推不可解除服务端口等
 * 连通性钉定）；settings 表单值只补 env 未钉的位（直改兑现面）。 */
export function settingOrEnv(key: string): string | undefined {
  const env = process.env[key];
  if (env !== undefined && env !== '') return env;
  return readLocalSettings().items[key];
}

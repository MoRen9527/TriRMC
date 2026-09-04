import * as path from 'node:path';

export type TriMCEnv = {
  port: number;
  tristacissBaseUrl: string;
  openclawGatewayUrl: string;
  vscodiumGlueBaseUrl: string;
  /** Working directory for tool execution */
  cwd: string;
  /** Root path for stateful memory files (from TRIRMC_MEMDIR). When unset, memory injection is skipped. */
  memdirPath?: string;
  /** M1 Phase-2: session-bridge 降权账号（如 fleet）；不设则以当前用户直跑（本地开发） */
  runAsUser?: string;
  /** M1 Phase-2: claude 会话工作目录（默认 /srv/fleet） */
  bridgeCwd: string;
  /** cron scheduler 开关（TRIRMC_CRON_ENABLED !== 'false' 时启用） */
  cronEnabled: boolean;
  /** cron per-run 日志目录（TRIRMC_CRON_LOG_DIR）；不设则由 cron service 落 TRIRMC_CONFIG_DIR/cron/logs */
  cronLogDir?: string;
  /** 模型 default 三级解析最高优先（TRIRMC_DEFAULT_MODEL，i4-2 §四）；
   *  不设 → applied bundle model.defaultModel → 兜底常量。 */
  defaultModel?: string;
  /** LG-032 案 a 件②：MC 服务面台账 sqlite 路径（TRIRMC_MC_DB_PATH）。
   *  不设 → $TRIRMC_CONFIG_DIR/mc-store.sqlite；部署面 trirmc-mc.service 独立实例
   *  与现有 trirmc.service 各持一份 db（WAL 多进程安全，仍按实例分文件零共享）。 */
  mcDbPath: string;
};

export function readEnv(): TriMCEnv {
  const configDir = process.env.TRIRMC_CONFIG_DIR ?? path.resolve('data');
  return {
    port: Number(process.env.TRIRMC_PORT ?? 8712),
    tristacissBaseUrl: process.env.TRISTACISS_BASE_URL ?? 'http://127.0.0.1:8008',
    openclawGatewayUrl: process.env.OPENCLOW_GATEWAY_URL ?? 'ws://127.0.0.1:8822',
    vscodiumGlueBaseUrl: process.env.VSCODIUM_GLUE_BASE_URL ?? 'http://127.0.0.1:8730',
    cwd: process.env.TRIRMC_CWD ?? process.cwd(),
    memdirPath: process.env.TRIRMC_MEMDIR || undefined,
    runAsUser: process.env.TRIRMC_RUNAS || undefined,
    bridgeCwd: process.env.TRIRMC_BRIDGE_CWD ?? '/srv/fleet',
    cronEnabled: process.env.TRIRMC_CRON_ENABLED !== 'false',
    cronLogDir: process.env.TRIRMC_CRON_LOG_DIR || undefined,
    defaultModel: process.env.TRIRMC_DEFAULT_MODEL || undefined,
    mcDbPath: process.env.TRIRMC_MC_DB_PATH ?? path.join(configDir, 'mc-store.sqlite'),
  };
}

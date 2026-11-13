import * as path from 'node:path';
import { settingOrEnv } from './local-settings.js';

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
  /** FADE-001 告警闸主开关（TRIRMC_ALARM_ENABLED !== 'false' 时启用；
   *  实际生效还需至少一条外发通道配置——alarm-wiring 零通道=disabled） */
  alarmEnabled: boolean;
  /** SMTP 主形凭据族（TRIRMC_ALARM_SMTP_HOST/PORT/USER/PASS/FROM/TO）——值面零回显（D-46） */
  alarmSmtpHost?: string;
  alarmSmtpPort?: number;
  alarmSmtpUser?: string;
  alarmSmtpPass?: string;
  alarmSmtpFrom?: string;
  alarmSmtpTo?: string;
  /** HTTP 辅形（TRIRMC_ALARM_HTTP_URL + TRIRMC_ALARM_HTTP_TOKEN·Bearer） */
  alarmHttpUrl?: string;
  alarmHttpToken?: string;
};

export function readEnv(): TriMCEnv {
  const configDir = process.env.TRIRMC_CONFIG_DIR ?? path.resolve('data');
  // LG-058 N5 方案三：「效」步兑现点——boot 型键经 settingOrEnv 读取
  // （env 钉定优先防误推解除钉定；settings.json 表单值补 env 未钉位；
  // 本文件项重启/进程重启后生效——R-HY 升版流水线 restart 即效步）。
  return {
    port: Number(settingOrEnv('TRIRMC_PORT') ?? 8712),
    tristacissBaseUrl: settingOrEnv('TRISTACISS_BASE_URL') ?? 'http://127.0.0.1:8008',
    openclawGatewayUrl: settingOrEnv('OPENCLOW_GATEWAY_URL') ?? 'ws://127.0.0.1:8822',
    vscodiumGlueBaseUrl: settingOrEnv('VSCODIUM_GLUE_BASE_URL') ?? 'http://127.0.0.1:8730',
    cwd: settingOrEnv('TRIRMC_CWD') ?? process.cwd(),
    memdirPath: settingOrEnv('TRIRMC_MEMDIR') || undefined,
    runAsUser: settingOrEnv('TRIRMC_RUNAS') || undefined,
    bridgeCwd: settingOrEnv('TRIRMC_BRIDGE_CWD') ?? '/srv/fleet',
    cronEnabled: settingOrEnv('TRIRMC_CRON_ENABLED') !== 'false',
    cronLogDir: settingOrEnv('TRIRMC_CRON_LOG_DIR') || undefined,
    defaultModel: settingOrEnv('TRIRMC_DEFAULT_MODEL') || undefined,
    mcDbPath: settingOrEnv('TRIRMC_MC_DB_PATH') ?? path.join(configDir, 'mc-store.sqlite'),
    alarmEnabled: settingOrEnv('TRIRMC_ALARM_ENABLED') !== 'false',
    alarmSmtpHost: settingOrEnv('TRIRMC_ALARM_SMTP_HOST') || undefined,
    alarmSmtpPort: settingOrEnv('TRIRMC_ALARM_SMTP_PORT')
      ? Number(settingOrEnv('TRIRMC_ALARM_SMTP_PORT'))
      : undefined,
    alarmSmtpUser: settingOrEnv('TRIRMC_ALARM_SMTP_USER') || undefined,
    alarmSmtpPass: settingOrEnv('TRIRMC_ALARM_SMTP_PASS') || undefined,
    alarmSmtpFrom: settingOrEnv('TRIRMC_ALARM_SMTP_FROM') || undefined,
    alarmSmtpTo: settingOrEnv('TRIRMC_ALARM_SMTP_TO') || undefined,
    alarmHttpUrl: settingOrEnv('TRIRMC_ALARM_HTTP_URL') || undefined,
    alarmHttpToken: settingOrEnv('TRIRMC_ALARM_HTTP_TOKEN') || undefined,
  };
}

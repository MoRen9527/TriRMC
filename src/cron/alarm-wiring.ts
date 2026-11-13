/**
 * Alarm wiring — env 配置面 → alarm 实例装配（纯映射·零 process.env 直读）。
 *
 * 通道齐备（SMTP 或 HTTP 至少一）才启用；零通道=disabled（启动一行日志，
 * 本地开发零告警噪声）。装配日志只打通道名与布尔态，禁打凭据值面（D-46）。
 * N 值全部走 ALARM_DEFAULTS 终定值（部署面不调参——CPO 防蠕变条款）。
 */

import { createCronAlarm, createHttpNotifier, type AlarmNotifier, type CronAlarmHandle } from './alarm.js';
import { createSmtpNotifier, type SmtpNotifierConfig } from './alarm-smtp.js';

export interface CronAlarmEnvConfig {
  /** TRIRMC_ALARM_ENABLED !== 'false'（master gate） */
  enabled: boolean;
  /** SMTP 主形（host+from+to 齐备才装配） */
  smtp?: SmtpNotifierConfig;
  /** HTTP 辅形（TriMMC 8712 NOTIFY 端点实位=施工窗活体勘后定） */
  httpUrl?: string;
  /** HTTP 鉴权 token（Bearer·值面零回显） */
  httpToken?: string;
  httpTimeoutMs?: number;
}

export function createCronAlarmFromEnv(config: CronAlarmEnvConfig): CronAlarmHandle | null {
  if (!config.enabled) {
    console.log('[cron-alarm] disabled (TRIRMC_ALARM_ENABLED=false)');
    return null;
  }
  const notifiers: AlarmNotifier[] = [];
  if (config.smtp) notifiers.push(createSmtpNotifier(config.smtp));
  if (config.httpUrl) {
    notifiers.push(
      createHttpNotifier({
        url: config.httpUrl,
        token: config.httpToken,
        timeoutMs: config.httpTimeoutMs,
      }),
    );
  }
  if (notifiers.length === 0) {
    console.log('[cron-alarm] disabled (no channels configured: need TRIRMC_ALARM_SMTP_* or TRIRMC_ALARM_HTTP_URL)');
    return null;
  }
  console.log(`[cron-alarm] enabled channels: ${notifiers.map((n) => n.name).join(', ')}`);
  return createCronAlarm({ notifiers });
}

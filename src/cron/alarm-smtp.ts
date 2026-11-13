/**
 * SMTP 主形 notifier — FADE-001 要点③外发通道（cto-phase1-tech-plan.md §三 终裁）。
 *
 * 独立通道不依赖任何可能同时死的 daemon（HTTP 8712 为辅形的理由=TriMMC
 * NOTIFY 链路有 r51 落箱缺口在账）。凭据=部署面 env 注入
 * （trirmc.service EnvironmentFile·值面零回显纪律 D-46 全程适用）。
 * nodemailer 依赖隔离在本文件——alarm.ts 核心判定零邮件库耦合。
 */

import nodemailer from 'nodemailer';
import {
  eventSubject,
  eventText,
  type AlarmNotifier,
  type CronAlarmEvent,
} from './alarm.js';

export interface SmtpNotifierConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  /** 收件人（逗号分隔多人） */
  to: string;
}

export function createSmtpNotifier(config: SmtpNotifierConfig): AlarmNotifier {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
  });
  return {
    name: `smtp:${config.host}:${config.port}`,
    async send(event: CronAlarmEvent): Promise<void> {
      await transport.sendMail({
        from: config.from,
        to: config.to,
        subject: eventSubject(event),
        text: eventText(event),
      });
    },
  };
}

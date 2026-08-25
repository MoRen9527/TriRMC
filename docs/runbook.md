# TriRMC 运维 Runbook（河源生产实例）

## 文档同步元信息

- sourceOfTruth: TriRMC/docs/runbook.md
- syncMode: source-only
- lastSyncedAt: 2026-08-25

## 一、实例档案

| 项 | 值 |
| --- | --- |
| 主机 | 河源 8.155.54.79（Ubuntu 24.04，2C/1.6G，root SSH=河源-key.pem） |
| 服务 | `trirmc.service`（systemd，User=fleet，MemoryMax=800M，Restart=always） |
| 地址 | **127.0.0.1:8712（loopback only）**——公网暴露待 M3 鉴权成熟后另议 |
| 配置 | TRIRMC_CONFIG_DIR=/var/lib/trirmc；jobs.json/logs 在此 |
| 鉴权 | TRIRMC_INTERNAL_TOKEN=/etc/trirmc-internal-token（fleet 副本 ~/.trimetaverse/internal-token） |
| 代码链 | /srv/fleet/{TriRMC,TriCompany,TriModel,TriMetaverse} 四仓 GitHub 直克隆；file: 链接相对布局 |
| 邮件 | /home/fleet/.trimetaverse/notify.json（自 sg-server 中继，N1/N2 通知活） |

## 二、周平面迁移主责（2026-08-25 起切换）

- **本机 weekly-plane-shift job 为唯一迁移执行体**（周日 23:59 Asia/Shanghai，真 --sync）
- sg-server trimc 同名 job 已 **disable**（回滚=re-enable + 本机 disable，一条 PATCH 各自可逆）
- 推送路径：GIT_SSH_COMMAND 用 /home/fleet/.ssh/id_ed25519 → sg-bare（sg-server 裸仓，公钥已入其 fleet authorized_keys）
- 迁移身份：`TriRMC Scheduler <trirmc@tri.company>`
- **周日验收清单**：① job lastRunStatus=ok ② .shift-ade.json status=pass 且 service 链路为 TriRMC ③ 裸仓 dev 出现 TriRMC Scheduler commit ④ 邮件 N 类到达
- **回滚预案**：周日失败 → sg-server `PATCH enabled:true`（token 门照用）+ 本机 `PATCH enabled:false` → 下周回归旧主责；期间 config-sync-apply 与 clock-skew-check 不受影响（仍在 trimc）

## 三、批项 4 心跳指向切换（准备就绪待窗）

TriRLC 心跳/mirror 现指 sg-server :8710。切到本机 :8712 的前置：

1. 8712 需可达——两案：(a) 云防火墙放行+保持 token 门 (b) ssh 隧道。**建议 (a)+IP 白名单**
2. 本地 trilc daemon `.cmd` 改 `set TRIMC_BASE_URL=http://8.155.54.79:8712`（TRIMC_INTERNAL_TOKEN 换成 /etc/trirmc-internal-token 值）→ 权威路径重启
3. 回切=改回原值重启。协议未变，双向可逆
4. **执行窗口：周日迁移完成后的维护时刻**（MIGRATION.md 批项 4 纪律）

## 四、已知差异与注意

- 本机 python=3.12（非 sg-server 的 3.8）：weekly_plane_shift 纯 stdlib 兼容，实测 --help/--dry 通过
- CLI 自管理调用需带 token 头（curl 示例见 §二）；cli.ts 补自动附头归下批代码票
- 内存 1.6G 小机型：纯控制器定位，**勿在此机跑 CC 会话或大型构建**
- /tmp root 属主文件删除受限（sticky）：临时文件统一落 /var/tmp

## 五、更新流程

```
cd /srv/fleet/TriRMC && runuser -u fleet -- git pull --ff-only origin dev
runuser -u fleet -- npx tsc -p tsconfig.json && systemctl restart trirmc
```

依赖仓（TriCompany/TriModel/TriMetaverse）同理 pull；agent-core/TriModel 变更需先各自重编 dist。

# LG-032 案 a 河源部署记录（2026-09-04）

- sourceOfTruth: TriRMC/docs/lg032-deploy-record.md
- syncMode: static（部署快照）
- lastSyncedAt: 2026-09-04
- 执行: FSD 小全（CTO 派工令 2026-09-04，BOD 批令）；部署窗=周五工作日（避周日 23:00 迁移冻结期 ✓）

## 交付物

- 5d40fbc：MC 服务面四件（mc-store sqlite 台账+端点接线+Unit+probe；本地 probe 6/6）
- systemd Unit：trirmc-mc.service（8710，TRIRMC_CRON_ENABLED=false，User=fleet 声明式，Restart=on-failure，TRIRMC_MC_DB_PATH=/var/lib/trirmc-mc/mc-store.sqlite）

## 执行环境四录（LG-022 勘验报告必附执行环境证据纪律；2026-09-04 复验后录）

- hostname：`iZf8ziw57ydktu77fsld9yZ`
- 仓路径：`/srv/fleet/TriRMC`
- 服务进程 PID：`508573`（trirmc-mc.service MainPID）
- 监听：`0.0.0.0:8710`（ss 实证 LISTEN，node pid=508573）

**.env 注记（防后勘误判）**：部署面不存在 `/srv/fleet/TriRMC/.env` 亦无 `/srv/fleet/.env`——**系 Unit `Environment=` 内联注入形态**（systemctl show Environment 实证：TRIRMC_HOST/TRIRMC_PORT/TRIRMC_CRON_ENABLED/TRIRMC_CONFIG_DIR/TRIRMC_MC_DB_PATH/TRIRMC_INTERNAL_TOKEN/HOME 七键内联），非 dotenv 文件注入。「.env 不存在」≠「token 未配置」——后勘验勿以 .env 缺席断言认证缺失。

## 部署操作留痕（ssh 8.155.54.79）

1. 摸底：node v22.23.2（node:sqlite 可用）；现役 trirmc.service@8712（fleet+TRIRMC_INTERNAL_TOKEN 已配）未受扰；8710 空闲；仓 HEAD 6a2a53a=本地同版
2. 分发：GitHub push 网络重置×2 → git bundle（6a2a53a..dev）scp 直传 → `sudo -u fleet git fetch /tmp/trirmc-lg032.bundle dev` → `git merge --ff-only FETCH_HEAD` → HEAD=5d40fbc
3. 构建：`sudo -u fleet npm run build` rc=0（dist/src/comm/mc-store.js 在位）
4. Unit 安装：token 采现役 trirmc.service 同值（64 hex）sed 替换 REPLACE 位 → /etc/systemd/system/trirmc-mc.service → daemon-reload → enable --now → active（PID 508573，0.0.0.0:8710 监听）
5. 自测：mc-probe 全套（healthz/heartbeat×3/replay×3/seq 连续性/401 无 token/tasks/result）**6/6 ALL PASSED rc=0**（本机 127.0.0.1:8710）
6. 台账落盘实证：/var/lib/trirmc-mc/mc-store.sqlite + -shm/-wal（WAL 模式在位，owner fleet）
7. 隔离验证：现役 trirmc.service 8712 active+监听未受扰 ✓；cron 三 job 无接触 ✓

## 部署就绪态与前置项

| 面 | 态 |
| --- | --- |
| 服务面（本机） | ✅ probe 6/6 |
| systemd 常驻 | ✅ enabled+active+Restart=on-failure |
| 公网入站 8710 | ⏳ **云安全组放行**（本机防火墙全开、经公网 IP 回环也不通=云层拦截；切指前置项，与 TriRLC env 值切位同窗） |
| token 对值 | ⏳ 河源 trirmc-mc 用现役 08e0… 同值；TriRLC 侧 TRIMC_INTERNAL_TOKEN 所配值是否同值候切指窗对值（本窗不触 TriRLC env） |
| 现有通道 | ✅ 零接触（TriRLC→sg 8711 注入/sg 中央面/河源 8712 全未动——「先接后关」硬序前置态） |

## 三门集成实测

不在本窗（需 TriRLC 真切指联动，属切指下窗）：心跳门/回传门/replay 门判据见 TriMetaverse/docs/execution/lg032-three-channels.md 案 a-2；本窗=开发+部署+合成自测就绪态。

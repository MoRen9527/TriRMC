#!/bin/bash
# token-run.sh — SDE 批4 #5·token 零 argv 守卫启动器（2026-11-23·COO 施工令/CTO 催办）
# 用法: sudo -u fleet token-run.sh <command> [args...]
# 语义: 从 trirmc daemon /proc environ 进程内读取 TRIRMC_INTERNAL_TOKEN → 仅 export 子进程环境
#       → exec "$@"。token 全程不落 argv / 不落盘 / 不回显（D-46）。
# 背景: flip 点火形执行曾以 `sudo env VAR=…` 形式带 token 进 argv（进程表可见窗口）·自领整改。
set -u
pid=$(systemctl show -p MainPID --value trirmc 2>/dev/null || true)
[ -z "${pid:-}" ] && { echo "[token-run] daemon pid unavailable" >&2; exit 1; }
tok=$(tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep '^TRIRMC_INTERNAL_TOKEN=' | cut -d= -f2-)
[ -z "${tok:-}" ] && { echo "[token-run] TRIRMC_INTERNAL_TOKEN unreadable" >&2; exit 1; }
export TRIRMC_INTERNAL_TOKEN="$tok"
unset tok pid
exec "$@"

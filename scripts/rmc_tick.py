"""rmc_tick — TriRMC 编排工作循环（R 面自治，rmc-autonomy-001 RA-2）

与 M 面 orchestrate_tick 同构（三重门/指纹边沿/锁/台账），唯一差异：
spawn 后端不是 claude CLI，而是本机 TriRLC headless 的 POST /v1/messages
（agent-core 完整 agent 循环，含工具面）——R 面零 CC 依赖。

用法：python3 scripts/rmc_tick.py [--dry-run]
trirmc cron 注册：17,47 * * * * Asia/Shanghai，runAs fleet。
"""

from __future__ import annotations

import argparse
import hashlib
import os
import json
import time
import urllib.request
import urllib.error
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

REPO = Path("/srv/fleet/TriMetaverse")
TC_ROOT = Path(os.environ.get("TC_GOVERNANCE_ROOT", "/srv/fleet/TriCompany"))
PLANE = REPO / "docs/workflow/operating-records"
SHADOW = Path("/srv/fleet/shadow-plane")
LEDGER_PATH = SHADOW / "cost-ledger.json"
REGISTRY_PATH = SHADOW / "session-registry.json"
FINGERPRINT_PATH = SHADOW / "tick-fingerprint.txt"
LOCK_PATH = SHADOW / "orchestrator.lock"
CONFIG_PATH = Path("/home/fleet/.trimetaverse/orchestration.json")

TRILC_MESSAGES = "http://127.0.0.1:8711/v1/messages"
TRILC_ENV = Path("/srv/fleet/TriLC/.env")


def _trilc_internal_token() -> str:
    """p0fix3 fail-closed 门适配（2026-08-28）：TriLC /v1/messages 现要求
    X-Internal-Token——单一真源读 TriLC 自己的 .env（TRILC_INTERNAL_TOKEN）。"""
    try:
        for line in TRILC_ENV.read_text(encoding="utf-8").splitlines():
            if line.startswith("TRILC_INTERNAL_TOKEN="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""

RFACE_SYSTEM_PROMPT = """You are an autonomous software engineering worker operating on the R-face production plane. You execute tasks end-to-end using your available tools.

## Core Behavioral Rules

1. EXECUTE, don't describe. When asked to read a file, use the Read tool. When asked to write a file, use the Write tool. When asked to run a command, use shell_exec. NEVER describe what you would do — actually do it.

2. PERSIST until done. Your work is not complete when you finish reading or exploring. Your work is complete ONLY when:
   - All deliverables specified in the task have been created and committed
   - All action items have been resolved
   - You have pushed your changes to the remote repository
   If you find yourself writing a summary instead of working, STOP summarizing and START executing the next action.

3. One atomic action per commit. After each meaningful step (create file, update status, fix issue), immediately:
   git add <specific files>
   git commit -m "<description>"
   This ensures progress is never lost.

4. When stuck, mark blocked and stop. If you encounter an obstacle you cannot resolve:
   - Update the relevant file with status: blocked and a description of the obstacle
   - Commit this change
   - End your turn with a clear explanation of what is blocked and why

5. Read-only boundaries. Files outside your designated write paths are READ-ONLY. Do not modify them even if you think it would be helpful.

## Tool Usage Priority

| Need | Tool |
| Read file | Read tool |
| Search text | Grep tool or shell grep |
| List directory | LS tool or shell ls |
| Create/edit file | Write/Edit tool |
| Run command | shell_exec |

Always prefer specialized tools over shell commands for file operations.

## Output Discipline

- Final message must include: what was accomplished, files changed, commit hashes
- If blocked: what is blocked, why, and what is needed to unblock
- Never fabricate completion — only report what you actually did and verified"""
TIME_GATE_RE = re.compile(r"(≥?\s*\d+\s*(周|天|小时)|时间门)")


def _load_config() -> dict:
    cfg = {
        "daily_token_cap": 1500000000,
        "model": "stealth/ox-alpha",
        "max_tokens": 16384,
        "session_timeout_s": 2400,
    }
    try:
        cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except Exception:
        pass
    return cfg


def _lock_stale_or_absent(cfg: dict) -> bool:
    try:
        d = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
        if time.time() - d.get("ts", 0) > cfg["session_timeout_s"] * 2:
            LOCK_PATH.unlink()
            return True
        return False
    except Exception:
        return True


def _tokens_today(ledger: dict) -> int:
    today = date.today().isoformat()
    return sum(s.get("total_tokens", 0) for s in ledger.get("sessions", [])
               if s.get("ts", "").startswith(today))


def evaluate_backlog() -> tuple[list[dict], str]:
    actionable = []
    for week_dir in sorted(PLANE.glob("2026-W*")):
        for tree_file in sorted(week_dir.glob("trees/*/tree-op.json")):
            try:
                d = json.loads(tree_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            if d.get("status") != "active":
                continue
            if d.get("domainRouting") != "server-executable":
                continue
            # 面路由门（2026-08-26）：R 面严格制——只取显式 face=r-face 的树
            # （R 面生产位姿：周平面迁移等；缺省 face 视为 m-face 由 TriMMC 承接）
            if d.get("face") != "r-face":
                continue
            pending = [n for n in d.get("nodes", []) if n.get("status") == "pending"]
            if not pending:
                continue
            gated = [n["nodeId"] for n in pending
                     if TIME_GATE_RE.search(n.get("action", "")) or n.get("timeGate")]
            if len(gated) == len(pending):
                continue
            actionable.append({"treeId": d.get("treeId", tree_file.parent.name),
                               "path": str(tree_file),
                               "pendingNodes": [n["nodeId"] for n in pending]})
    fp_src = json.dumps(sorted((a["treeId"], tuple(a["pendingNodes"])) for a in actionable),
                        sort_keys=True)
    return actionable, hashlib.sha256(fp_src.encode()).hexdigest()[:16]


def load_registry() -> dict:
    try:
        return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"ticks": []}


def save_registry(r: dict) -> None:
    SHADOW.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")


def _tree_brief(tree: dict) -> str:
    tree_path = Path(tree["path"])
    try:
        tree_text = tree_path.read_text(encoding="utf-8")
    except Exception as e:
        tree_text = "(read failed: %s)" % e
    parts = [
        "# R-side orchestration task brief",
        "",
        "You are this tick's R-face executor instance.",
        "Working directory: /srv/fleet/TriMetaverse",
        "",
        "Target tree file content:",
        "",
        "```json",
        tree_text,
        "```",
        "",
        "## Task",
        "Execute each pending node action yourself using your tools.",
        "",
        "## CRITICAL - continuous execution",
        "- You are an AUTONOMOUS WORKER. Do NOT stop to summarize progress.",
        "- After EVERY tool result, immediately continue with the next tool call",
        "  until the Done condition is fully met.",
        "- Ending your turn without: all nodes done + commits pushed = FAILURE.",
        "",
        "## Hard rules",
        "- State first: commit progress skeleton immediately, then one commit per atomic step",
        "- Write ONLY inside the tree directory and paths explicitly named by node actions;",
        "  everything else under operating-records is read-only",
        "- git limited to: add explicit paths / commit / push origin dev; no force, no rebase",
        "- On factual obstacles mark blocked and stop; never fabricate completion",
        "- Closeout: when all nodes done set top-level status=done, commit and push",
        "",
        "## Done means",
        "All pending nodes done + top-level done + closeout commit pushed.",
        "End with a summary (per-node result + commit hashes).",
    ]
    return chr(10).join(parts)


# ── LG-016 件 3：R 面治理记忆注入（定案 2026-08-30 board-verdict-20260830-lg016）──
# 真源即模板（CTO-1：禁独立渲染模板常驻本脚本）——从 TriCompany 真源文件程序化提取。
# 注入物 = D-04 时刻 / D-01 落盘 / D-10 git 裸仓 三纪律全文（定案① platforms=agent-core
# 过滤：D-11 审批/D-12 PowerShell 选型不适用不注入；FADE 不注入）。
# 机器锚（CTO-2）：注入头部记录 TriCompany HEAD sha1-12，件 5 周检漂移比对锚格式由此定。
# CPO-2 清点结论：旧 RFACE_SYSTEM_PROMPT 手抄条目（执行规则/工具优先级/收尾/git 合同）
# 全部保留——三纪律注入为纯增量，零取代（清点 2026-08-30）。

_GOVERNANCE_DISCIPLINE_IDS = ("D-04", "D-01", "D-10")


def _extract_discipline(text: str, did: str) -> str:
    pat = r"^### " + re.escape(did) + r" .*?(?=^### |^## |\Z)"
    m = re.search(pat, text, re.M | re.S)
    return m.group(0).strip() if m else "(%s section not found)" % did


def _tc_head_sha12(tc_root) -> str:
    try:
        import subprocess
        out = subprocess.run(["git", "-C", str(tc_root), "rev-parse", "--short=12", "HEAD"],
                             capture_output=True, text=True, timeout=15)
        return out.stdout.strip() if out.returncode == 0 else "unknown"
    except Exception:
        return "unknown"


def build_governance_injection(tc_root=None) -> str:
    """组装治理注入块；真源缺失时降级为警告行（不阻塞 tick）。"""
    root = Path(tc_root) if tc_root else TC_ROOT
    disc_path = root / "docs" / "workflow" / "engineering-disciplines.md"
    sha12 = _tc_head_sha12(root)
    try:
        text = disc_path.read_text(encoding="utf-8")
        sections = "\n\n".join(_extract_discipline(text, d) for d in _GOVERNANCE_DISCIPLINE_IDS)
    except Exception as e:
        sections = "(governance disciplines unavailable: %s)" % e
    header = (
        "\n\n---\n"
        "# Governance memory injection (TriCompany@%s — read-at-assemble;\n"
        "#   source of truth: %s/docs/workflow/engineering-disciplines.md,\n"
        "#   do not copy, re-read when unsure)\n"
        "#\n# Applicable disciplines for this Linux sandbox plane:\n\n" % (sha12, root)
    )
    return header + sections + "\n"


def run_trilc_task(tree: dict, cfg: dict, driven_round: int = 0, prev_summary: str = ""):
    """POST /v1/messages to local TriRLC - agent-core loop runs the brief."""
    body = json.dumps({
        "model": cfg["model"],
        "max_tokens": cfg["max_tokens"],
        # 非交互 print 模式下 ask=deny——自治执行体必须显式提权（loopback+fleet 沙箱内）
        "permissionMode": "bypassPermissions",
        # TC-1 内核续跑：服务端保留全上下文多轮驱动（外循环降级为保险）
        "continue_max_rounds": 4,
        "fallback_model": cfg["model"],
        # TC-s1 FR-2：end_turn 自查拦截
        "continue_on_incomplete": True,
        "continue_prompt": "Check the target tree file. If top-level status is done, reply exactly: DONE. Otherwise continue executing the remaining node actions until done.",
        "system": RFACE_SYSTEM_PROMPT + build_governance_injection(),
        "messages": [{"role": "user",
                      "content": _tree_brief(tree)
                      + (("\n\n[上一轮产出摘要（从此断点继续）]\n" + prev_summary) if prev_summary else "")
                      + "\n\n[DRIVEN ROUND %d] 若树仍未 done：从断点继续执行，禁止重复已完成的步骤。" % driven_round}],
    }).encode()
    req = urllib.request.Request(TRILC_MESSAGES, data=body,
                                 headers={"content-type": "application/json",
                                          "x-internal-token": _trilc_internal_token()},
                                 method="POST")
    try:
        text_parts = []
        usage = {}
        # 注意：多轮工具循环中每轮都会发 message_stop——绝不能在此 break，
        # 否则客户端断连会导致 TriLC 中止整个任务。读到流 EOF 才是真正结束。
        with urllib.request.urlopen(req, timeout=cfg["session_timeout_s"]) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                try:
                    ev = json.loads(line[5:].strip())
                except Exception:
                    continue
                t = ev.get("type", "")
                if t == "content_block_delta":
                    d = ev.get("delta", {})
                    if d.get("type") == "text_delta":
                        text_parts.append(d.get("text", ""))
                elif t == "message_delta":
                    u = ev.get("usage") or {}
                    usage["output_tokens"] = u.get("output_tokens",
                                                    usage.get("output_tokens", 0))
                elif t == "message_start":
                    u = (ev.get("message", {}) or {}).get("usage") or {}
                    if u.get("input_tokens"):
                        usage["input_tokens"] = u["input_tokens"]
        return 0, "".join(text_parts)[-800:], usage
    except urllib.error.HTTPError as e:
        try:
            LOCK_PATH.unlink()
        except Exception:
            pass
        return e.code, "HTTP %d: %s" % (e.code, e.read().decode("utf-8", "replace")[:400]), {}
    except Exception as e:
        return 1, "task error: %s" % e, {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="监督模式：跳过冷却期（锁检查仍生效）")
    ap.add_argument("--print-injection", action="store_true",
                    help="LG-016 件 3 验收：打印治理注入块并退出（CPO-1 存在性断言）")
    args = ap.parse_args()
    if args.print_injection:
        block = build_governance_injection()
        print(block)
        ok = all(d in block for d in _GOVERNANCE_DISCIPLINE_IDS) and "TriCompany@" in block
        print("[governance-injection selfcheck: %s]" % ("PASS" if ok else "FAIL"), file=sys.stderr)
        return 0 if ok else 1
    cfg = _load_config()
    now = datetime.now(timezone.utc)

    actionable, fp = evaluate_backlog()
    prev_fp = FINGERPRINT_PATH.read_text(encoding="utf-8").strip() \
        if FINGERPRINT_PATH.exists() else ""
    try:
        ledger = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        if ledger.get("day") != date.today().isoformat():
            raise ValueError
    except Exception:
        ledger = {"day": date.today().isoformat(), "sessions": [], "total_tokens": 0}

    tok = ledger.get("total_tokens", 0)
    budget_msg = "今日 token %d/%d" % (tok, int(cfg["daily_token_cap"]))
    over = tok >= int(cfg["daily_token_cap"])
    print(json.dumps({"tick": now.isoformat(),
                      "actionable": [a["treeId"] for a in actionable],
                      "fp": fp[:8], "changed": fp != prev_fp,
                      "budget": budget_msg}, ensure_ascii=False))

    if args.dry_run:
        return 0
    if not actionable:
        FINGERPRINT_PATH.write_text(fp, encoding="utf-8")
        return 0
    if fp == prev_fp:
        ticks = load_registry().get("ticks", [])
        last = ticks[-1] if ticks else None
        age = time.time() - last.get("ts_epoch", 0) if last else 1e9
        if not args.force:
            eligible = last and (last.get("rc") == 0 or age > 1800) \
                and _lock_stale_or_absent(cfg)
            if not eligible:
                return 0
        elif not _lock_stale_or_absent(cfg):
            return 0
    if over:
        print("DOWNGRADE:", budget_msg)
        return 1

    tree = actionable[0]
    # 活动锁护栏：上轮 driven loop 仍在跑（或僵尸锁未到陈旧线）则本轮不启动，
    # 防长审计跨 cron 周期重叠双跑（与 M 面 orchestrate_tick 对称）
    try:
        lk = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
        if time.time() - lk.get("ts", 0) < cfg["session_timeout_s"] * 2:
            print("live run in progress, skip")
            return 0
    except Exception:
        pass
    SHADOW.mkdir(parents=True, exist_ok=True)
    LOCK_PATH.write_text(json.dumps({"ts": time.time(), "tree": tree["treeId"]}),
                         encoding="utf-8")
    brief_path = SHADOW / ("brief-%s.json" % now.strftime("%Y%m%dT%H%M%SZ"))
    brief_path.write_text(json.dumps(
        {"treeId": tree["treeId"], "path": tree["path"],
         "pendingNodes": tree["pendingNodes"]}, ensure_ascii=False), encoding="utf-8")

    # 完成度驱动外循环：模型单轮可能早停（推理模型常见），编排层以树文件
    # 顶层 status==done 为唯一完成判据，未完成则携带进度继续驱动（确定性，
    # 不依赖模型自觉）。上限 MAX_DRIVEN_ROUNDS。
    MAX_DRIVEN_ROUNDS = 5
    rc, out, usage = 0, "", {}
    total_tokens = 0
    prev_summary = ""
    for driven_round in range(MAX_DRIVEN_ROUNDS):
        try:
            tree_now = json.loads(Path(tree["path"]).read_text(encoding="utf-8"))
        except Exception:
            tree_now = {}
        if tree_now.get("status") == "done":
            out = "(driven round %d) tree already done" % driven_round
            break
        rc_i, out_i, usage_i = run_trilc_task(tree, cfg, driven_round, prev_summary)
        prev_summary = out_i  # 传递给下一轮
        rc, out, usage = rc_i, out_i, usage_i
        total_tokens += (int(usage.get("input_tokens", 0))
                         + int(usage.get("cache_read_input_tokens", 0))
                         + int(usage.get("cache_creation_input_tokens", 0))
                         + int(usage.get("output_tokens", 0)))
        try:
            tree_now = json.loads(Path(tree["path"]).read_text(encoding="utf-8"))
        except Exception:
            tree_now = {}
        if tree_now.get("status") == "done" or rc_i != 0:
            break
    ledger.setdefault("sessions", []).append(
        {"ts": now.isoformat(), "tree": tree["treeId"],
         "total_tokens": total_tokens, "usage": usage})
    ledger["total_tokens"] = tok + total_tokens
    LEDGER_PATH.write_text(json.dumps(ledger, ensure_ascii=False, indent=1),
                           encoding="utf-8")

    reg = load_registry()
    reg.setdefault("ticks", []).append(
        {"tick": now.isoformat(), "ts_epoch": time.time(),
         "tree": tree["treeId"], "rc": rc, "tokens": total_tokens})
    save_registry(reg)
    FINGERPRINT_PATH.write_text(fp, encoding="utf-8")
    try:
        LOCK_PATH.unlink()
    except Exception:
        pass
    print("tick result rc=%s tokens=%d out=%s" % (rc, total_tokens,
                                                  out[-500:].replace("\n", " | ")))
    return 0


if __name__ == "__main__":
    sys.exit(main())

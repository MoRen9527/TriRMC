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
import json
import time
import urllib.request
import urllib.error
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

REPO = Path("/srv/fleet/TriMetaverse")
PLANE = REPO / "docs/workflow/operating-records"
SHADOW = Path("/srv/fleet/shadow-plane")
LEDGER_PATH = SHADOW / "cost-ledger.json"
REGISTRY_PATH = SHADOW / "session-registry.json"
FINGERPRINT_PATH = SHADOW / "tick-fingerprint.txt"
LOCK_PATH = SHADOW / "orchestrator.lock"
CONFIG_PATH = Path("/home/fleet/.trimetaverse/orchestration.json")

TRILC_MESSAGES = "http://127.0.0.1:8711/v1/messages"
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


def run_trilc_task(tree: dict, cfg: dict):
    """POST /v1/messages to local TriRLC - agent-core loop runs the brief."""
    body = json.dumps({
        "model": cfg["model"],
        "max_tokens": cfg["max_tokens"],
        # 非交互 print 模式下 ask=deny——自治执行体必须显式提权（loopback+fleet 沙箱内）
        "permissionMode": "bypassPermissions",
        "system": "You are a relentless autonomous execution worker on the R-face "
                  "production plane. You NEVER end your turn early: keep issuing tool "
                  "calls until every node is done, committed and pushed. Summaries "
                  "without completed work are failures.",
        "messages": [{"role": "user", "content": _tree_brief(tree)}],
    }).encode()
    req = urllib.request.Request(TRILC_MESSAGES, data=body,
                                 headers={"content-type": "application/json"},
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
    args = ap.parse_args()
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
    SHADOW.mkdir(parents=True, exist_ok=True)
    LOCK_PATH.write_text(json.dumps({"ts": time.time(), "tree": tree["treeId"]}),
                         encoding="utf-8")
    brief_path = SHADOW / ("brief-%s.json" % now.strftime("%Y%m%dT%H%M%SZ"))
    brief_path.write_text(json.dumps(
        {"treeId": tree["treeId"], "path": tree["path"],
         "pendingNodes": tree["pendingNodes"]}, ensure_ascii=False), encoding="utf-8")

    rc, out, usage = run_trilc_task(tree, cfg)
    total_tokens = (int(usage.get("input_tokens", 0))
                    + int(usage.get("cache_read_input_tokens", 0))
                    + int(usage.get("cache_creation_input_tokens", 0))
                    + int(usage.get("output_tokens", 0)))
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

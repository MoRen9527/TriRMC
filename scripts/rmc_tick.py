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


def run_trilc_task(tree: dict, brief_path: Path, cfg: dict):
    """POST /v1/messages 到本机 TriRLC——agent-core 完整循环执行简报。"""
    body = json.dumps({
        "model": cfg["model"],
        "max_tokens": cfg["max_tokens"],
        "messages": [{"role": "user", "content":
                      "读取 " + str(brief_path) + " 并严格执行其全部指令。\n\n"
                      "目标树: " + tree["treeId"] + " @ " + tree["path"]}],
    }).encode()
    req = urllib.request.Request(TRILC_MESSAGES, data=body,
                                 headers={"content-type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=cfg["session_timeout_s"]) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = "".join(b.get("text", "") for b in data.get("content", [])
                       if b.get("type") == "text")
        usage = data.get("usage", {}) or {}
        return 0, text[-800:], usage
    except urllib.error.HTTPError as e:
        return e.code, "HTTP %d: %s" % (e.code, e.read().decode("utf-8", "replace")[:400]), {}
    except Exception as e:
        return 1, "task error: %s" % e, {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
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
        if not (last and (last.get("rc") == 0 or age > 1800)
                and _lock_stale_or_absent(cfg)):
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

    rc, out, usage = run_trilc_task(tree, brief_path, cfg)
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

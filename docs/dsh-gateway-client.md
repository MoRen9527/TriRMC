# dsh Gateway Remote 最小客户端（A2 窗2 #7 / a 案）· 2026-10-20

- sourceOfTruth: 本卷（TriRMC `scripts/dsh-gateway-client.mjs` 随卷说明）
- 定位: 无浏览器向 `dsh web` 发消息的最小客户端——token 交换 → `/api` unary RPC → `/api/remote.mux` WS 流
- 量级: 独立新增件（scripts+docs+test 三文件），零改现役代码/零依赖
- 回滚: 单 commit revert（`git revert <sha>`），不影响任何现役链路

## §一 为什么是它（a 案与 D' 主线的关系）

`dsh web` 的 13 席会话此前只能经 GUI 人位点火（浏览器 + `ssh -L` + token）。a 案原议=逆向自定义 mux 帧做 Gateway Remote 客户端；P0'/D' 线（ACP）解决了「TUI 自建段续聊」，但 **ACP `session/resume` 对 web 存量段不可寻址**（目录名代际差，`session-` 前缀 vs 裸 id，CTO P0' 卷 §三）。本客户端走 **session controller 的 unary 面**，按 `sessionId` 直投，不碰 transcript 寻址——

| 面 | ACP 形 | 本客户端 |
|---|---|---|
| TUI 自建段续聊 | 绿 | 不涉及 |
| web 存量段发消息 | 红（resume 拒） | **机制面成立**（`session/prompt` 按 id 投递） |
| 浏览器/GUI 依赖 | 无 | 无 |
| 协议面 | ACP v1（文档化） | dsh web 自有 `/api` + mux（本文实锚） |

## §二 协议实勘（dsh 0.2.0-rc.2 河源装设位）

1. **认证**：启动 URL `http://host:port/?token=<launch-token>`。`GET /`（带 token）→ 303 + `Set-Cookie`（签名、HttpOnly、host:port 绑定、30 天）。之后每个 `/api` 请求与 WebSocket 升级都带该 Cookie；缺失/过期=401。
2. **unary RPC**：`POST /api/<namespace>/<method>`，body=
   `{"type":"client-request","rpcId":"<uuid>","method":"<namespace>/<method>","payload":{"args":{...}}}`
   响应=`{"type":"server-response","rpcId":"<同>","result":{"ok":true,"value":...}}` 或 `{ok:false,error:{code,message,details}}`。
   源码锚：`dsh-client-connection/lib/index.js`（`clientRequestSchema`/`serverResponseSchema`）、`lib/client.js`（`rpc.call`）。
3. **WS mux**：`GET /api/remote.mux`（Cookie）。客户端帧 `{"type":"open","streamId","endpoint","payload"}`、
   `{"type":"item"/"end"/"cancel","streamId",...}`；服务端帧 `{"type":"item","streamId","value"}` /
   `{"type":"end","streamId"}` / `{"type":"error","streamId","error"}`。源码锚：`dsh-api-gateway/lib/client.js` L106/L390-L420。
4. **本客户端用到的端点**（`dsh-api-session-controller/lib/typert.remote-client.js`）：
   - `session/list` args `{_request:{}}` → `{items:[{sessionId,running,agentAvailable,blank,cwd,updatedAt,...}]}`
   - `session/create` args `{request:{cwd?,sessionId?,agentPreset?}}` → `{sessionId}`
   - `session/prompt` args `{request:{requestId,sessionId,mode:'queue'|'steer',content:[{type:'text',text}]}}` → `{accepted:true}`
   - `$events` 流（WS）→ 首帧 `{type:'ready',clientId,host:{home}}`（连通性自证）

## §三 用法

```sh
# 推荐：token 从启动日志读（不把 token 放 argv，避免 ps 泄漏）
node scripts/dsh-gateway-client.mjs list  --base http://127.0.0.1:8791 --token-file /path/to/dsh-web.log
node scripts/dsh-gateway-client.mjs send  --session <sessionId> --text "开工" --token-file /path/to/dsh-web.log
node scripts/dsh-gateway-client.mjs create --cwd /abs/workspace --token-file /path/to/dsh-web.log
node scripts/dsh-gateway-client.mjs stream --endpoint '$events' --timeout 5000 --token-file /path/to/dsh-web.log

# 端到端自检（会新建一个真实 Session + 一次模型调用；禁对现役 8791 跑）
node scripts/dsh-gateway-client.mjs selftest --base http://127.0.0.1:8799 --token-file /path/to/scratch.log
```

- `--cookie` 可直接复用已有浏览器 Cookie（跳过 token 交换）。
- 环境变量：`DSH_WEB_BASE`、`DSH_WEB_TOKEN`。
- 输出统一 JSON；错误走 stderr，token/cookie/`sk-` 键值经 `redact()` 掩形（D-46）。

## §四 活体证据（隔离实例，零触碰现役）

- 宿主：临时 `DSH_HOME`（复制凭据 store，600，cp 不 cat）+ `dsh web --port 8799 --no-open`，2026-10-20 19:0x-19:2x 北京（DeepSeek 空闲段）。
- 读数：
  - token 交换 HTTP 303，Cookie 落位；
  - `session/list` 200，items 正常；
  - `$events` WS 首帧 `ready`；
  - `session/create` 返回 `session-5ddce6d4-…`；
  - `session/prompt` 返回 `{accepted:true}`；
  - `waitSettled` 观测 running false + updatedAt 前进；
  - transcript 落盘 `assistant/message` 文本=「收到」，`turn/end reason=completed`。
- 隔离面清理：临时实例与 `DSH_HOME` 用后即删；现役 8791 / 13 席库零触碰（只读源码+另起 8799）。

## §五 边界与未验项

- **未对现役 8791/13 席发过任何消息**——按硬护栏「现役 web 会话零触碰」。能否对某席存量段直投=机制面成立、活体候 BOD 批准后单席验证（建议先 `list` 只读，再选一席发一条可撤回的探针句）。
- 本客户端只做 unary（list/create/prompt）+ 通用 WS 流；**不做** transcript 回放、`session/follow` 增量渲染、附件上传（P2 候选）。
- 并发：web 端同一 Session 有在途 turn 时，`mode:'queue'` 入队、`steer` 插话；本客户端不替代 web UI 的交互态。
- 安全：token/cookie 等同 operator 权限，`--token-file` 文件建议 600；任何输出不得回显（代码已掩形，调用方仍须守 D-46）。

—— 落款见 TriRMC commit；卷面时刻 2026-10-20 19:2x +0800（date 现查）

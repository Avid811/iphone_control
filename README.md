# Claude 掌機 — iPhone 远程控制 Windows Claude Code

用 iPhone 浏览器远程操控 Windows 电脑上的 [Claude Code](https://claude.ai/code)，支持实时文字流、权限远程确认、外部会话发现与接管。

```
┌──────────┐     Tailscale/WiFi      ┌─────────────────────────────┐
│  iPhone  │ ◄──────────────────────► │  Windows PC (Bridge Server) │
│  Safari  │     WebSocket + HTTP     │  ├─ PTY → Claude Code       │
│  (掌機UI) │                          │  ├─ 外部会话扫描             │
└──────────┘                          │  ├─ 按键注入 (Win32 API)    │
                                      │  └─ Bark 推送通知            │
                                      └─────────────────────────────┘
```

## 功能

| 功能 | 说明 |
|------|------|
| **远程对话** | iPhone Safari 打开网页，实时与电脑上的 Claude Code 对话 |
| **思考/回答分离** | 思考过程折叠显示，回答内容高亮展示（模仿 Claude Code 终端的 `●` 标记机制） |
| **权限远程确认** | Claude 需要权限时，iPhone 弹出醒目的 [允许/拒绝] 按钮，支持震动+标题闪烁 |
| **Bark 推送通知** | 权限请求时自动向 iPhone 推送通知（需配置 Bark App） |
| **外部会话发现** | 自动扫描电脑上所有独立运行的 Claude Code 进程，列出活跃会话 |
| **远程按键注入** | 向外部 Claude 进程注入按键（y/n/自定义文本），远程回应权限请求 |
| **会话接管** | 将外部 Claude 会话接管到手机上，读取对话历史，新建实时 PTY 流 |
| **终端截图** | 抓取外部进程的控制台窗口截图（PNG base64），查看当前状态 |
| **CRT 复古 UI** | 像素字体、扫描线效果、琥珀色主题，专为 iPhone 触屏优化 |

## 系统架构

```
bridge/
├── server.js              # 核心服务器 (Express + WebSocket + PTY)
├── session-monitor.js     # 外部会话扫描器
├── inject-keystroke.ps1   # PowerShell 按键注入 (Win32 API)
├── inject-keystroke.c     # C 版本按键注入 (可选编译, 性能更好)
├── build-inject.bat       # C 编译器辅助脚本
├── read-console.ps1       # 控制台窗口截图
├── test-e2e.js            # 端到端测试
├── start.bat              # 一键启动脚本
├── stop.bat               # 停止服务器脚本
├── package.json
└── public/
    └── index.html         # iPhone 前端 UI (单页应用)
```

### 核心流程

1. **server.js** 用 `node-pty` 启动 `claude --bare`，获得 PTY 伪终端
2. PTY 输出经 ANSI 剥离 → 行分割 → `\r` 覆写处理 → 思考/回答分类 → WebSocket 推送到 iPhone
3. 权限检测用正则匹配 PTY 输出中的权限提示词（中英文）
4. **session-monitor.js** 每 3 秒扫描 `~/.claude/sessions/*.json`，发现不受 bridge 管理的 Claude 进程
5. **inject-keystroke.ps1** 通过 `AttachConsole` + `WriteConsoleInput` 或 `keybd_event` + `SendInput` 向目标进程注入按键

## 前置条件

| 依赖 | 说明 | 如何获取 |
|------|------|---------|
| **Node.js** | ≥ 18.x | `winget install OpenJS.NodeJS.LTS` |
| **Claude Code** | 已安装并可用 `claude` 命令 | `npm install -g @anthropic-ai/claude-code` |
| **Tailscale** (推荐) | 用于 iPhone ↔ PC 安全组网 | [tailscale.com/download](https://tailscale.com/download) |
| **Windows 10/11** | 当前仅支持 Windows（PTY + Win32 API） | — |
| **Bark App** (可选) | iOS 推送通知 | App Store 搜索 "Bark" |

> **无需编译 C 代码**。`inject-keystroke.ps1` 在所有 Windows 10/11 系统上开箱即用。C 版本 (`inject-keystroke.c`) 仅作为可选优化。

## 一键安装 & 部署

```bash
# 1. 克隆仓库
git clone https://github.com/Aono0704/iphone_control.git
cd iphone_control/bridge

# 2. 安装依赖
npm install

# 3. 配置密钥（详见 SETUP.md）
#    - Bark Key（可选，用于推送通知）
#    - Tailscale IP

# 4. 一键启动
#    Windows 资源管理器中双击 start.bat
#    或命令行：
node server.js
```

启动后访问：
- **局域网**: `http://你的电脑IP:3000`
- **Tailscale**: `http://你的Tailscale IP:3000`（运行 `tailscale ip -4` 查看）

> 📖 **详细配置步骤请阅读 [SETUP.md](./SETUP.md)**

## 使用方式

### 基础对话

1. iPhone Safari 打开 bridge 地址
2. 看到 "CLAUDE 掌機" 复古界面
3. 底部输入框输入指令，点 ▶ 发送
4. 思考过程折叠显示（点 "思考过程(N行)" 可展开）
5. 回答内容直接显示

### 远程确认权限

当 Claude 需要权限时：
1. iPhone 界面弹出醒目的 **"权限请求"** 对话框
2. 手机震动 + 标题栏闪烁提醒
3. 如配置了 Bark，同时收到 iOS 推送通知
4. 点击 **[允许]** 或 **[拒绝]** 远程回应

### 管理外部会话

"电脑活跃会话" 面板显示电脑上所有独立运行的 Claude 进程：
- **⚠ 等待权限** — 显示红色/琥珀色，可直接点 **[允许]** 注入 `y` 或 **[拒绝]** 注入 `n`
- **接管** — 将该会话纳入手机控制，读取对话历史，新建实时流
- **注入模式** — 点击会话进入注入模式，后续输入框内容直接发送到该进程

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | iPhone Web 控制台 |
| `/health` | GET | 健康检查 `{"status":"ok","uptime":...,"sessions":...}` |
| `/api/external-sessions` | GET | 获取外部 Claude 会话列表 (JSON) |
| `/ws` | WebSocket | 实时双向通信 |

### WebSocket 消息协议

**客户端 → 服务器：**

| type | 字段 | 说明 |
|------|------|------|
| `message` | `text` | 发送对话消息 |
| `permission_allow` | — | 允许权限 |
| `permission_deny` | — | 拒绝权限 |
| `cancel` | — | 取消当前操作 (Ctrl+C) |
| `inject_permission` | `pid`, `text` | 向外部进程注入按键 |
| `capture_terminal` | `pid` | 抓取终端截图 |
| `take_over_session` | `externalSessionId` | 接管外部会话 |

**服务器 → 客户端：**

| type | 字段 | 说明 |
|------|------|------|
| `status` | `state`, `sessionId` | 会话状态更新 |
| `thinking_block` | `text` | 思考内容块 |
| `answer_block` | `text` | 回答内容块 |
| `output_status` | `text` | 状态栏文字（如 "思考中...(5s)"） |
| `need_permission` | `text` | 权限请求（触发弹窗） |
| `ready_for_input` | — | 就绪，可接收输入 |
| `session_ended` | `code` | 会话结束 |
| `external_sessions_update` | `sessions[]` | 外部会话列表更新 |
| `inject_result` | `pid`, `text`, `success`, `message` | 注入结果 |
| `terminal_capture` | `pid`, `text` | 终端截图 (PNG base64) |
| `take_over_result` | `sessionId`, `success`, `history` | 接管结果 |

## 配置文件

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP/WS 服务端口 |
| `BARK_KEY` | (空) | Bark 推送通知 Key，留空则跳过推送 |
| `TAILSCALE_IP` | `100.xxx.xxx.xxx` | Tailscale 节点 IP，仅用于启动日志显示 |

### Windows 防火墙

首次启动时需要允许 Node.js 通过防火墙，否则 iPhone 无法访问。或手动添加规则：

```powershell
netsh advfirewall firewall add rule name="Claude Bridge" dir=in action=allow protocol=TCP localport=3000
```

## 运行测试

```bash
cd bridge
node test-e2e.js
```

端到端测试覆盖：
- 健康检查端点
- 外部会话 API（去重、字段完整性、排序）
- WebSocket 连接与消息
- 按键注入（含假 PID 错误处理）
- 会话监控逻辑（去重、过滤、stuck 检测）
- PowerShell 脚本语法验证

## 项目状态

在以下环境验证通过：
- Windows 10 Pro 22H2
- Node.js v20 LTS
- Claude Code (最新版)
- Tailscale v1.80+
- iPhone Safari iOS 18

## 安全注意事项

1. **Bridge 服务无身份验证** — 依赖 Tailscale 组网或局域网隔离。不要在公网直接暴露端口。
2. **按键注入需要管理员权限** — `inject-keystroke.ps1` 调用 Win32 API，需要高权限运行
3. **不要提交敏感配置** — `BARK_KEY`、Tailscale IP 等通过环境变量配置，不要写入代码
4. **`.claude/settings.local.json`** 已在 `.gitignore` 中排除

## License

MIT

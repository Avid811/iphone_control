# 📱 Claude 掌機 — iPhone 远程控制 Windows Claude Code

> **躺在沙发上，用 iPhone 操控电脑上的 Claude Code 写代码。**

用 iPhone 浏览器远程操控 Windows 电脑上的 [Claude Code](https://claude.ai/code)，支持实时文字流、权限远程确认、外部会话发现与接管。复古 CRT 终端风格，专为触屏优化。

```
┌──────────┐     Tailscale / WiFi      ┌─────────────────────────────┐
│  iPhone  │ ◄───────────────────────► │  Windows PC (Bridge Server) │
│  Safari  │     WebSocket + HTTP       │  ├─ PTY → Claude Code       │
│  (掌機UI) │                            │  ├─ 外部会话扫描             │
└──────────┘                            │  ├─ 按键注入 (Win32 API)    │
                                        │  └─ Bark 推送通知            │
                                        └─────────────────────────────┘
```

---

## ⚡ 5 分钟快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/Avid811/iphone_remote_control_cc.git
cd iphone_remote_control_cc/bridge

# 2. 安装依赖（仅需一次）
npm install

# 3. 启动服务
#    Windows 资源管理器中双击 start.bat
#    或命令行：
node server.js
```

**启动后，iPhone 打开：**
- 🏠 **局域网**: `http://你的电脑IP:3000`
- 🌐 **Tailscale**: `http://你的Tailscale IP:3000`（运行 `tailscale ip -4` 查看）

> 看到 "CLAUDE 掌機" 复古界面就成功了！底部输入框输入指令开始对话。

---

## 📋 前置条件

| 依赖 | 版本要求 | 安装命令 |
|------|---------|---------|
| **Windows** | 10 或 11 | — |
| **Node.js** | ≥ 18.x | `winget install OpenJS.NodeJS.LTS` |
| **Claude Code** | 最新版 | `npm install -g @anthropic-ai/claude-code` |
| **Tailscale** *(推荐)* | 任意 | [tailscale.com/download](https://tailscale.com/download) |
| **Bark App** *(可选)* | iOS | App Store 搜索 "Bark" |

> ✅ **无需编译任何代码**。PowerShell 脚本在所有 Windows 10/11 上开箱即用。

---

## ✨ 功能一览

| 功能 | 说明 | 使用场景 |
|------|------|---------|
| 🗣️ **远程对话** | iPhone 输入指令，实时查看 Claude 思考与回答 | 躺沙发、出门在外时操控家中电脑 |
| 🧠 **思考/回答分离** | 思考过程折叠显示，回答高亮展示 | 想看推理过程就展开，不想看就折叠 |
| 🔐 **权限远程确认** | Claude 需要权限时，iPhone 弹出 [允许/拒绝] 按钮 | 安装依赖、执行命令等需要确认的操作 |
| 🔔 **Bark 推送通知** | 权限请求时自动推送 iOS 通知 | 手机不在浏览器页面也能收到提醒 |
| 📡 **外部会话发现** | 自动扫描电脑上所有独立运行的 Claude 进程 | 发现并管理电脑上其他终端里的 Claude |
| ⌨️ **远程按键注入** | 向外部 Claude 进程注入按键 (y/n/自定义) | 远程回应其他 Claude 窗口的权限请求 |
| 🔄 **会话接管** | 将外部 Claude 会话切换到手机上继续 | 从电脑前走开，手机无缝接续对话 |
| 📸 **终端截图** | 抓取外部进程的控制台窗口截图 | 查看其他 Claude 窗口当前状态 |
| 🕹️ **CRT 复古 UI** | 像素字体、扫描线、琥珀色主题 | 情怀拉满，专为 iPhone 触屏优化 |

---

## 🏗️ 系统架构

```
bridge/
├── server.js              # 核心服务 (Express + WebSocket + PTY)
├── session-monitor.js     # 外部会话扫描器
├── inject-keystroke.ps1   # PowerShell 按键注入 (Win32 API)
├── inject-keystroke.c     # C 版本按键注入 (可选，性能更好)
├── build-inject.bat       # C 编译器辅助脚本
├── read-console.ps1       # 控制台窗口截图
├── test-e2e.js            # 端到端测试
├── start.bat              # 一键启动
├── stop.bat               # 停止服务
├── package.json
└── public/
    └── index.html         # iPhone 前端 UI (单页应用)
```

### 数据流

```
iPhone 输入 "帮我写一个排序算法"
  → WebSocket → server.js
    → PTY 写入 claude --bare 进程
      → Claude 开始思考（PTY 输出 status line）
        → server.js 分类为 "思考状态" → WebSocket → iPhone 显示 "思考中...(3s)"
      → Claude 输出思考内容
        → server.js 累积到 thinkingAccum → 200ms flush → iPhone 折叠显示
      → Claude 输出 ● 标记 → 切换到回答模式
        → server.js 累积到 answerAccum → iPhone 高亮显示
      → Claude 完成，1.5s 无输出 → idle → iPhone 就绪
```

### 权限检测流程

```
PTY 输出包含 "Do you want to allow..." / "是否允许..."
  → detectPermission() 正则匹配
    → WebSocket 推送 need_permission → iPhone 弹窗 + 震动
    → Bark API 推送 iOS 通知（如已配置）
    → 用户点击 [允许] → 向 PTY 写入 "y\r\n"
    → Claude 继续执行
```

---

## 🔧 详细配置

> 📖 **首次使用请完整阅读 [SETUP.md](./SETUP.md)** — 包含 Bark 推送、Tailscale 组网、防火墙等每一步的截图级说明。

### 快速配置清单

```bash
# 1. 配置 Bark 推送通知（可选）
[System.Environment]::SetEnvironmentVariable('BARK_KEY', '你的BarkKey', 'User')

# 2. 配置防火墙（必须，否则 iPhone 无法访问）
netsh advfirewall firewall add rule name="Claude Bridge" dir=in action=allow protocol=TCP localport=3000

# 3. 查看 Tailscale IP
tailscale ip -4
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP/WebSocket 服务端口 |
| `BARK_KEY` | *(空)* | Bark 推送 Key，留空则跳过推送 |
| `TAILSCALE_IP` | `100.xxx.xxx.xxx` | 仅用于启动日志显示 |

---

## 📖 使用指南

### 基础对话

1. iPhone Safari 打开 bridge 地址
2. 看到 **"CLAUDE 掌機"** 欢迎界面
3. 底部输入框输入指令，点 **▶** 发送
4. 思考过程折叠显示（点击 **"思考过程(N行)"** 展开）
5. 回答内容直接显示，黑色背景 + 琥珀色高亮

### 远程确认权限

当 Claude 需要权限时：

1. iPhone 弹出醒目的 **"权限请求"** 对话框（琥珀色边框 + 动画）
2. 手机震动提醒（3 次脉冲）
3. 标题栏闪烁 **"⚠ CLAUDE 掌機"**
4. 如配置了 Bark，同时收到 iOS 推送通知
5. 点击 **[允许]** 或 **[拒绝]** 远程回应

### 管理外部会话

"电脑活跃会话" 面板显示电脑上所有独立运行的 Claude 进程：

| 状态 | 显示 | 操作 |
|------|------|------|
| ⚠ 等待权限 | 琥珀色闪烁边框 | **[允许]** / **[拒绝]** 直接注入 y/n |
| 🔄 忙碌中 | 红色边框 | **[接管]** 切换到手机控制 |
| ✓ 空闲 | 默认样式 | **[接管]** 读取历史，建立实时流 |

**注入模式**：点击某个会话后进入注入模式，输入框变红，后续输入直接发送到该进程。

---

## 🔌 API 参考

### HTTP 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | iPhone Web 控制台 |
| `/health` | GET | 健康检查 `{"status":"ok","uptime":...,"sessions":...}` |
| `/api/external-sessions` | GET | 外部 Claude 会话列表 (JSON) |
| `/ws` | WebSocket | 实时双向通信 |

### WebSocket 协议

**客户端 → 服务器：**

| type | 字段 | 说明 |
|------|------|------|
| `message` | `text` | 发送对话消息 |
| `permission_allow` | — | 允许权限 |
| `permission_deny` | — | 拒绝权限 |
| `cancel` | — | 取消当前操作 (Ctrl+C) |
| `inject_permission` | `pid`, `text` | 向外部进程注入按键 |
| `capture_terminal` | `pid` | 抓取终端截图 (PNG base64) |
| `take_over_session` | `externalSessionId` | 接管外部会话 |

**服务器 → 客户端：**

| type | 字段 | 说明 |
|------|------|------|
| `status` | `state`, `sessionId` | 会话状态 (`idle` / `processing` / `awaiting_permission` / `done`) |
| `thinking_block` | `text` | 思考内容块 |
| `answer_block` | `text` | 回答内容块 |
| `output_status` | `text` | 状态栏文字（如 "思考中...(5s)"） |
| `need_permission` | `text` | 权限请求（触发弹窗 + 震动） |
| `ready_for_input` | — | 就绪，可接收输入 |
| `session_ended` | `code` | 会话结束 |
| `external_sessions_update` | `sessions[]` | 外部会话列表更新 |
| `inject_result` | `pid`, `text`, `success`, `message` | 按键注入结果 |
| `terminal_capture` | `pid`, `text` | 终端截图 (PNG base64) |
| `take_over_result` | `sessionId`, `success`, `history` | 接管结果（含对话历史） |

---

## 🧪 运行测试

```bash
cd bridge
node test-e2e.js
```

覆盖范围：
- ✅ 健康检查端点
- ✅ 外部会话 API（去重、字段完整性、排序）
- ✅ WebSocket 连接与消息推送
- ✅ 按键注入（含假 PID 错误处理）
- ✅ 会话监控逻辑（去重、过滤、stuck 检测）
- ✅ PowerShell 脚本语法验证

---

## ❓ 常见问题

<details>
<summary><b>Q: iPhone 无法连接？</b></summary>

1. 确认电脑和 iPhone 在同一网络（Tailscale 或局域网）
2. 运行 `curl http://localhost:3000/health` 确认服务已启动
3. 检查防火墙：`netsh advfirewall firewall show rule name="Claude Bridge"`
4. 如果电脑有多个网卡，尝试所有 IP 地址
</details>

<details>
<summary><b>Q: 按键注入失败？</b></summary>

1. **以管理员身份运行**：右键 `start.bat` → "以管理员身份运行"
2. 确保目标 Claude 进程确实在运行
3. 如果目标进程在 Windows Terminal 中，PowerShell 的 keybd_event 回退方案会自动处理
</details>

<details>
<summary><b>Q: 看不到外部会话？</b></summary>

1. 确认电脑上确实有独立运行的 `claude` 命令（不是在 bridge 里的）
2. 会话必须运行超过 3 秒才会被扫描到
3. 检查 `%USERPROFILE%\.claude\sessions\` 目录下是否有 `.json` 文件
</details>

<details>
<summary><b>Q: Bark 推送收不到？</b></summary>

1. 先手动测试：`curl "https://api.day.app/你的Key/测试/内容?sound=alarm"`
2. 确认环境变量已设置：`echo %BARK_KEY%`
3. 重启 bridge 服务使环境变量生效
</details>

<details>
<summary><b>Q: 端口 3000 被占用？</b></summary>

`start.bat` 会自动释放端口。或手动：
```bash
netstat -ano | findstr ":3000.*LISTENING"
taskkill /F /PID <PID>
```
也可以设置环境变量 `PORT=3001` 使用其他端口。
</details>

---

## 🔒 安全注意事项

1. **Bridge 无身份验证** — 依赖 Tailscale 组网或局域网隔离，**不要暴露到公网**
2. **按键注入需要管理员权限** — `inject-keystroke.ps1` 调用 Win32 API
3. **敏感配置走环境变量** — `BARK_KEY`、Token 等通过环境变量配置，不写入代码
4. **`.gitignore` 已排除** — `.claude/settings.local.json`、`sessions/`、编译产物

---

## 📋 验证环境

| 组件 | 版本 |
|------|------|
| Windows | 10 Pro 22H2 |
| Node.js | v20 LTS |
| Claude Code | 最新版 |
| Tailscale | v1.80+ |
| iPhone Safari | iOS 18 |

---

## 📄 License

MIT

---

<p align="center">
  <b>🕹️ 掌中 Claude，随时随地写代码。</b>
</p>

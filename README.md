# 📱 Claude 掌機 — iPhone 远程控制 Windows Claude Code

> **人躺在沙发上、出门在外、上厕所……随时随地用 iPhone 操控家里电脑上的 Claude Code。**

电脑上的 Claude 卡在权限确认？Bark 推送立刻通知你，拿起手机点一下就能救回来。想接管之前的对话继续聊？点一下"接管"，聊天记录全部加载到手机上。

```
┌──────────┐     Tailscale / WiFi      ┌─────────────────────────────────┐
│  iPhone  │ ◄───────────────────────► │  Windows PC (Bridge Server)     │
│  Safari  │     WebSocket + HTTP       │  ├─ PTY → Claude Code (实时流)  │
│  (掌機UI) │                            │  ├─ 外部会话扫描 (每3秒)        │
└──────────┘                            │  ├─ Win32 按键注入 (y/n/文本)  │
                                        │  └─ Bark 推送 → iPhone 通知     │
                                        └─────────────────────────────────┘
```

---

## 目录

1. [三个核心使用场景](#-三个核心使用场景) ← **先看这里，理解这个项目能做什么**
2. [功能一览](#-功能一览)
3. [电脑小白安装教程](#-电脑小白安装教程)
4. [配置 Bark 推送通知](#-配置-bark-推送通知)
5. [配置 Tailscale 组网](#-配置-tailscale-组网推荐)
6. [iPhone 连接与使用](#-iphone-连接与使用)
7. [系统架构（进阶阅读）](#-系统架构进阶阅读)
8. [API 参考](#-api-参考)
9. [常见问题](#-常见问题)

---

## 📖 三个核心使用场景

### 场景一：🛋️ 沙发编程 — 在家随处操控电脑

> 电脑在书房，人在客厅沙发，想继续和 Claude 聊代码。

```
  你躺在沙发上               家里的电脑（书房）
  ┌─────────┐              ┌────────────────┐
  │ iPhone  │   WiFi/      │ Claude Code    │
  │ 浏览器   │◄─Tailscale─►│ 正在思考中...   │
  │ 掌機 UI │              │ PTY 实时输出    │
  └─────────┘              └────────────────┘
```

**操作步骤：**

1. iPhone Safari 打开 bridge 地址（启动时电脑屏幕上会显示）
2. 看到 **"CLAUDE 掌機"** 界面
3. 底部输入框输入 _"帮我重构 user_service.py，拆分出独立的验证模块"_
4. 点 **▶** 发送
5. Claude 开始思考 → 界面显示 _"思考中...(5s)"_ → 思考过程折叠收起
6. Claude 输出回答 → 白色高亮文字直接显示
7. 继续对话、追问、让它改代码……全程躺在沙发上

> 💡 **看起来什么样？** 黑色背景 + 琥珀色标题 + 绿色扫描线效果，像科幻片里的复古终端。字体是像素风，专为 iPhone 小屏优化过。

---

### 场景二：🔔 权限救援 — Bark 推送救回卡住的 Claude

> **这是 Bark 的核心作用，不是可选的锦上添花。**
>
> 你在电脑上给 Claude 布置了一个任务（比如_"安装这个依赖"_），然后去吃饭了。Claude 跑到一半弹出权限确认 _"Do you want to install this package? [y/n]"_ — 它卡住了，傻等在那里。
>
> 这时候 Bark 推送一条通知到你的 iPhone：**"Claude 需要确认"**。

```
  电脑上的 Claude 卡住了          你的 iPhone 收到 Bark 推送
  ┌─────────────────────┐        ┌──────────────────┐
  │ Do you want to      │        │ 🔔 Claude 需要确认  │
  │ install this        │  Bark  │                  │
  │ package? [y/n]      │────────│ 安装依赖包，      │
  │                     │  推送!  │ 是否继续？        │
  │ (Claude 傻等中...)   │        │                  │
  └─────────────────────┘        │ [点我打开掌機]    │
                                 └──────────────────┘
```

**操作步骤：**

1. iPhone 收到 Bark 推送：_"Claude 需要确认 — 安装依赖包，是否继续？"_
2. 点击推送，跳转到 bridge 页面（或手动打开 Safari 进入掌機）
3. 屏幕上弹出醒目的 **"权限请求"** 对话框（琥珀色边框 + 动画）
4. 手机会震动，标题栏闪烁 ⚠
5. 看到对话框里显示 Claude 的具体问询内容
6. 点击 **[允许]** — 电脑上的 Claude 收到 `y`，继续干活
7. 或者点击 **[拒绝]** — 电脑上的 Claude 收到 `n`，跳过这一步

> **Bark 的价值**：没有 Bark 的话，你根本不知道 Claude 卡住了，可能吃完饭回来发现它等了你半小时。有了 Bark，你随时知道它需要你，点一下手机就搞定。

**电脑上存在多个 Claude 窗口时的额外能力：**

如果电脑上还有**独立运行的 Claude 窗口**（不是在掌機里启动的），它们也会显示在掌機界面的 **"电脑活跃会话"** 面板中：

```
  ┌─────────────────────────────────┐
  │ 电脑活跃会话                      │
  │                                 │
  │ ⚠ iphone_control  等待权限      │
  │   PID 24792 | 繁忙 | 3分12秒    │
  │   ⚠ 5秒未响应                   │
  │   [允许] [拒绝] [接管]           │
  │                                 │
  │ ✓ another_project  空闲          │
  │   PID 18234 | 空闲 | 12分钟     │
  │   [接管]                        │
  └─────────────────────────────────┘
```

- 琥珀色闪烁的 = 正在等待权限，急需你处理
- 点 **[允许]** → 直接向那个窗口注入 `y` 按键
- 点 **[接管]** → 跳到场景三

---

### 场景三：🔄 外出接管 — 出门在外无缝接续对话

> 你下午在电脑上和 Claude 讨论了半小时的项目架构，现在要出门了。在路上想继续刚才的对话，不想从头开始。

```
  出门前（电脑上）                    出门后（iPhone 上）
  ┌────────────────────┐            ┌─────────────────────┐
  │ ❯ 帮我设计数据库    │            │ CLAUDE 掌機           │
  │ ● 好的，建议用      │            │                     │
  │   PostgreSQL...    │   接管!    │ ▸ 对话历史 (接管加载)  │
  │ ❯ 那索引怎么建？    │───────────│   ❯ 帮我设计数据库    │
  │ ● 建议在...        │            │   ● 好的，建议用...   │
  │ ❯ 还有...          │            │   ❯ 那索引怎么建？    │
  │ (对话进行中)        │            │   ● 建议在...        │
  └────────────────────┘            │ ──────────────────  │
                                    │ (实时对话继续...)    │
                                    │ ❯ 出门了，继续聊     │
                                    └─────────────────────┘
```

**操作步骤：**

1. 在路上打开 iPhone Safari → 进入掌機
2. 向下滑，看到 **"电脑活跃会话"** 面板
3. 找到之前在电脑上对话的那个项目（比如 `my_project`，状态显示 "繁忙" 或 "空闲"）
4. 点击 **[接管]**
5. 系统弹窗确认：_"确认接管会话 abc12345... 吗？接管后可在手机上继续对话。"_
6. 点击确认
7. **完整的对话历史加载到手机上** — 之前的每一条提问和回答都能看到
8. 底部出现新的输入框，现在可以**直接继续对话**，就像从没离开过一样
9. Claude 在新的 PTY 里继续运行，实时输出流到手机上

> 🔑 **关键能力**：接管不是仅仅注入几个按键——它会**读取完整对话历史**（从 `~/.claude/projects/<项目名>/<sessionId>.jsonl`），在手机上展示你们之前聊了什么，然后新建一个 Claude 实例让你继续。之前的上下文完全保留。

---

## ✨ 功能一览

| 功能 | 什么用 | 触发方式 |
|------|--------|---------|
| 🗣️ **远程对话** | iPhone 输入指令，实时看 Claude 思考+回答 | 打开网页 → 输入 → 发送 |
| 🧠 **思考折叠** | 思考过程默认收起，想看再点开 | 自动折叠，点击"思考过程(N行)"展开 |
| 🔐 **权限弹窗** | Claude 要权限时手机弹大按钮 | Claude 触发 → 自动弹窗 |
| 🔔 **Bark 推送** | Claude 卡住时推送 iPhone 通知 | 权限被检测到 → 自动推送 |
| 📡 **会话发现** | 找到电脑上所有在跑的 Claude 窗口 | 每 3 秒自动扫描 |
| ⌨️ **按键注入** | 远程向 Claude 窗口发送 y/n/文本 | 点 [允许]/[拒绝] 按钮 |
| 🔄 **会话接管** | 把电脑上的 Claude 对话切到手机，带聊天记录 | 点 [接管] → 确认 |
| 📸 **终端截图** | 看一眼 Claude 窗口现在显示啥 | 接管后或注入后自动抓取 |

---

## 💻 电脑小白安装教程

> 不要怕，跟着一步步来。只要有 Windows 10 或 11 的电脑，总共大概 15 分钟。

### 🖥️ 新手必读：认识两个"黑窗口"

本教程会反复让你在"黑窗口"里输入命令。Windows 有两种黑窗口，**不用纠结区别**：教程里让你复制命令到哪个，你就用哪个，效果一样。

| 黑窗口名字 | 怎么打开 | 什么时候用 |
|-----------|---------|-----------|
| **cmd（命令提示符）** | 按 `Win+R` → 输入 `cmd` → 回车 | 日常命令都用它 |
| **PowerShell** | 点"开始" → 搜索 "PowerShell" → 回车 | 需要"管理员权限"时用它（教程会明确说） |

> 💡 **怎么"以管理员身份运行"？** 点"开始" → 搜索"PowerShell" → **右键点它** → 选"以管理员身份运行"。看到弹出"是否允许此应用…"的提示 → 点"是"。管理员窗口的标题栏会显示"管理员"三个字。

---

### 前置条件检查

| 你需要有的 | 怎么检查 |
|-----------|---------|
| Windows 10 或 11 电脑 | 右键"此电脑"→ 属性 → 看 Windows 版本 |
| 能上网 | 打开浏览器随便搜个东西 |
| iPhone（iOS 不限版本） | 你正在用就行 |
| Anthropic 账号（用 Claude Code 必须） | 去 [console.anthropic.com](https://console.anthropic.com) 注册 |

---

### 第一步：安装 Node.js

**什么是 Node.js？** 一个让电脑能运行 JavaScript 的环境，它就像电脑里的"翻译官"——bridge 服务器用 JavaScript 写的，得靠 Node.js 来执行。

```
方式一（推荐，Windows 11 自带）：
  点"开始" → 搜索 "PowerShell" → 右键 → "以管理员身份运行"
  粘贴以下命令，按回车：
    winget install OpenJS.NodeJS.LTS
  等待安装完成（约 2 分钟）

方式二（所有 Windows）：
  1. 打开浏览器，访问 https://nodejs.org
  2. 点左边绿色的 "LTS" 按钮下载
  3. 双击下载的文件 → 一路点 "Next" → "Install"
  4. 完成后点 "Finish"
```

**验证安装成功：**

```
按 Win+R → 输入 cmd → 回车（打开 cmd 黑窗口）
在黑窗口里输入：
  node --version
应该显示类似 v20.11.0（版本号 ≥ 18 就行）

再输入：
  npm --version
应该显示类似 10.x.x（说明包管理器也装好了）
```

---

### 第二步：安装 Claude Code

> Claude Code 是 Anthropic 官方的命令行 AI 编程助手。

```bash
# 在刚才的黑窗口（cmd）里输入：
npm install -g @anthropic-ai/claude-code
```

**验证：**
```bash
claude --version
# 显示版本号就成功了
```

**首次使用需要登录：**
```bash
claude
# 按提示登录你的 Anthropic 账号
# （如果还没账号，先去 console.anthropic.com 注册）
```

---

### 第三步：下载本项目

**方式一：用 Git 命令行下载（推荐）**

```bash
# 先定位到你的用户目录（就是放你自己文件的地方）
# %USERPROFILE% 是系统变量，自动等于 C:\Users\你的用户名
cd %USERPROFILE%

# 下载项目
git clone https://github.com/Avid811/iphone_remote_control_cc.git

# 进入 bridge 子目录
cd iphone_remote_control_cc\bridge

# 安装依赖
npm install
```

**方式二：不会用 Git？用 ZIP 包下载**

1. 打开浏览器，访问 `https://github.com/Avid811/iphone_remote_control_cc`
2. 点页面上绿色的 **"<> Code"** 按钮 → 选 **"Download ZIP"**
3. 下载完成后，**解压到桌面**（右键 zip → 全部解压 → 选桌面）
4. 桌面上会多出一个 `iphone_remote_control_cc` 文件夹
5. **打开这个文件夹 → 再打开里面的 `bridge` 子文件夹**
6. 在 `bridge` 文件夹的**地址栏**（顶部那条路径）里输入 `cmd` 然后按回车
7. 弹出的黑窗口就已经定位到这个文件夹了，然后输入：
   ```bash
   npm install
   ```

> ⚠️ 如果提示 `git` 命令不存在：去 [git-scm.com](https://git-scm.com/download/win) 下载安装 Git，选默认选项一路 Next 就行。

**`npm install` 做了什么？** 下载 bridge 服务器需要的 3 个组件（express、ws、node-pty），大概 2MB，很快。

> ⚠️ 如果 `npm install` 报错，通常是缺少 C++ 编译工具（node-pty 需要）：
> ```bash
> # 管理员 PowerShell 运行：
> npm install --global windows-build-tools
> # 等它装完（比较慢，大概 5-10 分钟），然后再：
> npm install
> ```

---

### 第四步：开放防火墙端口

> **这一步很重要！** 不开放防火墙，iPhone 连不上你的电脑。

```bash
# 点"开始" → 搜索 "PowerShell" → 右键 → "以管理员身份运行"
# 粘贴这条命令，回车：
netsh advfirewall firewall add rule name="Claude Bridge" dir=in action=allow protocol=TCP localport=3000
```

看到 "确定" 或 "Ok." 就成功了。

---

### 第五步：启动服务

**最简单的方式：**

打开 `bridge` 文件夹 → 双击 **`start.bat`**

会弹出一个黑窗口，自动完成：
```
===================================
  Claude Bridge Server
===================================

[1/3] Checking port 3000...
  Port 3000 is free.

[2/3] Installing dependencies...
  Done.

[3/3] Starting server in background...

==========================================
  iPhone Safari open:

  LAN:  http://192.168.1.104:3000
  Tailscale: http://你的Tailscale IP:3000
==========================================

Server started in background!
This window will auto-close in 5 seconds...
```

> 📝 **记下这个地址！** 比如 `http://192.168.1.104:3000` — 等会 iPhone 就用它连接。

5 秒后窗口自动关闭，服务在**后台持续运行**。想停止的话，双击 `stop.bat`。

---

## 🔔 Bark 推送通知 — 完整的通知链路

> **Bark 是什么？** 一个免费的 iOS App。电脑上的程序通过一个简单的 URL 就能把推送消息发到你的 iPhone。
>
> **在这个项目里的核心价值：** 你不是总盯着电脑屏幕的。当 Claude 执行到一半卡在权限确认时（"是否允许执行这个命令？"），Bark 立刻推送到你的 iPhone。点开推送 → 跳转到掌機 → 点一下 [允许] → Claude 继续干活。整个过程 10 秒搞定。

### 整个链路是怎么跑的

```
Claude 卡在权限确认
  │
  ▼
bridge/server.js 的 PTY 输出检测
  │  detectPermission() 正则匹配 9 种模式
  │  匹配到 "Do you want to allow..." / "是否允许..." / "[y/n]" 等
  ▼
sendBarkNotification() 被调用  ←── 完全内置在 server.js 第 99-111 行
  │  用 Node.js 原生 https 模块
  │  零外部依赖，不依赖任何第三方项目或 Python 脚本
  ▼
Bark API (api.day.app/你的Key)
  │  Apple Push Notification Service (APNs)
  ▼
你的 iPhone
  ├─ 收到推送通知："Claude 需要确认 — 安装依赖包，是否继续？"
  ├─ 点击推送 → Safari 打开掌機页面
  └─ 掌機界面弹出权限对话框 → 点 [允许] 或 [拒绝]
```

### 什么会触发 Bark 通知？什么不会？

**会触发 ✅**（bridge 自己的 Claude 会话检测到权限时）：

| 触发场景 | 正则模式示例 |
|---------|------------|
| Claude 问是否允许执行命令 | `Do you want to allow/proceed/continue...` |
| 中文权限询问 | `是否允许/继续/执行` |
| y/n 确认提示 | `[y/n]`、`(y/n)`、`Press y to...` |
| 多选项确认 | `1. Yes 2. No 3. Allow all` |
| 权限关键词 | `Permission required` |

**不会触发 ❌**（这些不在 bridge 的检测范围内）：
- Claude 开始执行工具（如"正在读取文件..."）
- 工具执行完成（如"写入成功"）
- Claude 报错
- 上下文压缩

> 💡 **为什么只覆盖权限确认？** 因为这是唯一需要你**立刻介入**的场景。工具执行、完成、报错等信息都不需要你即时反应——你下次打开掌機自然能看到。如果每个工具调用都推送，你的手机会被轰炸。

### 安装和获取 Key

1. iPhone 上打开 App Store → 搜索 **"Bark"** → 安装
2. 打开 Bark App → 注册设备
3. 首页显示类似：
   ```
   https://api.day.app/KmoqoxbnTRzWPoLztRoUtj
   ```
   **`/` 后面那串字符就是你的 Key**，复制下来。

### 设置环境变量

```powershell
# PowerShell（管理员）运行，把 "你的Key" 替换成你刚才复制的：
[System.Environment]::SetEnvironmentVariable('BARK_KEY', '你的Key', 'User')
```

> ⚠️ 设置后需要**重启 start.bat**（先双击 stop.bat，再双击 start.bat）才能生效。

### 测试 Bark 是否配置成功

```bash
# 把 "你的Key" 替换掉
curl "https://api.day.app/你的Key/测试标题/测试内容?sound=alarm"
```

iPhone 收到推送 → ✅ 配置成功！

> 📖 更详细的配置说明见 **[SETUP.md](./SETUP.md)**

---

## 🌐 配置 Tailscale 组网（推荐）

> **Tailscale 是什么？** 一个免费的虚拟局域网工具。让你在任何地方（公司、咖啡厅、外地）都能安全地连回家里的电脑，不需要公网 IP。

### 安装

1. 电脑：打开 [tailscale.com/download](https://tailscale.com/download) → 下载 Windows 版 → 安装
2. iPhone：App Store 搜 "Tailscale" → 安装
3. 两台设备登录**同一个账号**（用 Google/GitHub/邮箱注册都行）

### 查看地址

```bash
# 命令行输入：
tailscale ip -4
# 输出类似：100.84.123.56  ← 这就是你的 Tailscale IP
```

之后在 iPhone 上访问 `http://100.84.123.56:3000` 就能连上，**无论你在哪里**。

> 如果不想装 Tailscale，也可以用局域网 IP（电脑和 iPhone 连同一个 WiFi 时），但只能在家的范围用。

---

## 📱 iPhone 连接与使用

### 首次连接

1. 确保电脑上的 bridge 服务已启动（双击了 start.bat）
2. 打开 iPhone Safari
3. 输入地址：
   - 有 Tailscale：`http://你的Tailscale IP:3000`（比如 `http://100.84.123.56:3000`）
   - 在家同一 WiFi：`http://电脑局域网IP:3000`（start.bat 里会显示）
4. 看到 **"CLAUDE 掌機"** 欢迎界面 → 🎉 成功了！

```
  ┌─────────────────────────────────┐
  │  CLAUDE 掌機              v8    │
  │                        就绪 ●   │
  ├─────────────────────────────────┤
  │                                 │
  │         CLAUDE 掌機              │
  │                                 │
  │   ▸ 远程操控 Windows Claude Code │
  │   ▸ 输入指令开始对话              │
  │   ▸ 权限请求时会弹出[允许/拒绝]    │
  │                                 │
  ├─────────────────────────────────┤
  │                                 │
  │   ┌─────────────────────────┐   │
  │   │ 输入指令...              │ ▶ │
  │   └─────────────────────────┘   │
  └─────────────────────────────────┘
```

> 💡 **添加到主屏幕（强烈推荐）**：Safari 底部点分享按钮（方框+箭头）→ 往下滑 → "添加到主屏幕" → 命名 "掌機" → 添加。之后就像 App 一样直接点开，全屏无浏览器边框。

### 使用小贴士

| 操作 | 怎么做 |
|------|--------|
| 发送消息 | 输入框打字 → 点 **▶**（或键盘上按回车） |
| 看 Claude 的思考过程 | 点折叠的 **"▸ 思考过程(N行)"** 按钮 |
| 同意权限 | 弹出对话框后点绿色 **[允许]** |
| 拒绝权限 | 弹出对话框后点红色 **[拒绝]** |
| 取消当前操作 | 点红色的 **✕** 按钮 |
| 查看电脑上的 Claude 窗口 | 向下滑，看 "电脑活跃会话" 面板 |
| 接管一个电脑上的对话 | 在活跃会话里点 **[接管]** |
| 向电脑 Claude 窗口发指令 | 先点 **[允许]/[拒绝]**（进入注入模式），然后输入文字 |

---

## 🏗️ 系统架构（进阶阅读）

```
bridge/
├── server.js              # 核心：Express + WebSocket + PTY
│                          #   - 启动 claude --bare 在伪终端里
│                          #   - 剥离 ANSI 转义码，分类思考/回答
│                          #   - WebSocket 双向通信
│                          #   - 权限检测 → Bark 推送
│
├── session-monitor.js     # 外部会话扫描器
│                          #   - 每 3 秒扫描 ~/.claude/sessions/*.json
│                          #   - 过滤/去重/排序
│                          #   - 判断是否卡在权限确认
│
├── inject-keystroke.ps1   # 按键注入 (PowerShell + C# Win32 API)
│                          #   - 方法1: AttachConsole + WriteConsoleInput
│                          #   - 方法2: keybd_event + SetForegroundWindow
│                          #   - 方法3: 剪贴板粘贴 (中文等非ASCII)
│
├── inject-keystroke.c     # C 版按键注入（可选，更快）
├── read-console.ps1       # 控制台窗口截图 (GDI+ → PNG base64)
├── test-e2e.js            # 端到端自动化测试
├── start.bat / stop.bat   # 一键启停
└── public/index.html      # iPhone 前端 (纯 HTML/CSS/JS 单页)
```

### 核心数据流

```
iPhone Safari
  │  WebSocket (ws://ip:3000/ws)
  ▼
server.js ←→ PTY (node-pty) ←→ claude --bare 进程
  │                              │
  │  stripAnsi()                 │ 原始输出 (含 ANSI 颜色码)
  │  \r 覆写处理                 │
  │  思考/回答分类               │
  │  ● 标记检测 → inAnswer       │
  │  权限模式匹配 → Bark         │
  │  200ms flush 批处理          │
  │  1.5s idle 检测              │
  │                              │
  ▼                              │
iPhone 显示                      │
  ├─ 思考过程 (折叠)              │
  ├─ 回答内容 (高亮)              │
  ├─ 状态栏 (思考中...(5s))       │
  └─ 权限弹窗 (如触发)            │
```

### 权限检测的 9 种模式

`server.js` 用正则匹配 Claude 的权限提示，覆盖中英文：

```javascript
/Do you want to (allow|proceed|continue|run|execute|make)/i  // 英文通用
/(Allow|Proceed)\?\s*\[?\s*[yY]/i                             // 英文短格式
/是否(允许|继续|执行)/                                          // 中文
/\[y\/n\]/i, /\(y\/n\)/i                                      // y/n 提示符
/Press\s+[yY]\s+to/i                                          // 按键提示
/Permission.*required/i                                       // 权限关键词
/\b[1-3]\.\s+(Yes|No|Allow)/i                                 // 多选项
/\bYes,?\s+allow\s+all/i                                      // 批量确认
/shift\+tab/i                                                  // 特殊操作
```

---

## 🔌 API 参考

### HTTP 端点

| 端点 | 方法 | 说明 | 返回示例 |
|------|------|------|---------|
| `/` | GET | iPhone Web 控制台 | HTML 页面 |
| `/health` | GET | 健康检查 | `{"status":"ok","uptime":42.5,"sessions":1}` |
| `/api/external-sessions` | GET | 外部 Claude 会话列表 | `{"sessions":[...]}` |
| `/ws` | WebSocket | 实时双向通信 | JSON 消息流 |

### WebSocket 消息

**你发出去的（客户端→服务器）：**

| type | 字段 | 什么时候发 |
|------|------|-----------|
| `message` | `text: string` | 输入框打字点发送 |
| `permission_allow` | — | 点 [允许] 按钮 |
| `permission_deny` | — | 点 [拒绝] 按钮 |
| `cancel` | — | 点 ✕ 按钮 |
| `inject_permission` | `pid, text` | 向外部 Claude 窗口注入按键 |
| `capture_terminal` | `pid` | 请求截图看 Claude 窗口 |
| `take_over_session` | `externalSessionId` | 点 [接管] 按钮 |

**你收到的（服务器→客户端）：**

| type | 字段 | 含义 |
|------|------|------|
| `status` | `state, sessionId` | 状态变更：`idle`→就绪，`processing`→思考中，`awaiting_permission`→等确认，`done`→结束 |
| `thinking_block` | `text` | Claude 的思考过程，前端折叠显示 |
| `answer_block` | `text` | Claude 的回答，前端白字高亮 |
| `output_status` | `text` | 状态栏文字 _"思考中...(5s)"_ |
| `need_permission` | `text` | 🚨 权限请求！前端弹出确认框 + 震动 |
| `ready_for_input` | — | Claude 就绪，输入框可用了 |
| `session_ended` | `code` | 会话结束 |
| `external_sessions_update` | `sessions[]` | 电脑上外部 Claude 窗口列表 |
| `inject_result` | `pid, text, success, message` | 按键注入结果反馈 |
| `terminal_capture` | `pid, text` | PNG 截图 (base64 编码) |
| `take_over_result` | `sessionId, success, history` | 接管结果 + 完整对话历史 |

---

## 🧪 运行测试

```bash
cd bridge
node test-e2e.js
```

测试覆盖：健康检查、外部会话 API、WebSocket 通信、按键注入、会话监控逻辑、PowerShell 脚本语法。

---

## ❓ 常见问题

<details>
<summary><b>Q: iPhone 打不开页面？</b></summary>

排查顺序（按这个来）：
1. **服务在运行吗？** 电脑上打开浏览器访问 `http://localhost:3000/health`，如果看到 `{"status":"ok"}` 说明服务正常
2. **防火墙开了吗？** 运行 `netsh advfirewall firewall show rule name="Claude Bridge"` 确认规则存在
3. **IP 地址对吗？** iPhone 和电脑连的是同一个 WiFi 吗？Tailscale 都登录了吗？
4. **换个浏览器试试？** 偶尔 Safari 缓存问题，试试 Chrome
</details>

<details>
<summary><b>Q: 按键注入失败（点了允许/拒绝没反应）？</b></summary>

按键注入调用 Win32 API，需要管理员权限：
1. 右键 `start.bat` → **"以管理员身份运行"**
2. 或者管理员 PowerShell 里运行 `node server.js`

如果目标 Claude 在 Windows Terminal 里，PowerShell 脚本会自动用 keybd_event 回退方案，一般都能成功。
</details>

<details>
<summary><b>Q: 看不到电脑上其他 Claude 窗口？</b></summary>

1. 确保那个 Claude 是独立启动的（不是通过 bridge 启动的）
2. 必须运行超过 3 秒才会被扫描到
3. 检查 `%USERPROFILE%\.claude\sessions\` 目录下是否有对应的 `.json` 文件
4. 会话状态文件如果超过 30 分钟没更新会被忽略
</details>

<details>
<summary><b>Q: Bark 推送收不到？</b></summary>

1. 先单独测试 Bark API：
   ```bash
   curl "https://api.day.app/你的Key/测试/内容?sound=alarm"
   ```
2. 确认环境变量：`echo %BARK_KEY%` 应显示你的 Key
3. **重启 bridge**：设置环境变量后必须重启服务
4. 检查防火墙出站规则：Node.js 需要能访问 `api.day.app`
</details>

<details>
<summary><b>Q: 端口 3000 被占用了？</b></summary>

`start.bat` 会自动释放端口。手动方式：
```bash
netstat -ano | findstr ":3000.*LISTENING"
taskkill /F /PID <那行的最后一个数字>
```
或者换个端口：`set PORT=3001 && node server.js`
</details>

<details>
<summary><b>Q: npm install 报错（node-pty 编译失败）？</b></summary>

node-pty 需要 C++ 编译环境：
```bash
# 管理员 PowerShell：
npm install --global windows-build-tools
# 等 5-10 分钟装完，然后再：
npm install
```
如果还不行，去 [visualstudio.microsoft.com](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio) 下载 "Build Tools for Visual Studio"，安装时勾选 "C++ 桌面开发"。
</details>

<details>
<summary><b>Q: 接管会话后聊天记录是空的？</b></summary>

聊天记录从 `~/.claude/projects/<项目名>/<sessionId>.jsonl` 读取。如果：
- 接管的是刚启动还没对话的 Claude → 记录为空正常
- 项目目录名规范化后不匹配 → 检查 `~/.claude/projects/` 下的目录名
- Claude 版本太旧，jsonl 格式不同 → 升级 Claude Code
</details>

---

## 🔒 安全注意事项

| 要点 | 说明 |
|------|------|
| 🔐 仅内网使用 | Bridge 无身份验证，必须通过 Tailscale 或局域网访问，**绝不要暴露到公网** |
| ⚡ 管理员权限 | 按键注入需要 Win32 API 权限，以管理员身份运行 |
| 🔑 密钥走环境变量 | Bark Key 等敏感信息通过环境变量配置，不写入代码 |
| 📁 敏感文件已排除 | `.gitignore` 排除了 `.claude/settings.local.json`、`sessions/`、编译产物 |

---

## 📋 验证环境

| 组件 | 版本 | 备注 |
|------|------|------|
| Windows | 10 Pro 22H2 | Win 11 也完全支持 |
| Node.js | v20 LTS | v18+ 都可以 |
| Claude Code | 最新版 | `npm install -g @anthropic-ai/claude-code` |
| Tailscale | v1.80+ | 免费版即可 |
| iPhone Safari | iOS 18 | iOS 16+ 都没问题 |

---

## 📄 License

MIT

---

<p align="center">
  <b>🕹️ 掌中 Claude，随时随地写代码。</b><br>
  <sub>Bark 推送保平安，卡住不怕没人管。</sub>
</p>

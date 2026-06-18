# 🔑 配置指南 — 从零到完美运行

> 克隆本项目后，按此文档逐步配置。每一步约 2-3 分钟，全部完成后即可在任何地方用 iPhone 操控 Claude Code。

---

## 🗺️ 路线图

```
第一步 (必须)          第二步 (推荐)        第三步 (推荐)      第四步 (必须)
安装 Node.js      →   配置 Bark 推送   →   配置 Tailscale  →   防火墙 + 启动
+ Claude Code                                                      + iPhone 连接
```

---

## 第一步：安装前置依赖（必须）

### 1.1 安装 Node.js

```bash
# 方法 1: winget（Windows 11 自带）
winget install OpenJS.NodeJS.LTS

# 方法 2: 官网下载
# https://nodejs.org/ → 下载 LTS 版本 → 双击安装
```

验证：
```bash
node --version    # 应显示 v18.x 或更高
npm --version     # 应显示 9.x 或更高
```

### 1.2 安装 Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

验证：
```bash
claude --version  # 应显示版本号
```

> 💡 首次运行 `claude` 需要登录 Anthropic 账号。如果还没账号，去 [console.anthropic.com](https://console.anthropic.com) 注册。

### 1.3 安装项目依赖

```bash
cd iphone_remote_control_cc/bridge
npm install
```

> 依赖只有 3 个：`express`（HTTP 服务）、`node-pty`（伪终端）、`ws`（WebSocket）。安装很快。

---

## 第二步：配置 Bark 推送通知（推荐）

Bark 是 iOS 推送通知 App。Claude 需要权限确认时，即使你不看手机屏幕，也能收到推送提醒。

### 2.1 获取 Bark Key

1. iPhone App Store 搜索 **"Bark"**，安装
2. 打开 App → 注册设备
3. 首页显示类似 `https://api.day.app/KmoqoxbnTRzWPoLztRoUtj`
4. **`/` 后面的那串字符就是你的 Key**

### 2.2 测试推送

```bash
# 把 "你的Key" 替换为实际 Key
curl "https://api.day.app/你的Key/测试标题/测试内容?sound=alarm&level=timeSensitive&group=Claude"
```

iPhone 收到推送 → 配置成功 ✅

### 2.3 设置环境变量

**方法 A：系统环境变量（推荐，永久生效）**

```powershell
# PowerShell（管理员）
[System.Environment]::SetEnvironmentVariable('BARK_KEY', '你的BarkKey', 'User')
```

设置后需要**重启终端**（或注销重登录）才能使新进程读取到。

**方法 B：在 start.bat 中设置**

编辑 `bridge/start.bat`，在 `@echo off` 下一行添加：
```batch
set BARK_KEY=你的BarkKey
```

**方法 C：临时设置**

```bash
set BARK_KEY=你的BarkKey && node server.js
```

---

## 第三步：配置 Tailscale 网络（推荐）

Tailscale 让你在任何地方通过 iPhone 安全访问家里的电脑，无需公网 IP。

### 3.1 安装

1. [tailscale.com/download](https://tailscale.com/download) → 下载 Windows 客户端 → 安装
2. iPhone App Store 搜索 "Tailscale" → 安装
3. 两台设备登录**同一个 Tailscale 账号**

### 3.2 验证连接

```powershell
# Windows PowerShell
tailscale status
# 应该看到你的 iPhone 在线

tailscale ip -4
# 输出类似: 100.84.123.56  ← 这就是你的 Tailscale IP，记下来
```

### 3.3 配置环境变量（可选）

```powershell
[System.Environment]::SetEnvironmentVariable('TAILSCALE_IP', '100.84.123.56', 'User')
```

> 这个变量仅用于启动日志显示，不配置也不影响功能。

---

## 第四步：防火墙 + 启动（必须）

### 4.1 开放防火墙端口

```powershell
# PowerShell（管理员）
netsh advfirewall firewall add rule name="Claude Bridge" dir=in action=allow protocol=TCP localport=3000
```

> 💡 如果只用 Tailscale，可以限定只在该接口上开放：
> 打开 "Windows 防火墙高级安全" → 入站规则 → 找到 "Claude Bridge" → 属性 → 高级 → 接口 → 仅勾选 "Tailscale"

### 4.2 启动服务

**最简单：双击 `bridge/start.bat`**

脚本会自动：
1. 释放 3000 端口（如果被占用）
2. 安装 npm 依赖（如果还没装）
3. 检测局域网 IP
4. 后台启动 Node.js 服务
5. 显示访问地址，5 秒后窗口自动关闭

**或命令行：**

```bash
cd bridge
node server.js
```

启动后显示：
```
  Claude Bridge  http://localhost:3000
  Tailscale      http://你的Tailscale IP:3000
```

### 4.3 停止服务

双击 `bridge/stop.bat`，或直接关闭命令行窗口。

---

## 第五步：iPhone 连接

1. 确保 iPhone 已连接 Tailscale（App 中看到绿色 ✓）
2. Safari 打开 `http://你的Tailscale IP:3000`
   - 或局域网: `http://192.168.x.x:3000`
3. 看到 **"CLAUDE 掌機"** 复古界面 → 成功！🎉

> 💡 **添加到主屏幕**：Safari → 分享按钮 → "添加到主屏幕"，获得类 App 全屏体验。

---

## 📋 配置检查清单

| 检查项 | 命令 | 预期结果 |
|--------|------|---------|
| Node.js 已安装 | `node --version` | v18.x 或更高 |
| Claude Code 已安装 | `claude --version` | 显示版本号 |
| npm 依赖已安装 | `ls bridge/node_modules/express` | 目录存在 |
| Bark Key 已配置 | `echo %BARK_KEY%` | 显示你的 Key |
| Bark 推送可达 | 见 2.2 节 curl 测试 | iPhone 收到推送 |
| Tailscale 已连接 | `tailscale status` | iPhone 显示在线 |
| Tailscale IP | `tailscale ip -4` | 显示 100.x.x.x |
| 防火墙已放行 | `netsh advfirewall firewall show rule name="Claude Bridge"` | 规则存在 |
| 服务已启动 | `curl http://localhost:3000/health` | `{"status":"ok",...}` |
| iPhone 可访问 | Safari 打开 URL | 显示 "CLAUDE 掌機" |

---

## 🔧 可选：编译 C 版按键注入

PowerShell 版 (`inject-keystroke.ps1`) 在所有 Windows 10/11 上直接可用，**无需编译**。

如果追求更快的注入速度（省去 PowerShell 启动开销）：

```bash
# 方法 1: MSVC (Developer Command Prompt for VS)
cd bridge
build-inject.bat

# 方法 2: GCC
gcc -O2 inject-keystroke.c -o inject-keystroke.exe

# 方法 3: MinGW-w64
x86_64-w64-mingw32-gcc -O2 inject-keystroke.c -o inject-keystroke.exe
```

编译后 `server.js` 会自动优先使用 `.exe` 版本。

---

## ❓ 常见配置问题

### Q: 启动后 iPhone 连不上？

```
排查顺序：
1. curl http://localhost:3000/health    ← 服务是否在运行？
2. curl http://电脑IP:3000/health       ← 局域网是否可达？
3. 检查防火墙规则                       ← 端口是否被阻止？
4. 确认 iPhone 在同一网络               ← Tailscale 或 WiFi？
```

### Q: `npm install` 报错？

```
1. node-pty 需要 C++ 编译工具
   → 管理员 PowerShell 运行:
     npm install --global windows-build-tools
   → 或安装 Visual Studio Build Tools:
     https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio

2. 如果还是失败，尝试:
     npm install --force
```

### Q: PowerShell 脚本被阻止？

```powershell
# 管理员 PowerShell 运行一次即可
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Q: Tailscale 连接慢？

```
1. Tailscale 会自动选择最优路径（直连或中继）
2. 如果两台设备在同一局域网，通常直连很快
3. 查看状态: tailscale status
   显示 "direct" → 直连 ✅
   显示 "relay"  → 中继，稍慢但可用
```

---

> 🎉 配置完成后，回到 [README.md](./README.md) 查看使用指南和 API 文档。

# 🔑 配置指南 — 克隆后必须替换的 Key

> 克隆本项目后，按此文档逐步配置，确保所有功能正常工作。

---

## 第一步：安装前置依赖

```bash
# 1. Node.js（如果还没有）
winget install OpenJS.NodeJS.LTS

# 2. Claude Code
npm install -g @anthropic-ai/claude-code

# 3. 验证安装
node --version    # 应显示 v20.x 或更高
claude --version  # 应显示版本号

# 4. 安装项目依赖
cd iphone_control/bridge
npm install
```

---

## 第二步：配置 Bark 推送通知（可选但强烈推荐）

Bark 是一款 iOS 推送通知 App，当 Claude 需要权限确认时，会向你的 iPhone 发送推送通知。

### 2.1 获取 Bark Key

1. 在 iPhone App Store 搜索 **"Bark"**，安装 App
2. 打开 Bark App，注册设备
3. 在 App 首页会看到类似这样的地址：
   ```
   https://api.day.app/KmoqoxbnTRzWPoLztRoUtj
                            └────── 这就是你的 Key ──────┘
   ```
4. 复制你的 Key（`/` 后面的那串字符）

### 2.2 配置环境变量

**方法 A：系统环境变量（推荐）**

```powershell
# PowerShell 管理员模式
[System.Environment]::SetEnvironmentVariable('BARK_KEY', '你的BarkKey', 'User')
```

**方法 B：在 start.bat 中设置**

编辑 `bridge/start.bat`，在文件开头添加：
```batch
set BARK_KEY=你的BarkKey
```

**方法 C：启动时传入**

```bash
# 命令行启动
set BARK_KEY=你的BarkKey && node server.js
```

> ⚠️ **不要将 Bark Key 写入 `server.js` 代码中**。代码中已移除硬编码的 Key，改为读取 `BARK_KEY` 环境变量。

### 2.3 测试 Bark 推送

```bash
curl "https://api.day.app/你的BarkKey/测试标题/测试内容?sound=alarm&level=timeSensitive&group=Claude"
```

如果 iPhone 收到推送，说明配置成功。

---

## 第三步：配置 Tailscale 网络（推荐）

Tailscale 让你在任何地方通过 iPhone 安全访问家里的电脑。

### 3.1 安装 Tailscale

1. 在 [tailscale.com/download](https://tailscale.com/download) 下载 Windows 客户端并安装
2. 在 iPhone App Store 搜索 "Tailscale" 并安装
3. 在两台设备上登录同一个 Tailscale 账号

### 3.2 查看你的 Tailscale IP

```powershell
tailscale ip -4
# 输出类似: 100.84.123.56
```

### 3.3 配置环境变量（可选）

```powershell
[System.Environment]::SetEnvironmentVariable('TAILSCALE_IP', '你的Tailscale IP', 'User')
```

> 这个变量仅用于启动日志显示，不影响实际功能。即使不配置，服务也能正常运行。

---

## 第四步：配置 Windows 防火墙

Bridge 服务器监听 `0.0.0.0:3000`，需要允许入站连接：

```powershell
# PowerShell 管理员模式
netsh advfirewall firewall add rule name="Claude Bridge" dir=in action=allow protocol=TCP localport=3000
```

如果使用 Tailscale，也可以只在 Tailscale 网络接口上开放：
1. 打开 "Windows 防火墙高级设置"
2. 找到 "Claude Bridge" 规则
3. 属性 → 高级 → 接口 → 仅勾选 "Tailscale" 接口

---

## 第五步：启动服务

### 双击启动（最简单）

在 `bridge/` 目录下，双击 **`start.bat`**

脚本会自动：
1. 检查并释放 3000 端口
2. 安装 npm 依赖
3. 检测局域网 IP
4. 后台启动 Node.js 服务器

启动后窗口显示：
```
==========================================
  iPhone Safari open:

  LAN:  http://192.168.1.104:3000
  Tailscale: http://你的Tailscale IP:3000
==========================================
```

5 秒后窗口自动关闭，服务器在后台持续运行。

### 或命令行启动

```bash
cd bridge
node server.js
```

### 停止服务

双击 **`stop.bat`** 即可。

---

## 第六步：iPhone 连接

1. 确保 iPhone 已连接 Tailscale（或在同一局域网）
2. Safari 打开 `http://你的Tailscale IP:3000` 或 `http://电脑局域网IP:3000`
3. 看到 "CLAUDE 掌機" 界面后，即可开始使用

> 💡 **添加到主屏幕**：Safari 中点击分享按钮 → "添加到主屏幕"，获得类 App 体验。

---

## 可选：编译 C 版 inject-keystroke.exe

`inject-keystroke.ps1` (PowerShell) 在所有 Windows 10/11 上直接可用，无需编译。

如果你想要更快的注入速度（C 版本无需 Powershell 启动开销），可以编译 C 版本：

```bash
# 方法 1: 使用 MSVC (Developer Command Prompt for VS)
cd bridge
build-inject.bat

# 方法 2: 使用 GCC
gcc -O2 inject-keystroke.c -o inject-keystroke.exe

# 方法 3: 使用 MinGW-w64
x86_64-w64-mingw32-gcc -O2 inject-keystroke.c -o inject-keystroke.exe
```

编译成功后，`server.js` 会自动优先使用 `.exe` 版本。

---

## 常见问题

### Q: iPhone 无法连接？

1. 确认电脑和 iPhone 在同一 Tailscale 网络（Tailscale App 中查看两台设备是否都在线）
2. 确认防火墙已放行端口 3000
3. 确认服务器正在运行：`curl http://localhost:3000/health`

### Q: 注入按键失败？

1. **以管理员权限运行**：右键 `start.bat` → "以管理员身份运行"
2. 或管理员 PowerShell 中运行 `node server.js`

### Q: 看不到外部会话？

1. 确认电脑上确实有独立运行的 `claude` 命令
2. 检查 `~/.claude/sessions/` 目录下是否有 `.json` 文件
3. 外部会话必须运行超过 3 秒才会被扫描到（排除启动中的进程）

### Q: Bark 推送收不到？

1. 确认 `BARK_KEY` 环境变量已正确设置
2. 先测试直接 curl Bark API 是否能收到推送
3. 检查防火墙是否阻止了 Node.js 的 HTTPS 出站连接

---

## 配置检查清单

| 检查项 | 命令/操作 | 预期结果 |
|--------|-----------|---------|
| Node.js 已安装 | `node --version` | v20.x 或更高 |
| Claude Code 已安装 | `claude --version` | 显示版本号 |
| npm 依赖已安装 | 双击 `start.bat` | 自动安装 |
| Bark Key 已配置 | `echo %BARK_KEY%` | 显示你的 Key |
| Tailscale 已连接 | `tailscale status` | 显示在线设备 |
| 防火墙已放行 | 见第四步 | 3000 端口可入站 |
| 服务器已启动 | `curl http://localhost:3000/health` | `{"status":"ok",...}` |
| iPhone 可访问 | Safari 打开 URL | 显示 "CLAUDE 掌機" 界面 |

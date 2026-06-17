================================================================================
    CLAUDE 掌機 (Claude Handheld Console) — iPhone ↔ Claude Code Bridge
================================================================================

项目简介
--------
这是一个 iPhone 远程操控 Windows Claude Code 的桥梁应用。通过 Tailscale
VPN 网络，你可以在 iPhone Safari 上打开一个复古风格的控制台界面，向运行在
Windows 上的 Claude Code CLI 发送指令，并实时查看回复。

核心思路：把 Claude Code 的 PTY 输出解析成"思考过程"和"回答"两部分，
思考过程默认折叠，回答高亮显示，模拟一个掌机控制台的体验。


项目结构
--------
  iphone_control/
  ├── README.txt                  ← 本文件（项目文档）
  ├── .claude/
  │   └── settings.local.json     ← Claude Code 全局权限配置
  └── bridge/
      ├── server.js               ← 核心后端 (Express + WebSocket + PTY)
      ├── package.json            ← Node.js 依赖声明
      ├── package-lock.json
      ├── start.bat               ← Windows 一键启动脚本
      ├── stop.bat                ← Windows 停止服务器脚本
      ├── public/
      │   └── index.html          ← iPhone 前端 (复古掌机 UI)
      ├── sessions/               ← Claude 会话持久化目录
      │   └── *.json              ← 各会话的状态文件
      ├── node_modules/           ← npm 依赖（已安装）
      └── .claude/
          └── settings.local.json ← bridge 目录的 Claude 权限配置


技术栈
--------
  - 后端:  Node.js + Express 4.21 + WebSocket (ws) + node-pty
  - 前端:  纯 HTML/CSS/JS（无框架），适合 iPhone Safari
  - 网络:  Tailscale VPN (100.105.91.55:3000) + LAN (192.168.x.x:3000)
  - 通知:  Bark API（iPhone 推送通知，权限请求时触发）
  - PTY:   node-pty 在 Windows 下通过 cmd.exe 启动 claude --bare


核心机制
--------

1. PTY 启动 Claude
   - 用 node-pty 启动 cmd.exe → claude --bare
   - 捕获所有原始输出（含 ANSI 控制码）
   - 环境变量 TERM=xterm-256color

2. 输出解析流水线
   a) stripAnsi()     — 去除 ANSI 转义序列
   b) 按 \n 分行      — 按换行符拆成完整逻辑行
   c) 按 \r 取最后段  — 处理 PTY 覆盖写入（状态指示器用 \r 刷新同一行）
   d) 过滤无用行      — 欢迎信息、空行、纯装饰线、裸提示符等
   e) 分类路由:
      - ● 开头 → 切换到"回答模式"，积累到 answerAccum
      - ❯ 开头 → 刷新前序内容，作为用户输入回显
      - 思考状态行（Pollinating/Baking/Thinking...）→ 更新状态栏
      - 其余文本 → 按模式积累到 thinkingAccum 或 answerAccum

3. 刷新策略
   - 每收到数据重置 flushTimer (200ms 延迟合并)
   - 空闲检测: 1.5s 无数据 → 切换到 idle 状态

4. 权限检测
   - 正则匹配权限提示文本（中英文均支持）
   - 检测到后: 发送 WebSocket 消息 + Bark 推送通知
   - iPhone 端弹出 [允许/拒绝] 按钮

5. 会话管理
   - 每个 WebSocket 连接对应一个 session
   - session 绑定一个 PTY 进程
   - 30 分钟无 WebSocket 连接的 session 自动清理
   - SIGINT 时清理所有 PTY 子进程

6. 前端渲染
   - 思考块 (think-block): 默认折叠，点击展开/收起，灰色斜体
   - 回答块 (answer-block): 高亮白色，直接可见
   - 命令块 (cmd-block): 青色，显示用户输入
   - 状态栏 (status-line): 显示"思考中..."等动态状态
   - LED 指示灯: 绿色=就绪, 黄色闪烁=处理中, 红色快闪=确认
   - CRT 扫描线效果: CSS 伪元素叠加
   - 欢迎覆盖层: 首次连接时显示，首次输出后自动消失


启动方法
--------
  # 方法 1: 双击 start.bat（推荐）
  start.bat

  # 方法 2: 手动启动
  cd bridge
  npm install          ← 首次或依赖变更时
  node server.js

  # 方法 3: 开发模式（无实际差异）
  npm run dev

  # 停止服务器
  stop.bat             ← 或 Ctrl+C


访问方式
--------
  iPhone Safari 打开以下任一地址:
  - LAN:       http://192.168.1.104:3000    （本地局域网）
  - Tailscale: http://100.105.91.55:3000    （远程 VPN）

  Windows 本地测试:
  - http://localhost:3000
  - 健康检查: http://localhost:3000/health


WebSocket 协议
--------------
  服务端 → 客户端消息类型:
  - status             { state: 'idle'|'processing'|'awaiting_permission'|'done', sessionId }
  - thinking_block     { text: '...' }        ← 思考过程（客户端默认折叠）
  - answer_block       { text: '...' }        ← 回答内容（客户端高亮显示）
  - output_status      { text: '...' }        ← 状态栏文本
  - need_permission    { text: '...' }        ← 权限请求详情
  - ready_for_input                            ← 可以输入新指令
  - session_ended      { code: number }        ← 会话结束

  客户端 → 服务端消息类型:
  - message            { text: '...' }        ← 发送给 Claude 的指令
  - permission_allow                          ← 用户点击"允许"
  - permission_deny                           ← 用户点击"拒绝"
  - cancel                                    ← 用户取消当前操作 (Ctrl+C)


依赖项
--------
  - express ^4.21.0       Web 框架
  - ws ^8.18.0            WebSocket 服务端
  - node-pty ^1.1.0       PTY 伪终端（需要 Windows 编译工具链）


关联服务
--------
  - Tailscale VPN    提供安全远程访问 (IP: 100.105.91.55)
  - Bark App         iPhone 推送通知 (Key: 见 bridge/server.js 中 BARK_KEY)
  - Claude Code CLI  必须在 PATH 中可执行 (claude --bare)


已知限制 / TODO
--------
  - node-pty 在某些 Windows 环境下需要 Visual Studio Build Tools 才能编译
  - 会话恢复: session JSON 已保存但未实现 PTY 断线重连后恢复历史上下文
  - 多用户: 当前每个 WebSocket 连接创建独立 Claude 进程，无共享上下文
  - 前端未做离线缓存 (PWA manifest)，刷新页面会丢失历史
  - Claude 输出解析依赖特定的 ANSI 格式，Claude Code 更新可能导致解析失败


更新日志
--------
  v1.0.0 (2026-06-17)
  - 初始版本
  - Express + WebSocket + PTY 桥接
  - 复古掌机 UI (CRT 扫描线、Press Start 2P 字体)
  - 思考/回答分离渲染
  - 权限检测 + Bark 通知
  - Tailscale 支持


维护者
--------
  lixiang
  项目路径: D:\claude_projects\iphone_control

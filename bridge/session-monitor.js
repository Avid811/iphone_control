/**
 * Session Monitor — 发现电脑上独立运行的 Claude Code 进程
 *
 * 定期扫描 ~/.claude/sessions/*.json，找出不被当前 bridge 管理的 Claude 进程。
 * 通过 WebSocket 推送给 iPhone 前端，支持远程确认权限和接管会话。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ---- Config ----
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const SCAN_INTERVAL = 3000;  // 每 3 秒扫描一次
const STALE_TIMEOUT = 30 * 60 * 1000;  // 30 分钟无更新的 session 视为过期

/**
 * 获取所有本地 Claude 会话（从 ~/.claude/sessions/ 读取）
 * 返回格式: [{ pid, sessionId, cwd, status, startedAt, updatedAt, version, name, kind }]
 */
function getClaudeSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));

    const sessions = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
        const data = JSON.parse(raw);
        if (data.pid && data.sessionId) {
          sessions.push({
            pid: data.pid,
            sessionId: data.sessionId,
            cwd: data.cwd || '',
            status: data.status || 'unknown',
            startedAt: data.startedAt || 0,
            updatedAt: data.updatedAt || data.startedAt || 0,
            version: data.version || '',
            name: data.name || '',
            kind: data.kind || 'interactive',
          });
        }
      } catch {
        // 解析失败，跳过
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

/**
 * 检查 PID 是否真实存在（进程在运行）
 */
function isPidRunning(pid) {
  try {
    const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.includes(`${pid}`);
  } catch {
    return false;
  }
}

/**
 * 获取指定父进程的所有 claude.exe 子进程 PID
 */
function getChildClaudePids(parentPid) {
  const pids = new Set();
  try {
    const result = execSync(
      `wmic process where (ParentProcessId=${parentPid} and Name="claude.exe") get ProcessId /value`,
      { encoding: 'utf-8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    // 输出格式: ProcessId=12345\r\n
    const matches = result.match(/ProcessId=(\d+)/g);
    if (matches) {
      matches.forEach(m => {
        const pid = parseInt(m.split('=')[1]);
        if (pid) pids.add(pid);
      });
    }
  } catch {
    // 忽略错误
  }
  return pids;
}

/**
 * 获取 bridge 自身管理的 PID 列表（包括 PTY cmd.exe 及其 claude.exe 子进程）
 * @param {Map} bridgeSessions - bridge 的 sessions Map
 */
function getBridgeManagedPids(bridgeSessions) {
  const pids = new Set();
  for (const [, session] of bridgeSessions) {
    if (session.pty && session.pty.pid) {
      // PTY 本身的 PID（通常是 cmd.exe）
      pids.add(session.pty.pid);
      // 查找 claude.exe 子进程 PID，因为 session JSON 文件记录的是 claude.exe 的 PID
      const childPids = getChildClaudePids(session.pty.pid);
      childPids.forEach(p => pids.add(p));
    }
  }
  return pids;
}

/**
 * 尝试检测某个 PID 的控制台窗口中是否包含权限提示文本
 * 通过获取控制台窗口标题来辅助判断
 */
function getConsoleWindowTitle(pid) {
  try {
    // 使用 tasklist /V 获取窗口标题
    const result = execSync(`tasklist /V /FI "PID eq ${pid}" /FO CSV /NH`, {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // CSV 格式: "进程名","PID","会话名","会话#","内存使用","状态","用户名","CPU时间","窗口标题"
    const match = result.match(/^"([^"]*)"/);
    if (match) {
      return result; // 返回整行以便分析窗口标题
    }
  } catch {
    // 忽略
  }
  return null;
}

/**
 * 主扫描函数
 * @param {Map} bridgeSessions - bridge 的 sessions Map
 * @returns {Array} 外部 Claude 会话列表
 */
function scanExternalSessions(bridgeSessions) {
  const allSessions = getClaudeSessions();
  const bridgePids = getBridgeManagedPids(bridgeSessions);
  const now = Date.now();

  // 第一步：去重 — 同一个 sessionId 只保留 updatedAt 最新的那条
  const deduped = new Map();
  for (const s of allSessions) {
    const existing = deduped.get(s.sessionId);
    if (!existing || s.updatedAt > existing.updatedAt) {
      deduped.set(s.sessionId, s);
    }
  }

  // 第二步：过滤 + 评分
  const results = [];
  for (const s of deduped.values()) {
    // 排除 bridge 自己管理的进程
    if (bridgePids.has(s.pid)) continue;

    // 排除过期太久的（可能是残留文件）
    const ageMs = now - s.updatedAt;
    if (ageMs > STALE_TIMEOUT) continue;

    // 必须真实在运行
    if (!isPidRunning(s.pid)) continue;

    // 只显示交互式会话（排除后台/headless）
    if (s.kind && s.kind !== 'interactive') continue;

    // 排除太新的会话（启动不到 3 秒，可能还没初始化完）
    const runningTime = now - s.startedAt;
    if (runningTime < 3000) continue;

    // ---- 判断是否正在等待权限 ----
    // Claude Code session status values:
    //   "waiting" → 等待用户交互（权限确认等）— 这是唯一可靠的等待信号
    //   "busy"   → 正在处理中
    //   "idle"   → 空闲等待下一条指令（不是权限确认）
    const stuckDuration = now - s.updatedAt;
    const likelyWaitingPermission = (s.status === 'waiting');

    results.push({
      pid: s.pid,
      sessionId: s.sessionId,
      cwd: s.cwd,
      status: s.status,
      runningTime: runningTime,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
      version: s.version,
      name: s.name,
      kind: s.kind,
      isExternal: true,
      likelyWaitingPermission: likelyWaitingPermission,
      stuckDuration: stuckDuration,
    });
  }

  // 第三步：排序 — 可能等待权限的排最前面，然后按运行时间降序
  results.sort((a, b) => {
    // 等待权限的优先
    if (a.likelyWaitingPermission !== b.likelyWaitingPermission) {
      return a.likelyWaitingPermission ? -1 : 1;
    }
    // 其次按 stuck 时间降序（卡越久越靠前）
    if (a.stuckDuration !== b.stuckDuration) {
      return b.stuckDuration - a.stuckDuration;
    }
    // 最后按运行时间降序
    return b.runningTime - a.runningTime;
  });

  return results;
}

/**
 * 格式化运行时长
 */
function formatRunningTime(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}秒`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}分钟`;
  return `${Math.floor(ms / 3600000)}小时${Math.floor((ms % 3600000) / 60000)}分钟`;
}

/**
 * 读取指定 sessionId 的对话历史文本
 * Claude Code 将对话记录在 ~/.claude/projects/<project>/<sessionId>.jsonl
 * 每一行是 JSON: {type, message:{role,content}, ...}
 */
function getConversationHistory(sessionId, cwd) {
  try {
    // Claude 将路径转为项目目录名: D:\claude_projects\iphone_control → d--claude-projects-iphone-control
    // 规则：非字母数字全部变横线，小写（不去横线重复，保留 D: 变成 D- 再拼 \ 变成 D-- 的效果）
    const normalized = cwd
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase();
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');

    // 在 projects 目录下精确匹配
    if (!fs.existsSync(projectsDir)) return '';
    const dirs = fs.readdirSync(projectsDir);
    const projectDir = dirs.find(d => d.toLowerCase() === normalized.toLowerCase());
    if (!projectDir) return '';

    const jsonlPath = path.join(projectsDir, projectDir, sessionId + '.jsonl');
    if (!fs.existsSync(jsonlPath)) return '';

    // 读取最后 200 行（足够覆盖最近几次对话）
    const raw = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = raw.trim().split('\n').slice(-200);

    const result = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' && entry.message) {
          result.push('❯ ' + entry.message.content);
        } else if (entry.type === 'assistant' && entry.message) {
          let content = '';
          const raw = entry.message.content;
          if (typeof raw === 'string') {
            content = raw;
          } else if (Array.isArray(raw)) {
            content = raw.map(c => {
              if (typeof c === 'string') return c;
              // Claude 消息块: {type:'text', text:'...'} 或 {type:'thinking', thinking:'...'} 或 {type:'tool_result', content:'...'}
              return c.text || c.thinking || c.content || '';
            }).filter(Boolean).join('\n');
          } else if (raw && typeof raw === 'object') {
            content = raw.text || raw.thinking || raw.content || '';
          }
          if (content.trim()) {
            // 截断很长的回答
            const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content;
            result.push(truncated);
          }
        }
      } catch {}
    }
    return result.join('\n\n');
  } catch {
    return '';
  }
}

module.exports = {
  SESSIONS_DIR,
  SCAN_INTERVAL,
  getClaudeSessions,
  isPidRunning,
  scanExternalSessions,
  formatRunningTime,
  getConversationHistory,
};

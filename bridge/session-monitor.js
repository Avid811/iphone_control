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
 * 返回格式: [{ pid, sessionId, cwd, status, startedAt, version, name }]
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
    // Windows: tasklist /FI "PID eq <pid>" 会返回匹配行
    const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // 如果进程存在，输出中包含进程名
    return result.includes(`${pid}`);
  } catch {
    return false;
  }
}

/**
 * 获取 bridge 自身管理的 PID 列表
 * @param {Map} bridgeSessions - bridge 的 sessions Map
 */
function getBridgeManagedPids(bridgeSessions) {
  const pids = new Set();
  for (const [, session] of bridgeSessions) {
    if (session.pty && session.pty.pid) {
      pids.add(session.pty.pid);
    }
  }
  return pids;
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

  return allSessions
    .filter(s => {
      // 排除 bridge 自己管理的进程
      if (bridgePids.has(s.pid)) return false;

      // 排除过期太久的（可能是残留文件）
      const ageMs = now - s.updatedAt;
      if (ageMs > STALE_TIMEOUT) return false;

      // 必须真实在运行
      return isPidRunning(s.pid);
    })
    .map(s => ({
      ...s,
      runningTime: now - s.startedAt,  // 运行时长（毫秒）
      isExternal: true,
    }));
}

/**
 * 格式化运行时长
 */
function formatRunningTime(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}秒`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}分钟`;
  return `${Math.floor(ms / 3600000)}小时${Math.floor((ms % 3600000) / 60000)}分钟`;
}

module.exports = {
  SESSIONS_DIR,
  SCAN_INTERVAL,
  getClaudeSessions,
  isPidRunning,
  scanExternalSessions,
  formatRunningTime,
};

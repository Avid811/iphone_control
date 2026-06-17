const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pty = require('node-pty');
const express = require('express');
const { WebSocketServer } = require('ws');
const { scanExternalSessions, formatRunningTime, SCAN_INTERVAL } = require('./session-monitor');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const BIND_ADDR = '0.0.0.0';
const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const app = express();
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), sessions: sessions.size }));
app.get('/api/external-sessions', (req, res) => {
  const external = scanExternalSessions(sessions);
  res.json({ sessions: external.map(s => ({
    ...s,
    runningTimeFormatted: formatRunningTime(s.runningTime),
  }))});
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const sessions = new Map();

// ---- ANSI strip (keep bare CR for overwrite handling) ----
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;:?!.<>]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[0-9;:?!.<>]*~/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')
    .replace(/\r\n/g, '\n');   // CRLF → LF only. Keep bare CR for overwrite handling
}

// ---- Permission detection ----
const PERM_PATTERNS = [
  /Do you want to (allow|proceed|continue|run|execute|make)/i,
  /(Allow|Proceed)\?\s*\[?\s*[yY]/i,
  /是否(允许|继续|执行)/,
  /\[y\/n\]/i, /\(y\/n\)/i,
  /Press\s+[yY]\s+to/i,
  /Permission.*required/i,
  /\b[1-3]\.\s+(Yes|No|Allow)/i,
  /\bYes,?\s+allow\s+all/i,
  /shift\+tab/i,
];
function detectPermission(text) {
  return PERM_PATTERNS.some(p => p.test(text));
}

// ---- Bark notification ----
const BARK_KEY = 'KmoqoxbnTRzWPoLztRoUtj';
const BARK_BASE = `https://api.day.app/${BARK_KEY}`;

function sendBarkNotification(title, body, level, sound) {
  const encodedTitle = encodeURIComponent(title);
  const encodedBody = encodeURIComponent(body);
  const url = `${BARK_BASE}/${encodedTitle}/${encodedBody}?sound=${sound}&level=${level}&group=Claude`;
  require('https').get(url, (res) => { res.resume(); }).on('error', () => {});
}

// ---- Spawn Claude in PTY ----
function spawnClaude(sessionId, cwd) {
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const args = process.platform === 'win32'
    ? ['/c', 'claude --bare']
    : ['-c', 'claude --bare'];

  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color', cols: 120, rows: 35,
    cwd: cwd || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  return proc;
}

// ---- Line classifiers ----

// Claude Code thinking status indicators (the constantly-overwritten line)
function isThinkingStatusLine(t) {
  if (/Pollinating/i.test(t) && t.length < 120) return true;
  if (/Thought for \d+s/i.test(t) && t.length < 80) return true;
  if (/ctrl\+o\s+to\s+expand/i.test(t)) return true;
  if (/^\s*(✽|✢|✻|\*|·)\s*(Pollinating|Baking|Thinking)/i.test(t) && t.length < 80) return true;
  return false;
}

// Lines that should never appear on screen
function isCompletelyUseless(t) {
  if (/^(Claude Code v|Tips for|Welcome back|What.s new|Run \/init)/i.test(t)) return true;
  if (/ctrl\+o\s+to\s+expand/i.test(t)) return true;
  if (/^\s*$/.test(t)) return true;
  if (t === '❯' || t === '>' || t === '❯ ' || t === '') return true;
  return false;
}

// Extract a short status label from a line
function extractStatusLabel(t) {
  if (/Pollinating/i.test(t)) {
    const m = t.match(/(\d+)s/);
    const secs = m ? m[1] : '?';
    return `思考中... (${secs}s)`;
  }
  if (/Baking|Baked/i.test(t)) return '处理中...';
  if (/Generating/i.test(t)) return '生成中...';
  if (/Searching/i.test(t)) return '搜索中...';
  if (/Reading/i.test(t)) return '读取中...';
  if (/Writing/i.test(t)) return '写入中...';
  if (/Running|Executing/i.test(t)) return '执行中...';
  if (/tool/i.test(t)) return '调用工具中...';
  if (/token/i.test(t)) return '生成中...';
  if (/Thinking/i.test(t)) return '思考中...';
  return '处理中...';
}

// ---- Create session ----
function createSession(cwd) {
  const id = crypto.randomUUID();
  const ptyProc = spawnClaude(id, cwd);

  const session = {
    id, pty: ptyProc, ws: null,
    cwd: cwd || process.cwd(),
    createdAt: new Date().toISOString(),
    state: 'idle',
    cleanBuf: '',              // accumulates stripped data until we can split on \n
    thinkingAccum: '',         // thinking content (collapsible)
    answerAccum: '',           // answer content (visible, highlighted)
    inAnswer: false,           // true once we've seen ● marker
    permDetected: false, permAnswered: false,
    flushTimer: null, idleTimer: null,
    _initialIdleSent: false,
  };
  sessions.set(id, session);

  ptyProc.onData((data) => {
    const clean = stripAnsi(data);
    if (!clean) return;

    session.cleanBuf += clean;

    // ---- Permission detection (check raw buffer before line processing) ----
    if (!session.permDetected && detectPermission(session.cleanBuf)) {
      session.permDetected = true;
      session.state = 'awaiting_permission';
      const permText = session.cleanBuf.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(-400);
      sendToSession(id, { type: 'need_permission', text: permText });

      const title = 'Claude 需要确认';
      const summary = permText.slice(0, 200);
      sendBarkNotification(title, summary, 'timeSensitive', 'alarm');

      session.cleanBuf = '';
      session.thinkingAccum = '';
      session.answerAccum = '';
      return;
    }

    // ---- Split on \n to get complete logical lines ----
    const parts = session.cleanBuf.split('\n');
    session.cleanBuf = parts.pop() || '';  // keep incomplete last part

    for (const part of parts) {
      // ---- Handle \r overwrites: keep only the LAST segment ----
      // PTY uses \r to overwrite the same line (status indicators)
      const segments = part.split('\r');
      let line = '';
      // Find the last non-empty segment (the final state of this line)
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i].trim();
        if (s) { line = s; break; }
      }
      if (!line) continue;
      if (isCompletelyUseless(line)) continue;
      if (/^[─-╿▀-▟]{2,}/.test(line)) continue;
      if (/^[·•∙…\*\.\s]+$/.test(line)) continue;

      // ---- Classify the line ----
      // 1. Thinking status (Pollinating…) → update status bar, don't accumulate
      if (isThinkingStatusLine(line)) {
        const label = extractStatusLabel(line);
        sendToSession(id, { type: 'output_status', text: label });
        continue;
      }

      // 2. Answer marker ● → flush thinking, start answer
      if (/^●\s?/.test(line)) {
        // Flush any pending thinking first
        flushThinking(session);
        session.inAnswer = true;
        // Remove the ● prefix and accumulate
        const answerText = line.replace(/^●\s?/, '');
        if (answerText) {
          session.answerAccum += answerText + '\n';
        }
        continue;
      }

      // 3. New user prompt ❯ → flush everything, start fresh
      if (/^❯\s/.test(line)) {
        flushThinking(session);
        flushAnswer(session);
        session.inAnswer = false;
        // Echo the user prompt as visible content
        session.answerAccum = '❯ ' + line.replace(/^❯\s?/, '') + '\n';
        flushAnswer(session);
        continue;
      }

      // 4. Route: answer or thinking
      if (session.inAnswer) {
        session.answerAccum += line + '\n';
      } else {
        session.thinkingAccum += line + '\n';
      }
    }

    // ---- Schedule flush ----
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = setTimeout(() => {
      flushThinking(session);
      flushAnswer(session);
    }, 200);

    // ---- Idle detection: reset timer on every data event ----
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      // Flush any remaining content
      flushThinking(session);
      flushAnswer(session);
      // Transition to idle if still processing
      if (session.state === 'processing') {
        session.state = 'idle';
        session.inAnswer = false;
        sendToSession(id, { type: 'output_status', text: '' });
        sendToSession(id, { type: 'ready_for_input' });
      }
    }, 1500);

    // ---- Initial idle notification ----
    if (!session._initialIdleSent && session.state === 'idle') {
      session._initialIdleSent = true;
      sendToSession(id, { type: 'status', state: 'idle', sessionId: id });
    }
  });

  ptyProc.onExit(({ exitCode }) => {
    flushThinking(session);
    flushAnswer(session);
    session.state = 'done';
    sendToSession(id, { type: 'session_ended', code: exitCode });
  });

  return session;
}

// ---- Flush helpers ----
function flushThinking(session) {
  const text = session.thinkingAccum.trim();
  if (text) {
    // Clean up: collapse 3+ newlines, remove pure-decoration lines
    const cleaned = text
      .split('\n')
      .filter(l => l.trim() && !/^[─-╿▀-▟]{2,}/.test(l.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (cleaned) {
      sendToSession(session.id, { type: 'thinking_block', text: cleaned });
    }
    session.thinkingAccum = '';
  }
}

function flushAnswer(session) {
  const text = session.answerAccum.trim();
  if (text) {
    const cleaned = text
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (cleaned) {
      sendToSession(session.id, { type: 'answer_block', text: cleaned });
    }
    session.answerAccum = '';
  }
}

// ---- Send to WebSocket ----
function sendToSession(id, data) {
  const s = sessions.get(id);
  if (s?.ws?.readyState === 1) {
    try { s.ws.send(JSON.stringify(data)); } catch {}
  }
}

function writeToPTY(id, text) {
  const s = sessions.get(id);
  if (s?.pty) {
    try { s.pty.write(text); return true; } catch { return false; }
  }
  return false;
}

// ---- WebSocket ----
wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let sessionId = url.searchParams.get('session');

  if (sessionId && sessions.has(sessionId)) {
    sessions.get(sessionId).ws = ws;
    sendToSession(sessionId, { type: 'status', state: sessions.get(sessionId).state, sessionId });
  } else {
    const s = createSession(url.searchParams.get('cwd') || process.cwd());
    s.ws = ws;
    sessionId = s.id;
    setTimeout(() => sendToSession(sessionId, { type: 'status', state: 'idle', sessionId }), 1500);
  }

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    const s = sessions.get(sessionId);
    if (!s) return;

    switch (data.type) {
      case 'message':
        if (!data.text?.trim()) break;
        // Reset all state for new message
        flushThinking(s);
        flushAnswer(s);
        s.state = 'processing';
        s.inAnswer = false;
        s.thinkingAccum = '';
        s.answerAccum = '';
        s.permDetected = false;
        s.permAnswered = false;
        if (s.flushTimer) clearTimeout(s.flushTimer);
        if (s.idleTimer) clearTimeout(s.idleTimer);
        writeToPTY(sessionId, data.text + '\r\n');
        sendToSession(sessionId, { type: 'status', state: 'processing' });
        break;

      case 'permission_allow':
        s.permDetected = false;
        s.permAnswered = true;
        s.state = 'processing';
        writeToPTY(sessionId, 'y\r\n');
        sendToSession(sessionId, { type: 'status', state: 'processing' });
        break;

      case 'permission_deny':
        s.permDetected = false;
        s.permAnswered = true;
        s.state = 'processing';
        writeToPTY(sessionId, 'n\r\n');
        sendToSession(sessionId, { type: 'status', state: 'processing' });
        break;

      case 'cancel':
        writeToPTY(sessionId, '\x03');
        s.state = 'idle';
        s.inAnswer = false;
        sendToSession(sessionId, { type: 'status', state: 'idle' });
        sendToSession(sessionId, { type: 'ready_for_input' });
        break;

      case 'inject_permission':
        // 向外部 Claude 进程注入按键（如 y/n/自定义文本）
        if (!data.pid || !data.text) break;
        injectKeystroke(data.pid, data.text, (err, result) => {
          sendToSession(sessionId, {
            type: 'inject_result',
            pid: data.pid,
            text: data.text,
            success: !err,
            message: err ? err.message : result,
          });
        });
        break;

      case 'take_over_session':
        // 接管外部 Claude 会话：在 bridge 中恢复该会话
        if (!data.externalSessionId) break;
        takeOverSession(sessionId, data.externalSessionId);
        break;
    }
  });

  ws.on('close', () => { const s = sessions.get(sessionId); if (s) s.ws = null; });
});

// ---- External Session Injection ----

/**
 * 向外部进程注入按键输入
 * 优先使用 inject-keystroke.exe（C 编译版本），
 * 如果不可用则回退到 PowerShell 脚本。
 */
function injectKeystroke(pid, text, callback) {
  const exePath = path.join(__dirname, 'inject-keystroke.exe');
  const ps1Path = path.join(__dirname, 'inject-keystroke.ps1');

  // 检查是否有编译好的 C 版本
  if (fs.existsSync(exePath)) {
    execFile(exePath, [String(pid), text], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        callback(err, stderr || stdout);
      } else {
        callback(null, stdout.trim());
      }
    });
  } else if (fs.existsSync(ps1Path)) {
    // 回退到 PowerShell
    const psCmd = `powershell.exe -ExecutionPolicy Bypass -File "${ps1Path}" -Pid ${pid} -Text "${text.replace(/"/g, '\\"')}"`;
    execFile('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', ps1Path,
      '-Pid', String(pid),
      '-Text', text,
    ], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        callback(err, stderr || stdout);
      } else {
        callback(null, stdout.trim());
      }
    });
  } else {
    callback(new Error('No inject tool available (neither .exe nor .ps1 found)'), null);
  }
}

/**
 * 接管外部会话：在 bridge 内用 --resume 恢复该 session
 */
function takeOverSession(bridgeSessionId, externalSessionId) {
  const bridgeSession = sessions.get(bridgeSessionId);
  if (!bridgeSession) return;

  // 先干掉旧的 PTY（如果有）
  if (bridgeSession.pty) {
    try { bridgeSession.pty.kill(); } catch {}
  }

  // 用 claude --resume 创建新 PTY
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const args = process.platform === 'win32'
    ? ['/c', `claude --resume ${externalSessionId} --bare`]
    : ['-c', `claude --resume ${externalSessionId} --bare`];

  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color', cols: 120, rows: 35,
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  bridgeSession.pty = proc;
  bridgeSession.state = 'processing';
  bridgeSession.inAnswer = false;
  bridgeSession.permDetected = false;
  bridgeSession.permAnswered = false;
  bridgeSession.cleanBuf = '';
  bridgeSession.thinkingAccum = '';
  bridgeSession.answerAccum = '';

  // 重新绑定 PTY 数据事件（复用 createSession 中的逻辑）
  proc.onData((data) => {
    const clean = stripAnsi(data);
    if (!clean) return;
    bridgeSession.cleanBuf += clean;

    if (!bridgeSession.permDetected && detectPermission(bridgeSession.cleanBuf)) {
      bridgeSession.permDetected = true;
      bridgeSession.state = 'awaiting_permission';
      const permText = bridgeSession.cleanBuf.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(-400);
      sendToSession(bridgeSessionId, { type: 'need_permission', text: permText });
      const title = 'Claude 需要确认';
      const summary = permText.slice(0, 200);
      sendBarkNotification(title, summary, 'timeSensitive', 'alarm');
      bridgeSession.cleanBuf = '';
      bridgeSession.thinkingAccum = '';
      bridgeSession.answerAccum = '';
      return;
    }

    const parts = bridgeSession.cleanBuf.split('\n');
    bridgeSession.cleanBuf = parts.pop() || '';

    for (const part of parts) {
      const segments = part.split('\r');
      let line = '';
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i].trim();
        if (s) { line = s; break; }
      }
      if (!line) continue;
      if (isCompletelyUseless(line)) continue;
      if (/^[─-╿▀-▟]{2,}/.test(line)) continue;
      if (/^[·$\$$\[\]+\s]+$/.test(line)) continue;

      if (isThinkingStatusLine(line)) {
        const label = extractStatusLabel(line);
        sendToSession(bridgeSessionId, { type: 'output_status', text: label });
        continue;
      }

      if (/^●\s?/.test(line)) {
        flushThinking(bridgeSession);
        bridgeSession.inAnswer = true;
        const answerText = line.replace(/^●\s?/, '');
        if (answerText) {
          bridgeSession.answerAccum += answerText + '\n';
        }
        continue;
      }

      if (/^❯\s/.test(line)) {
        flushThinking(bridgeSession);
        flushAnswer(bridgeSession);
        bridgeSession.inAnswer = false;
        bridgeSession.answerAccum = '❯ ' + line.replace(/^❯\s?/, '') + '\n';
        flushAnswer(bridgeSession);
        continue;
      }

      if (bridgeSession.inAnswer) {
        bridgeSession.answerAccum += line + '\n';
      } else {
        bridgeSession.thinkingAccum += line + '\n';
      }
    }

    if (bridgeSession.flushTimer) clearTimeout(bridgeSession.flushTimer);
    bridgeSession.flushTimer = setTimeout(() => {
      flushThinking(bridgeSession);
      flushAnswer(bridgeSession);
    }, 200);

    if (bridgeSession.idleTimer) clearTimeout(bridgeSession.idleTimer);
    bridgeSession.idleTimer = setTimeout(() => {
      flushThinking(bridgeSession);
      flushAnswer(bridgeSession);
      if (bridgeSession.state === 'processing') {
        bridgeSession.state = 'idle';
        bridgeSession.inAnswer = false;
        sendToSession(bridgeSessionId, { type: 'output_status', text: '' });
        sendToSession(bridgeSessionId, { type: 'ready_for_input' });
      }
    }, 1500);
  });

  proc.onExit(({ exitCode }) => {
    flushThinking(bridgeSession);
    flushAnswer(bridgeSession);
    bridgeSession.state = 'done';
    sendToSession(bridgeSessionId, { type: 'session_ended', code: exitCode });
  });

  sendToSession(bridgeSessionId, {
    type: 'take_over_result',
    sessionId: externalSessionId,
    success: true,
    message: `已接管会话 ${externalSessionId.slice(0, 8)}...`,
  });
}

// ---- External Session Scanner ----

/**
 * 定期扫描外部 Claude 会话并推送给所有连接的客户端
 */
function broadcastExternalSessions() {
  const external = scanExternalSessions(sessions);
  const payload = {
    type: 'external_sessions_update',
    sessions: external.map(s => ({
      pid: s.pid,
      sessionId: s.sessionId,
      cwd: s.cwd,
      status: s.status,
      runningTime: s.runningTime,
      runningTimeFormatted: formatRunningTime(s.runningTime),
      version: s.version,
      name: s.name,
    })),
  };

  for (const [, s] of sessions) {
    if (s.ws && s.ws.readyState === 1) {
      try { s.ws.send(JSON.stringify(payload)); } catch {}
    }
  }
}

const externalScanTimer = setInterval(broadcastExternalSessions, SCAN_INTERVAL);

// ---- Cleanup ----
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (!s.ws && now - new Date(s.createdAt).getTime() > 30 * 60 * 1000) {
      try { s.pty.kill(); } catch {}
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

process.on('SIGINT', () => {
  clearInterval(externalScanTimer);
  for (const [, s] of sessions) try { s.pty.kill(); } catch {}
  server.close(() => process.exit(0));
});

server.listen(PORT, BIND_ADDR, () => {
  console.log('');
  console.log(`  Claude Bridge  http://localhost:${PORT}`);
  console.log(`  Tailscale      http://100.105.91.55:${PORT}`);
  console.log('');
});

/**
 * 端到端测试脚本 — 验证 iPhone 控制桥接服务器的所有关键功能
 */
const http = require('http');
const WebSocket = require('ws');

const BASE = 'http://localhost:3000';
let passed = 0, failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function connectWS(sessionId) {
  return new Promise((resolve, reject) => {
    let url = `ws://localhost:3000/ws`;
    if (sessionId) url += `?session=${sessionId}`;
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 5000);
  });
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  iPhone Bridge 端到端测试');
  console.log('═══════════════════════════════════════════\n');

  // ──── Test 1: Health Check ────
  console.log('── Test 1: Health Check ──');
  try {
    const health = await fetchJSON(`${BASE}/health`);
    check('GET /health returns status ok', health.status === 'ok', JSON.stringify(health));
    check('Has uptime', typeof health.uptime === 'number');
    check('Has sessions count', typeof health.sessions === 'number');
  } catch (e) {
    check('Health endpoint accessible', false, e.message);
  }

  // ──── Test 2: External Sessions API ────
  console.log('\n── Test 2: External Sessions API ──');
  try {
    const ext = await fetchJSON(`${BASE}/api/external-sessions`);
    check('GET /api/external-sessions returns sessions array', Array.isArray(ext.sessions), `Got ${ext.sessions?.length} sessions`);

    if (ext.sessions && ext.sessions.length > 0) {
      console.log(`  ℹ 找到 ${ext.sessions.length} 个外部会话:`);
      ext.sessions.forEach((s, i) => {
        const project = s.name || s.cwd?.split('\\').pop() || '?';
        const flags = [];
        if (s.likelyWaitingPermission) flags.push('⚠ 等待权限');
        if (s.status === 'busy') flags.push('busy');
        console.log(`    ${i+1}. PID ${s.pid} | ${project} | ${s.status} | ${s.runningTimeFormatted}${flags.length ? ' [' + flags.join(', ') + ']' : ''}`);
      });

      // 验证字段完整性
      const s = ext.sessions[0];
      check('Session has pid', typeof s.pid === 'number');
      check('Session has sessionId', typeof s.sessionId === 'string');
      check('Session has status', typeof s.status === 'string');
      check('Session has likelyWaitingPermission', typeof s.likelyWaitingPermission === 'boolean');
      check('Session has stuckDuration', typeof s.stuckDuration === 'number');
      check('Session has runningTimeFormatted', typeof s.runningTimeFormatted === 'string');

      // 验证去重：同一 sessionId 不应出现多次
      const ids = ext.sessions.map(s => s.sessionId);
      const uniqueIds = new Set(ids);
      check('No duplicate sessionIds', ids.length === uniqueIds.size, `${ids.length} sessions, ${uniqueIds.size} unique`);

      // 验证排序：likelyWaitingPermission 的应该排在最前
      const firstPerm = ext.sessions.findIndex(s => s.likelyWaitingPermission);
      const firstNonPerm = ext.sessions.findIndex(s => !s.likelyWaitingPermission);
      if (firstPerm >= 0 && firstNonPerm >= 0) {
        check('Sessions awaiting permission are sorted first', firstPerm < firstNonPerm);
      }
    } else {
      console.log('  ℹ 无外部会话（可能没有在 bridge 外运行的 Claude 实例）');
      check('API returns valid empty array', ext.sessions !== undefined);
    }
  } catch (e) {
    check('External sessions API accessible', false, e.message);
  }

  // ──── Test 3: WebSocket Connection ────
  console.log('\n── Test 3: WebSocket Connection ──');
  let ws;
  try {
    ws = await connectWS(null);
    check('WebSocket connection established', ws.readyState === WebSocket.OPEN);

    // Wait for initial status message
    const statusMsg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No status message within 5s')), 5000);
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'status') {
            clearTimeout(timer);
            resolve(msg);
          }
        } catch {}
      });
    });
    check('Received initial status message', statusMsg.type === 'status', `sessionId=${statusMsg.sessionId?.slice(0, 8)}... state=${statusMsg.state}`);

    // Wait for external_sessions_update
    const extMsg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No external_sessions_update within 10s')), 10000);
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'external_sessions_update') {
            clearTimeout(timer);
            resolve(msg);
          }
        } catch {}
      });
    });
    check('Received external_sessions_update via WS', Array.isArray(extMsg.sessions), `${extMsg.sessions?.length} sessions`);
    check('WS sessions include likelyWaitingPermission', extMsg.sessions?.every(s => typeof s.likelyWaitingPermission === 'boolean'));

  } catch (e) {
    check('WebSocket tests', false, e.message);
  }

  // ──── Test 4: Inject Permission via WS ────
  console.log('\n── Test 4: Inject Permission Test ──');
  try {
    // First get a real external session PID
    const ext = await fetchJSON(`${BASE}/api/external-sessions`);
    const targetSession = ext.sessions?.find(s => s.status === 'idle');

    if (targetSession && ws && ws.readyState === WebSocket.OPEN) {
      console.log(`  ℹ 测试注入到 PID ${targetSession.pid} (${targetSession.status})`);

      ws.send(JSON.stringify({
        type: 'inject_permission',
        pid: targetSession.pid,
        text: ' ',
      }));

      const injectResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No inject_result within 15s')), 15000);
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'inject_result') {
              clearTimeout(timer);
              resolve(msg);
            }
          } catch {}
        });
      });

      console.log(`  ℹ 注入结果: success=${injectResult.success} message="${injectResult.message}"`);
      check('Injection completed (success or clean error)',
        typeof injectResult.success === 'boolean',
        injectResult.message);
    } else if (!targetSession) {
      console.log('  ⚠ 跳过：无外部会话可测试注入');
    } else {
      console.log('  ⚠ 跳过：WebSocket 不可用');
    }
  } catch (e) {
    check('Inject permission test', false, e.message);
  }

  // ──── Test 5: Session Monitor Logic ────
  console.log('\n── Test 5: Session Monitor Logic ──');
  try {
    const { scanExternalSessions, formatRunningTime } = require('./session-monitor.js');
    const sessions = new Map(); // empty — all sessions are "external"

    const result = scanExternalSessions(sessions);
    console.log(`  ℹ scanExternalSessions 返回 ${result.length} 个会话`);

    // Verify dedup
    const ids = result.map(s => s.sessionId);
    check('Monitor deduplicates sessions', new Set(ids).size === ids.length);

    // Verify filtering
    const allHaveFields = result.every(s =>
      typeof s.pid === 'number' &&
      typeof s.sessionId === 'string' &&
      typeof s.likelyWaitingPermission === 'boolean' &&
      typeof s.stuckDuration === 'number'
    );
    check('All sessions have required fields', allHaveFields);

    // Verify stuck threshold logic
    const waitingSessions = result.filter(s => s.likelyWaitingPermission);
    const busySessions = result.filter(s => s.status === 'busy');
    console.log(`  ℹ busy=${busySessions.length}, likelyWaiting=${waitingSessions.length}`);
    if (waitingSessions.length > 0) {
      waitingSessions.forEach(s => {
        check(`Waiting session stuck > 15s (${Math.round(s.stuckDuration/1000)}s)`,
          s.stuckDuration > 15000);
      });
    }

    // formatRunningTime
    check('formatRunningTime(0) → "0秒"', formatRunningTime(0) === '0秒', formatRunningTime(0));
    check('formatRunningTime(30000) → "30秒"', formatRunningTime(30000) === '30秒', formatRunningTime(30000));
    check('formatRunningTime(120000) → "2分钟"', formatRunningTime(120000) === '2分钟', formatRunningTime(120000));

  } catch (e) {
    check('Session monitor tests', false, e.message);
  }

  // ──── Test 6: PowerShell Script Syntax ────
  console.log('\n── Test 6: inject-keystroke.ps1 Validation ──');
  try {
    const { execFileSync } = require('child_process');
    const path = require('path');
    const ps1Path = path.join(__dirname, 'inject-keystroke.ps1');

    // Syntax check
    const syntaxResult = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-Command '${ps1Path}' -ErrorAction Stop; Write-Host 'SYNTAX_OK'`
    ], { encoding: 'utf-8', timeout: 15000 });
    check('PowerShell script syntax valid', syntaxResult.includes('SYNTAX_OK') || syntaxResult.includes('inject-keystroke'));

    // Parameter check — verify script uses -TargetPid (NOT the reserved $Pid)
    const fs = require('fs');
    const scriptContent = fs.readFileSync(ps1Path, 'utf-8');
    const hasTargetPid = scriptContent.includes('$TargetPid');
    // Check for standalone $Pid (not part of $TargetPid)
    const standalonePid = /[^a-zA-Z]\$Pid\b/.test(scriptContent) || /^\$Pid\b/.test(scriptContent);
    const hasKeybdEvent = scriptContent.includes('keybd_event');
    const hasOwnerWindow = scriptContent.includes('GW_OWNER');
    const hasUInt32 = scriptContent.includes('[UInt32]');

    check('Script uses -TargetPid parameter', hasTargetPid);
    check('Script does NOT use standalone $Pid', !standalonePid, standalonePid ? 'Found $Pid in script' : '');
    check('Script has keybd_event fallback', hasKeybdEvent);
    check('Script has Owner window detection', hasOwnerWindow);
    check('Script uses UInt32 not uint', hasUInt32);
    console.log('  ℹ Script verification: TargetPid=' + hasTargetPid + ' noStandalonePid=' + !standalonePid + ' keybd_event=' + hasKeybdEvent + ' GW_OWNER=' + hasOwnerWindow + ' UInt32=' + hasUInt32);

    // Actual injection test with non-existent PID (should fail cleanly)
    try {
      execFileSync('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-File', ps1Path,
        '-TargetPid', '99999',
        '-Text', 'test',
      ], { encoding: 'utf-8', timeout: 15000 });
      check('Injection to fake PID (unexpectedly succeeded)', false, 'Expected failure for non-existent PID');
    } catch (e) {
      const output = (e.stdout || '') + (e.stderr || '') + e.message;
      const cleanError = !output.includes('VariableNotWritable') && !output.includes('找不到类型');
      check('Injection to fake PID gives clean error (no VariableNotWritable/type errors)',
        cleanError,
        output.trim().slice(0, 150));
    }

  } catch (e) {
    check('PowerShell script tests', false, e.message?.slice(0, 150));
  }

  // ──── Summary ────
  console.log('\n═══════════════════════════════════════════');
  console.log(`  测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('═══════════════════════════════════════════');

  if (ws) ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});

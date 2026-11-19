// Unit tests: node test.js → ok
'use strict'
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process')
const core = require('./core'), Team = require('./team'), garden = require('./garden'), common = require('./common')
const { slotKey, command, makeParser, usageOf, relayPlan } = core
const eq = assert.deepStrictEqual
let A0
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hive-test-')))
const at = s => new Date(s)

// ───────── slotKey ─────────
{
  const daily = { mode: 'daily', time: '09:00' }
  eq(slotKey(daily, at('2026-11-17T08:59')), null)
  eq(slotKey(daily, at('2026-11-17T09:00')), '2026-11-17 09:00')
  eq(slotKey(daily, at('2026-11-17T22:30')), '2026-11-17 09:00')           // later the same day is still the same key (missed runs catch up)
  eq(slotKey({ mode: 'weekdays', time: '09:00' }, at('2026-11-21T10:00')), null)   // Saturday
  eq(slotKey({ mode: 'weekdays', time: '09:00' }, at('2026-11-20T10:00')), '2026-11-20 09:00')
  const weekly = { mode: 'weekly', time: '09:00', days: [3] }
  eq(slotKey(weekly, at('2026-11-17T10:00')), null)                        // Tuesday
  eq(slotKey(weekly, at('2026-11-18T10:00')), '2026-11-18 09:00')          // Wednesday
  const monthly = { mode: 'monthly', time: '09:00', dom: 31 }
  eq(slotKey(monthly, at('2026-11-30T10:00')), '2026-11-30 09:00')         // November has no 31st → last day
  eq(slotKey(monthly, at('2026-12-30T10:00')), null)
  eq(slotKey(monthly, at('2026-12-31T10:00')), '2026-12-31 09:00')
  const iv = { mode: 'interval', every: 30 }
  eq(slotKey(iv, at('2026-11-17T10:01')), slotKey(iv, at('2026-11-17T10:29')))
  assert.notStrictEqual(slotKey(iv, at('2026-11-17T10:29')), slotKey(iv, at('2026-11-17T10:31')))
  const adhoc = { mode: 'adhoc', at: '2026-11-17T15:00' }
  eq(slotKey(adhoc, at('2026-11-17T14:59')), null)
  eq(slotKey(adhoc, at('2026-11-17T15:00')), 'adhoc 2026-11-17T15:00')
  eq(slotKey(adhoc, at('2026-11-19T08:00')), 'adhoc 2026-11-17T15:00')
  eq(slotKey({ mode: 'manual' }, new Date()), null)
}

// ───────── nextRun / whenText agree with slotKey ─────────
{
  const now = at('2026-11-17T10:00')          // Tuesday
  const w = s => common.whenText(common.nextRun(s, now), now)
  eq(w({ mode: 'daily', time: '09:00' }), 'Tomorrow 09:00')
  eq(w({ mode: 'daily', time: '18:00' }), 'Today 18:00')
  eq(w({ mode: 'weekly', time: '09:00', days: [3] }), 'Tomorrow 09:00')
  eq(w({ mode: 'weekly', time: '09:00', days: [5] }), 'Fri 09:00')
  eq(common.whenText(common.nextRun({ mode: 'weekly', time: '09:00', days: [3] }, at('2026-11-19T10:00')), at('2026-11-19T10:00')), 'Wed 09:00')
  eq(w({ mode: 'monthly', time: '09:00', dom: 31 }), '11-30 09:00')
  eq(w({ mode: 'weekdays', time: '09:00' }), 'Tomorrow 09:00')
  eq(common.nextRun({ mode: 'adhoc', at: '2026-11-01T09:00' }, now), null)
  eq(common.nextRun({ mode: 'manual' }, now), null)
  eq(common.nextRun({ mode: 'adhoc', at: '2026-11-17T12:00' }, now).getHours(), 12)
  for (const s of [{ mode: 'daily', time: '09:00' }, { mode: 'weekly', time: '07:30', days: [0, 4] }, { mode: 'monthly', time: '23:10', dom: 30 }, { mode: 'weekdays', time: '12:00' }]) {
    const n = common.nextRun(s, now)
    assert.ok(slotKey(s, n), 'slotKey should fire at the nextRun time')
    eq(slotKey(s, new Date(n.getTime() - 60000)) === slotKey(s, n), false)
  }
  eq(common.nextRun({ mode: 'interval', every: 30 }, now).getTime(), at('2026-11-17T10:30').getTime())
  { // outputs: what a bee wrote, named or linked
    const o = require('./outputs')
    eq([o.kindOf('a/b/Report.PDF'), o.kindOf('x.png'), o.kindOf('main.py'), o.kindOf('noext'), o.canOpen('a.pdf'), o.canOpen('run.sh'), o.canOpen('page.html'), o.canOpen('Tool.app')], ['doc', 'image', 'code', 'code', true, false, false, false])
    eq([o.siteOf('https://docs.google.com/presentation/d/1/edit'), o.siteOf('https://claude.ai/artifact/abc'), o.siteOf('https://github.com/a/b/pull/7'), o.siteOf('https://www.example.com/x')], ['Google Slides', 'Claude artifact', 'Pull request', 'example.com'])
    const got = o.scan([
      { role: 'tool', name: 'Write', input: { file_path: '/w/report.md', content: 'x' }, t: 5 }, { role: 'tool', name: 'Read', input: { file_path: '/w/secret.txt' }, t: 6 }, { role: 'tool', name: 'Edit', input: { file_path: '/w/report.md' }, t: 9 },
      { role: 'assistant', t: 10, text: '画了每日趋势图，保存在 `tmp/sg_daily.png`。PDF 在 `~/out/周报 v2.pdf`，另见 [Q4 deck](https://docs.google.com/presentation/d/1AbC/edit#slide=id.p).\n链接：https://claude.ai/artifact/xyz。 Also (see https://example.com/a_(b)). Not a file: version 1.2.pdfx or http://localhost:3000/x.pdf' },
      { role: 'assistant', t: 12, text: 'Updated tmp/sg_daily.png again and https://claude.ai/artifact/xyz' }, { role: 'assistant', sub: true, t: 13, text: 'sub.pdf' }, { role: 'user', t: 14, text: 'user.pdf https://user.example' }])
    eq(got.filter(x => x.kind === 'file').map(x => [x.path, x.t, x.via]), [['/w/report.md', 9, 'wrote'], ['tmp/sg_daily.png', 12, 'named'], ['~/out/周报 v2.pdf', 10, 'named']])
    eq(got.filter(x => x.kind === 'link').map(x => [x.url, x.site, x.label, x.t]), [['https://docs.google.com/presentation/d/1AbC/edit#slide=id.p', 'Google Slides', 'Q4 deck', 10], ['https://claude.ai/artifact/xyz', 'Claude artifact', '', 12], ['https://example.com/a_(b)', 'example.com', '', 10]])
  }
  { // event triggers
    const ev = require('./events'), bees = [{ id: 'a', name: 'Mochi' }, { id: 'b', name: 'Pip' }]
    eq(ev.parseEvent({ type: 'commit', branch: ' main ', remote: 1 }), { type: 'commit', cooldown: 5, branch: 'main', remote: true }); assert.throws(() => ev.parseEvent({ type: 'commit', branch: '--upload-pack=x' }), /branch name/); assert.throws(() => ev.parseEvent({ type: 'commit', branch: 'a b' }), /branch name/)
    eq(ev.parseEvent({ type: 'github', what: ['ci', 'pr', 'zz'], cooldown: 0 }), { type: 'github', cooldown: 0, what: ['pr', 'ci'] }); assert.throws(() => ev.parseEvent({ type: 'github', what: [] }), /at least one/)
    eq(ev.parseEvent({ type: 'bee', ids: ['a', 'b', 'gone', 'a'], on: 'error', cooldown: 99999 }, bees, 'b'), { type: 'bee', cooldown: 1440, ids: ['a'], on: 'error' }); assert.throws(() => ev.parseEvent({ type: 'bee', ids: ['b'] }, bees, 'b'), /Pick the bee/)
    eq([common.schedText({ mode: 'event', event: { type: 'commit', branch: 'main', remote: true } }), common.eventText({ type: 'github', what: ['pr', 'ci'] }), common.eventText({ type: 'bee', ids: ['a'], on: 'error' }, id => 'Mochi'), common.eventText({ type: 'bee', ids: ['a'], on: 'done' })], ['On commit to main (remote)', 'On GitHub: new PR, CI failure', 'When Mochi fails', 'When a bee finishes'])
    eq(common.nextRun({ mode: 'event', event: {} }), null)
    // GitHub: the first look only takes note; later looks report what is new, once
    const what = ['pr', 'comment', 'ci'], t0 = Date.parse('2026-11-18T10:00:00Z')
    const s1 = { prs: [{ number: 1, title: 'Old', url: 'u1' }], runs: [{ databaseId: 9, status: 'completed', conclusion: 'failure', name: 'test' }], comments: [{ created_at: '2026-11-18T09:00:00Z', body: 'old', user: { login: 'x' } }] }
    const d1 = ev.ghDiff(undefined, s1, what, t0); eq([d1.lines, d1.st.prs, d1.st.runs, d1.st.since], [[], [1], [9], t0])
    const s2 = { prs: [{ number: 1, title: 'Old' }, { number: 2, title: 'Add  export', author: { login: 'eve' }, url: 'u2' }], runs: [{ databaseId: 9, status: 'completed', conclusion: 'failure', name: 'test' }, { databaseId: 10, status: 'completed', conclusion: 'success', name: 'test' }, { databaseId: 11, status: 'completed', conclusion: 'failure', name: 'lint', headBranch: 'main', url: 'r11' }, { databaseId: 12, status: 'in_progress', conclusion: '' }],
      comments: [{ created_at: '2026-11-18T09:00:00Z', body: 'old' }, { created_at: '2026-11-18T10:05:00Z', body: 'please\nfix this', user: { login: 'eve' }, html_url: 'c1' }] }
    const d2 = ev.ghDiff(d1.st, s2, what, t0 + 1); eq(d2.lines, ['New pull request #2: Add export (by eve) u2', 'CI failed: lint on main r11', 'New comment by eve: please fix this c1'])
    eq(ev.ghDiff(d2.st, s2, what, t0 + 2).lines, []); eq(ev.ghDiff(d1.st, s2, ['ci'], t0).lines, ['CI failed: lint on main r11'])
    // another bee finishing
    const w = { id: 'b', schedule: { mode: 'event', event: { type: 'bee', ids: ['a'], on: 'error' } } }
    eq([ev.beeMatch(w, { id: 'a' }, 'error'), ev.beeMatch(w, { id: 'a' }, 'done'), ev.beeMatch(w, { id: 'c' }, 'error'), ev.beeMatch({ ...w, id: 'a' }, { id: 'a' }, 'error'), ev.beeMatch({ id: 'b', schedule: { mode: 'daily' } }, { id: 'a' }, 'error')], [true, false, false, false, false])
    eq(ev.eventPrompt(' Review it ', 'New commits on main:', ['abc fix']), 'Review it\n\n--- What happened ---\nNew commits on main:\nabc fix')
  }
  eq(common.schedText({ mode: 'weekly', time: '09:00', days: [1, 2, 3, 4, 5] }), 'Weekdays 09:00'); eq(common.schedText({ mode: 'weekly', time: '08:30', days: [6, 0] }), 'Weekends 08:30')
  eq(common.schedText({ mode: 'weekly', time: '09:00', days: [0, 1] }), 'Weekly Mo Su 09:00')
}

// ───────── Engine command lines ─────────
{
  const c = (a, ctx) => command({ model: '', permission: 'full', ...a }, 'hi', ctx)
  eq(c({ engine: 'claude' }), { cmd: 'claude', args: ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--disallowedTools', core.HEADLESS_OFF, '--append-system-prompt', core.BEE_SYS, '--dangerously-skip-permissions'] })
  eq(c({ engine: 'claude', permission: 'safe', model: 'haiku', sessionId: 's1' }).args,
    ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--disallowedTools', core.HEADLESS_OFF, '--append-system-prompt', core.BEE_SYS, '--model', 'haiku', '--permission-mode', 'acceptEdits', '--resume', 's1'])
  eq(c({ engine: 'claude', permission: 'ask' }, { mcp: '{"x":1}' }).args,
    ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--disallowedTools', core.HEADLESS_OFF, '--append-system-prompt', core.BEE_SYS, '--permission-mode', 'acceptEdits', '--mcp-config', '{"x":1}', '--permission-prompt-tool', 'mcp__hive__approve'])
  eq(c({ engine: 'claude', permission: 'ask' }).args.includes('--mcp-config'), false)        // omitted without mcp
  eq(c({ engine: 'claude', permission: 'safe' }, { mcp: '{}' }).args.includes('--mcp-config'), false)
  eq(c({ engine: 'codex' }).args, ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 'hi'])
  eq(c({ engine: 'codex', permission: 'safe', model: 'gpt-5.2', sessionId: 't1' }).args, ['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5.2', '-s', 'workspace-write', 'resume', 't1', 'hi'])
  eq(c({ engine: 'gemini' }).args, ['-p', 'hi', '-o', 'stream-json', '--yolo'])
  eq(c({ engine: 'gemini' }).env, { GEMINI_CLI_TRUST_WORKSPACE: 'true' })          // trusted through the environment: versions before 0.39 do not know --skip-trust
  eq(c({ engine: 'claude' }).env, undefined)
  eq(c({ engine: 'antigravity' }), { cmd: 'agy', args: ['-p', 'hi', '--output-format', 'stream-json', '--dangerously-skip-permissions'] })
  eq(c({ engine: 'antigravity', permission: 'safe', model: 'gemini-4-neon-high', sessionId: 'c-1' }).args, ['-p', 'hi', '--output-format', 'stream-json', '--model', 'gemini-4-neon-high', '--mode', 'accept-edits', '--conversation', 'c-1'])
  eq(c({ engine: 'dsh' }), { cmd: 'dsh', args: ['--profile', 'headless', '--json', '--permission-mode', 'danger-full-access', '--approval-policy', 'never', '--', 'hi'] })
  eq(command({ engine: 'dsh', permission: 'safe', model: 'ignored', sessionId: 'session-9' }, '--help').args, ['--profile', 'headless', '--json', '--permission-mode', 'workspace-write', '--approval-policy', 'never', '--session-id', 'session-9', '--', '--help'])
  eq(c({ engine: 'gemini', permission: 'ask', model: 'gemini-2.5-pro', sessionId: 'x' }).args, ['-p', 'hi', '-o', 'stream-json', '-m', 'gemini-2.5-pro', '--approval-mode=auto_edit', '--resume', 'latest'])
  eq(c({ engine: 'cursor-agent' }).args, ['-p', 'hi', '--output-format', 'stream-json', '--trust', '--force'])
  eq([core.binOf(core.ENGINES['cursor-agent'], '/nowhere'), core.binOf(core.ENGINES.claude, '/nowhere')], ['cursor-agent', 'claude'])
  { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-bin-')); fs.writeFileSync(path.join(d, 'agent'), '#!/bin/sh\n', { mode: 0o755 })       // only the new name is installed
    eq(core.binOf(core.ENGINES['cursor-agent'], d), 'agent'); fs.writeFileSync(path.join(d, 'cursor-agent'), '#!/bin/sh\n', { mode: 0o755 }); eq(core.binOf(core.ENGINES['cursor-agent'], d), 'cursor-agent') }
  eq(c({ engine: 'cursor-agent', permission: 'safe', model: 'gpt-5', sessionId: 'c1' }).args, ['-p', 'hi', '--output-format', 'stream-json', '--trust', '--model', 'gpt-5', '--resume', 'c1'])
  eq(c({ engine: 'grok' }), { cmd: 'grok', args: ['-p', 'hi'] })
  eq(c({ engine: 'antigravity', template: 'antigravity chat {prompt}' }).cmd, 'agy')      // a bee saved while Antigravity was a template keeps working
  // templates never go through a shell: the prompt is passed verbatim as one argument
  const evil = 'a b; rm -rf / $(x) `y` "z"'
  eq(command({ engine: 'custom', template: 'node fake.js --say {prompt} --end' }, evil), { cmd: 'node', args: ['fake.js', '--say', evil, '--end'] })
  eq(command({ engine: 'custom', template: 'mycli run' }, evil), { cmd: 'mycli', args: ['run', evil] })
  eq(command({ engine: 'custom', template: 'x --p={prompt}' }, 'q').args, ['--p=q'])
  assert.throws(() => command({ engine: 'custom', template: '  ' }, 'x'))
  assert.throws(() => command({ engine: 'nope' }, 'x'))
  eq([core.validModel(''), core.validModel('claude-opus-4[1m]'), core.validModel('a/b:c'), core.validModel('-x'), core.validModel('a b'), core.validModel('a;b')], [true, true, true, false, false, false])
}

// ───────── Parser ─────────
{
  const parse = lines => { const out = [], sess = [], use = []; const p = makeParser(e => out.push(e), s => sess.push(s), u => use.push(u)); p.feed(lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'); p.end(); return { out, sess, use } }
  // Claude / Cursor
  let r = parse([
    { type: 'system', subtype: 'init', session_id: 'S1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a/b.js' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'file body' }] }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }] } },
    { type: 'weird', foo: 1 },
    'plain text line',
    { type: 'result', is_error: false, result: 'done', total_cost_usd: 0.0123, usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 7 } },
  ])
  eq(r.sess[0], 'S1')
  eq(r.out.map(e => e.role), ['assistant', 'tool', 'tool', 'out', 'out', 'assistant'])
  eq([r.out[1].text, r.out[1].tid, r.out[2].text], ['Bash(ls -la)', 't1', 'Read(/a/b.js)'])
  eq([r.out[3].tid, r.out[3].text, r.out[4].tid, r.out[4].text], ['t2', 'file body', 't1', 'a\nb'])      // parallel calls are paired by tid
  eq(r.out[5].text, 'plain text line')
  eq(r.use, [{ tin: 115, tout: 7, usd: 0.0123 }])
  r = parse([{ type: 'result', is_error: true, result: 'boom' }])
  eq(r.out, [{ role: 'error', text: 'boom' }])
  // Gemini: deltas accumulate
  r = parse([
    { type: 'init', session_id: 'G1' },
    { type: 'message', role: 'user', content: 'hi' },
    { type: 'message', role: 'assistant', delta: true, content: 'Hel' },
    { type: 'message', role: 'assistant', delta: true, content: 'lo' },
    { type: 'tool_use', tool_name: 'read_file', parameters: { path: 'x.txt' }, tool_id: 'g1' },
    { type: 'tool_result', output: 'content', tool_id: 'g1' },
    { type: 'message', role: 'assistant', delta: true, content: 'Done' },
    { type: 'result', stats: { input_tokens: 3, output_tokens: 4 } },
  ])
  eq(r.sess, ['G1'])
  eq(r.out.map(e => [e.role, e.text]), [['assistant', 'Hello'], ['tool', 'read_file(x.txt)'], ['out', 'content'], ['assistant', 'Done']])
  eq(r.use, [{ tin: 3, tout: 4, usd: 0 }])
  // Codex
  r = parse([
    { type: 'thread.started', thread_id: 'T1' },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'npm test', aggregated_output: 'ok' } },
    { type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'a.js' }] } },
    { type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Fixed' } },
    { type: 'turn.completed', usage: { input_tokens: 25, cached_input_tokens: 20, output_tokens: 2 } },      // the cached ones are part of the input
    { type: 'turn.failed', error: { message: 'rate limit' } },
    { type: 'error', message: 'bad' },
  ])
  eq(r.sess, ['T1'])
  eq(r.out.map(e => [e.role, e.text]), [['tool', 'Bash(npm test)'], ['out', 'ok'], ['tool', 'Edit(a.js)'], ['assistant', 'Fixed'], ['error', 'rate limit'], ['error', 'bad']])
  eq(r.use, [{ tin: 25, tout: 2, usd: 0 }])
  // fed in chunks; overlong output is truncated
  const out = []; const p = makeParser(e => out.push(e))
  const big = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'z', content: 'x'.repeat(9000) }] } })
  p.feed(big.slice(0, 50)); p.feed(big.slice(50) + '\n'); p.end()
  eq(out[0].text.length, 4000)
  eq(usageOf({ type: 'assistant' }), null)

  // Antigravity (agy): lines as the CLI printed them
  const C = 'c0ffee'
  r = parse([
    { event: 'init', conversation_id: C, init: { cwd: '/w', tools: ['run_command'], permission_mode: 'request-review' } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 0, state: 'DONE', step_type: 'user_input' } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 1, state: 'DONE', step_type: 'agent_response', usage: { input_tokens: 100, output_tokens: 9, cache_read_tokens: 0 } } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'write_file', tool_info: { name: 'write_file', parameters: { Path: '/w/hello.txt' } } } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'write_file', tool_info: { name: 'write_file', parameters: { Path: '/w/hello.txt' } } } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 3, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'npm test' } } } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 3, state: 'ERROR', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'npm test' }, error: { type: 'TOOL_ERROR', message: 'user denied permission' } } } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'po' } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 4, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'ng' } },
    { event: 'step_update', step_update: { conversation_id: C, step_index: 4, state: 'DONE', step_type: 'agent_response', text_delta: '\n', usage: { input_tokens: 20, output_tokens: 3, cache_read_tokens: 80 } } },
    { event: 'result', result: { conversation_id: C, status: 'SUCCESS', response: 'pong\n', usage: { input_tokens: 5000, output_tokens: 500 } } },
  ])
  eq(r.sess, [C])
  eq(r.out.map(e => [e.role, e.text]), [['tool', 'write_file(/w/hello.txt)'], ['out', ''], ['tool', 'run_command(npm test)'], ['out', 'user denied permission'], ['assistant', 'pong']])
  eq(r.out[0].tid, r.out[1].tid)
  eq(r.use, [{ tin: 100, tout: 9, usd: 0 }, { tin: 100, tout: 3, usd: 0 }])       // per step; the closing total spans earlier rounds too
  r = parse([{ event: 'result', result: { status: 'SUCCESS', response: 'only here' } }, { event: 'result', result: { status: 'FAILED', response: '', error: 'quota' } }])
  eq(r.out.map(e => [e.role, e.text]), [['assistant', 'only here'], ['error', 'quota']])

  // DeepSeek Harness (dsh --json), after its json-stream.ts
  r = parse([
    { type: 'session', sessionId: 'session-1', cwd: '/w' },
    { type: 'status', phase: 'turn_start', turn: 1 },
    { type: 'thinking', text: 'hm' },
    { type: 'text', text: 'Looking' },
    { type: 'tool_call', callId: 'k1', tool: 'bash', input: { command: 'ls' } },
    { type: 'tool_result', callId: 'k1', status: 'completed', result: 'a.js' },
    { type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: 40, outputTokens: 6, cacheReadTokens: 30 } },
    { type: 'text', text: 'One file' },
    { type: 'final', sessionId: 'session-1', reason: { kind: 'completed' }, text: 'One file' },
  ])
  eq(r.sess, ['session-1', 'session-1'])          // named again by the final event
  eq(r.out.map(e => [e.role, e.text, e.tid]), [['assistant', 'Looking', undefined], ['tool', 'bash(ls)', 'k1'], ['out', 'a.js', 'k1'], ['assistant', 'One file', undefined]])
  eq(r.use, [{ tin: 40, tout: 6, usd: 0 }])
  r = parse([{ type: 'session', sessionId: 's2' }, { type: 'final', sessionId: 's2', reason: { kind: 'aborted' }, text: 'half' }, { type: 'error', message: 'unknown option' }])
  eq(r.out.map(e => [e.role, e.text]), [['assistant', 'half'], ['error', 'The run ended early: aborted'], ['error', 'unknown option']])
  // Cursor's tool_call events have no "tool" string and stay out
  // Cursor Agent, after its output-format reference
  r = parse([
    { type: 'system', subtype: 'init', cwd: '/w', session_id: 'cs1', model: 'm', permissionMode: 'default' },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'go' }] }, session_id: 'cs1' },
    { type: 'tool_call', subtype: 'started', call_id: 'r1', tool_call: { readToolCall: { args: { path: 'a.js' } } }, session_id: 'cs1' },
    { type: 'tool_call', subtype: 'completed', call_id: 'r1', tool_call: { readToolCall: { args: { path: 'a.js' }, result: { success: { content: 'let x', totalLines: 1 } } } }, session_id: 'cs1' },
    { type: 'tool_call', subtype: 'completed', call_id: 'w1', tool_call: { writeToolCall: { args: { path: 'b.js', fileText: 'y' }, result: { success: { path: '/w/b.js', linesCreated: 1 } } } }, session_id: 'cs1' },
    { type: 'tool_call', subtype: 'started', call_id: 'f1', tool_call: { function: { name: 'grep', arguments: '{"pattern":"TODO"}' } }, session_id: 'cs1' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] }, session_id: 'cs1' },
    { type: 'result', subtype: 'success', is_error: false, result: 'Done', session_id: 'cs1' },
  ])
  eq(r.out.map(e => [e.role, e.text, e.tid]), [['tool', 'Read(a.js)', 'r1'], ['out', 'let x', 'r1'], ['tool', 'Write(b.js)', 'w1'], ['out', '/w/b.js', 'w1'], ['tool', 'grep(TODO)', 'f1'], ['assistant', 'Done', undefined]])
  eq([...new Set(r.sess)], ['cs1'])
  // plain-text CLIs: consecutive lines become one entry
  r = parse(['First line', '', '| a | b |', '|---|---|', { type: 'error', message: 'x' }, 'After'])
  eq(r.out.map(e => [e.role, e.text]), [['assistant', 'First line\n\n| a | b |\n|---|---|'], ['error', 'x'], ['assistant', 'After']])
}

// ───────── team ─────────
const A = { id: 'A', name: 'Writer', status: 'idle' }
const B = { id: 'B', name: 'Reviewer', status: 'idle', after: { ids: ['A'], prompt: core.PRESETS.review.prompt, loop: true } }
const C = { id: 'C', name: 'Tester', status: 'idle', after: { ids: ['B'], prompt: core.PRESETS.test.prompt } }
const X = { id: 'X', name: 'Loner', status: 'idle' }
{
  const chain = [X, C, B, A]
  eq(Team.teamOf(chain, 'B').map(a => a.id), ['A', 'B', 'C'])
  eq(Team.teamOf(chain, 'X').map(a => a.id), ['X'])
  eq(Team.layersOf(chain, 'C').map(l => l.map(a => a.id)), [['A'], ['B'], ['C']])
  eq([Team.isParallel(chain, 'B'), Team.isLead(chain, A), Team.isLead(chain, B), Team.isLead(chain, X)], [false, true, false, false])
  const dag = [{ id: 'a' }, { id: 'b', after: { ids: ['a'] } }, { id: 'c', after: { id: 'a' } }, { id: 'd', after: { ids: ['b', 'c'] } }]   // c uses legacy after.id
  eq(Team.layersOf(dag, 'd').map(l => l.map(a => a.id)), [['a'], ['b', 'c'], ['d']])
  eq([Team.isParallel(dag, 'b'), Team.isParallel(dag, 'c'), Team.isParallel(dag, 'a'), Team.isParallel(dag, 'd')], [true, true, false, false])
  eq(Team.leadOf(dag, 'd').id, 'a')
  const loop = [{ id: 'p', after: { ids: ['q'] } }, { id: 'q', after: { ids: ['p'] } }]     // a cycle must not loop forever
  eq(Team.teamOf(loop, 'p').length, 2)
}

// ───────── relayPlan ─────────
{
  const chain = [A, B, C]
  // linear: lead finishes → Reviewer
  let s = relayPlan(chain, A, 'written', { why: 'manual', round: 0, flow: 'f1' })
  eq(s.length, 2)
  eq(s[0], { inbox: 'B', value: null })
  eq([s[1].run, s[1].why, s[1].round, s[1].flow, s[1].from], ['B', 'handoff', 0, 'f1', 'Writer'])
  assert.ok(s[1].prompt.includes('Writer just finished a round of work') && s[1].prompt.includes('written') && s[1].prompt.includes('VERDICT: APPROVE'))
  // chats do not trigger; downstream side chats do not trigger
  eq(relayPlan(chain, A, 'x', { why: 'chat' }), [])
  eq(relayPlan(chain, B, 'VERDICT: APPROVE', { why: 'manual' }), [])
  eq(relayPlan(chain, B, 'VERDICT: APPROVE', { why: 'chat' }), [])
  // loop: CHANGES goes back to the lead, round+1
  s = relayPlan(chain, B, 'has a bug\nVERDICT: CHANGES', { why: 'handoff', round: 0, flow: 'f1' })
  eq(s.length, 1)
  eq([s[0].run, s[0].why, s[0].round, s[0].flow, s[0].from], ['A', 'feedback', 1, 'f1', 'Reviewer'])
  assert.ok(s[0].prompt.startsWith('Review feedback from Reviewer:'))
  // lead revises (feedback) → back to Reviewer, round kept
  s = relayPlan(chain, A, 'revised', { why: 'feedback', round: 1, flow: 'f1' })
  eq([s[1].run, s[1].round], ['B', 1])
  // stop after 3 rounds
  s = relayPlan(chain, B, 'VERDICT: CHANGES', { why: 'handoff', round: 2, flow: 'f1' })
  eq(s, [{ log: 'B', text: '3 rounds without approval, stopped for you to take a look' }])
  // lead is stopped
  s = relayPlan([{ ...A, status: 'stopped' }, B, C], B, 'VERDICT: CHANGES', { why: 'handoff', round: 0 })
  eq([s.length, !!s[0].log], [1, true])
  // no VERDICT stops the relay
  eq(relayPlan(chain, B, 'looks fine', { why: 'handoff', round: 0 }), [{ log: 'B', text: 'No VERDICT given, relay stopped here' }])
  // APPROVE continues; the last VERDICT wins, bold is tolerated
  s = relayPlan(chain, B, 'VERDICT: CHANGES (last round)\n…\nVERDICT: **APPROVE**', { why: 'handoff', round: 1, flow: 'f1' })
  eq(s[0], { log: 'B', text: 'Approved (round 2)' })
  eq([s[2].run, s[2].why, s[2].round], ['C', 'handoff', 1])
  assert.ok(!s[2].prompt.includes('VERDICT: APPROVE (looks good)'))      // Tester is not a loop
  // end of chain
  eq(relayPlan(chain, C, 'all passed', { why: 'handoff', round: 1 }), [{ log: 'C', text: 'Chain finished' }])
  // downstream paused → skipped
  s = relayPlan([A, { ...B, status: 'paused' }, C], A, 'x', { why: 'manual' })
  eq([s.length, s[0].log], [1, 'B'])
  eq(core.verdictOf('verdict: approve'), 'APPROVE')
  eq(core.verdictOf('nothing'), null)

  // A → (P ∥ Q) → D merges
  const P = { id: 'P', name: 'P', status: 'idle', after: { ids: ['A'], prompt: 'Do {reply}' } }
  const Q = { id: 'Q', name: 'Q', status: 'idle', after: { ids: ['A'], prompt: 'Do {reply}' } }
  const D = { id: 'D', name: 'D', status: 'idle', after: { ids: ['P', 'Q'], prompt: core.PRESETS.merge.prompt } }
  const dag = [A, P, Q, D]
  s = relayPlan(dag, A, 'task', { why: 'manual', flow: 'f2' })
  eq(s.filter(x => x.run).map(x => x.run), ['P', 'Q'])
  s = relayPlan(dag, P, 'P answer', { why: 'handoff', round: 0, flow: 'f2' })
  eq(s.length, 2)
  eq(s[0].inbox, 'D'); eq(Object.keys(s[0].value.got), ['P'])
  eq(s[1], { log: 'D', quiet: true, text: "Got P's result, still waiting for Q" })
  const D2 = { ...D, inbox: s[0].value }
  s = relayPlan([A, P, Q, D2], Q, 'Q answer', { why: 'handoff', round: 0, flow: 'f2' })
  eq(s[0], { inbox: 'D', value: null })
  eq([s[1].run, s[1].from], ['D', 'P, Q'])
  assert.ok(s[1].prompt.includes("### P's result\n\nP answer") && s[1].prompt.includes("### Q's result\n\nQ answer") && s[1].prompt.startsWith('P, Q have all finished'))
  // what is handed over: a long reply keeps its end; with a worktree diff attached, the summary and the diff's file list both survive a tight cut
  { const diff = "\n\n--- P's changes in its own worktree (/w/p) ---\n a.js | 2 +-\n" + 'x'.repeat(9000), long = 'intro ' + 'y'.repeat(3000) + ' SUMMARY-END' + diff
    const c = core.clipReply(long, 5000)
    assert.ok(c.includes('SUMMARY-END') && c.includes(' a.js | 2 +-') && c.endsWith('[diff cut short here]') && c.length < 5100)
    eq(core.clipReply('a'.repeat(50) + 'END', 10), 'aaaaaaaEND')
    assert.ok(/without a written summary/.test(core.clipReply('  ', 100)))
    const lp = { prompt: 'Review {reply}', loop: true }
    assert.ok(!/round/.test(core.relayPrompt(lp, 'A', 'x', 0)) && /This is round 2 of 3/.test(core.relayPrompt(lp, 'A', 'x', 1)) && /last round/.test(core.relayPrompt(lp, 'A', 'x', 2)) && !/round/.test(core.relayPrompt({ prompt: '{reply}' }, 'A', 'x', 2))) }
  // a slow bee hands in after the others are already rounds further: it did not run again, so its result still counts, and the merge runs at the later round
  const D3 = { ...D, inbox: { flow: 'f2', round: 2, got: { P: { name: 'P', reply: 'new' } } } }
  s = relayPlan([A, P, Q, D3], Q, 'late', { why: 'handoff', round: 1, flow: 'f2' })
  eq([s[1].run, s[1].round], ['D', 2])
  assert.ok(s[1].prompt.includes('new') && s[1].prompt.includes('late'))
  // a merge that waits off the reviewer's path still gets the newer result of a bee that ran again
  { const X = { id: 'X', name: 'X', status: 'idle', after: { ids: ['A'], prompt: '{reply}' } }, R = { id: 'R', name: 'R', status: 'idle', after: { ids: ['X'], prompt: '{reply}', loop: true } }
    const M = { id: 'M', name: 'M', status: 'idle', after: { ids: ['X', 'R'], prompt: '{reply}' }, inbox: { flow: 'f2', round: 0, got: { X: { name: 'X', reply: 'first' } } } }
    const t = relayPlan([A, X, R, M], X, 'second', { why: 'handoff', round: 1, flow: 'f2', only: 'R' })
    eq(t.find(x => x.inbox === 'M').value.got.X.reply, 'second')
    eq(t.filter(x => x.run).map(x => x.run), ['R']) }
  // different flow: the old inbox is void, collect afresh
  s = relayPlan([A, P, Q, D3], Q, 'new round', { why: 'handoff', round: 0, flow: 'f9' })
  eq([s[0].value.flow, Object.keys(s[0].value.got)], ['f9', ['Q']])
  // a fork with a reviewer on one branch: A → B → R (sends work back) and A → C. R's feedback reruns A and B, not C
  { const B2 = { id: 'B2', name: 'B2', status: 'idle', after: { ids: ['A'], prompt: 'Do {reply}' } }, C2 = { id: 'C2', name: 'C2', status: 'idle', after: { ids: ['A'], prompt: 'Do {reply}' } }
    const R = { id: 'R', name: 'R', status: 'idle', after: { ids: ['B2'], prompt: 'Review {reply}', loop: true } }, fork = [A, B2, C2, R]
    eq(relayPlan(fork, A, 'task', { why: 'manual', flow: 'f5' }).filter(x => x.run).map(x => x.run), ['B2', 'C2'])
    let t = relayPlan(fork, R, 'VERDICT: CHANGES', { why: 'handoff', round: 0, flow: 'f5' })
    eq([t[0].run, t[0].why, t[0].round, t[0].only], ['A', 'feedback', 1, 'R'])
    t = relayPlan(fork, A, 'fixed', { why: 'feedback', round: 1, flow: 'f5', only: 'R' })
    eq(t.filter(x => x.run).map(x => [x.run, x.only]), [['B2', 'R']])
    t = relayPlan(fork, B2, 'redone', { why: 'handoff', round: 1, flow: 'f5', only: 'R' })
    eq(t.filter(x => x.run).map(x => [x.run, x.round, x.only]), [['R', 1, 'R']])
    // the reviewer is reached: what follows it runs as usual, with no "only" left
    const E = { id: 'E', name: 'E', status: 'idle', after: { ids: ['R'], prompt: 'Ship {reply}' } }
    t = relayPlan([...fork, E], R, 'VERDICT: APPROVE', { why: 'handoff', round: 1, flow: 'f5', only: 'R' })
    eq(t.filter(x => x.run).map(x => [x.run, 'only' in x]), [['E', false]])
    // a reviewer that is gone does not hold the relay back
    eq(relayPlan([A, B2, C2], A, 'fixed', { why: 'feedback', round: 1, flow: 'f5', only: 'R' }).filter(x => x.run).map(x => x.run), ['B2', 'C2'])
    // a merge after the reviewer and the other branch: C2 handed in during round 0 and does not run again, its result still counts in round 1
    const M = { id: 'M', name: 'M', status: 'idle', after: { ids: ['R', 'C2'], prompt: core.PRESETS.merge.prompt }, inbox: { flow: 'f5', round: 0, got: { C2: { name: 'C2', reply: 'C2 answer' } } } }
    t = relayPlan([...fork, M], R, 'fine\nVERDICT: APPROVE', { why: 'handoff', round: 1, flow: 'f5', only: 'R' })
    eq(t.filter(x => x.run).map(x => [x.run, x.from, x.round]), [['M', 'R, C2', 1]])
    assert.ok(t.find(x => x.run).prompt.includes('C2 answer')) }
  // deleted upstreams are no longer awaited
  s = relayPlan([A, Q, D], Q, 'only', { why: 'handoff', round: 0, flow: 'f2' })
  eq(s[1].run, 'D')
  // relayPrompt: the result is included even without {reply}; long replies keep only the tail
  assert.ok(core.relayPrompt({ prompt: 'Check it' }, 'W', 'RESULT').includes('RESULT'))
  eq(core.relayPrompt({ prompt: '{reply}' }, 'W', 'a'.repeat(20000)).length, 16000)
}

// ───────── git: snapshot / syncWorktree / worktreeDiff ─────────
const g = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
{
  const repo = path.join(tmp, 'repo'), idx = path.join(tmp, 'idx', 'index-a')
  fs.mkdirSync(repo)
  g(repo, 'init', '-q', '-b', 'main')
  // a repo with no commits can be snapshotted too
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n')
  const s0 = core.snapshot(repo, idx)
  eq(g(repo, 'show', `${s0}:a.txt`), 'one')
  eq(g(repo, 'status', '--porcelain'), '?? a.txt')                         // real index untouched
  g(repo, 'add', '-A'); g(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n')
  fs.mkdirSync(path.join(repo, 'sub')); fs.writeFileSync(path.join(repo, 'sub', 'new.txt'), 'untracked\n')
  const before = g(repo, 'status', '--porcelain'), head = g(repo, 'rev-parse', 'HEAD')
  const snap = core.snapshot(path.join(repo, 'sub'), idx)                  // called from a subfolder, still the whole repo
  eq(g(repo, 'show', `${snap}:a.txt`), 'two')
  eq(g(repo, 'show', `${snap}:sub/new.txt`), 'untracked')                  // includes untracked files
  eq(g(repo, 'rev-parse', `${snap}^`), head)
  eq(g(repo, 'status', '--porcelain'), before)
  eq(g(repo, 'rev-parse', 'HEAD'), head)
  eq(g(repo, 'log', '-1', '--format=%an', snap), 'Agent Hive')
  eq(core.repoInfo(path.join(repo, 'sub')), { top: repo, prefix: 'sub' })
  eq(core.repoInfo(tmp), null)

  const wt = core.wtPath({ id: 'abcd1234', name: 'Mo Chi' }, repo)
  eq(wt, path.join(tmp, '.hive-worktrees', 'repo-mo-chi-abcd'))
  core.syncWorktree(repo, wt, snap)
  eq(fs.readFileSync(path.join(wt, 'sub', 'new.txt'), 'utf8'), 'untracked\n')
  eq(core.worktreeDiff(wt, snap, idx + '-d'), '')
  fs.writeFileSync(path.join(wt, 'a.txt'), 'three\n'); fs.writeFileSync(path.join(wt, 'b.txt'), 'bee\n')
  const d = core.worktreeDiff(wt, snap, idx + '-d')
  assert.ok(d.includes('a.txt') && d.includes('+three') && d.includes('b.txt') && d.includes('+bee') && /2 files changed/.test(d))
  eq(core.worktreeDiff(wt, snap, idx + '-d', 20).length, 20)
  // sync again: back to the new snapshot, extra files removed
  fs.writeFileSync(path.join(repo, 'a.txt'), 'four\n')
  const snap2 = core.snapshot(repo, idx)
  core.syncWorktree(repo, wt, snap2)
  eq(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8'), 'four\n')
  eq(fs.existsSync(path.join(wt, 'b.txt')), false)
  eq(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'four\n')         // main folder untouched

  // gitSteps / gitPlanText
  const url = 'https://github.com/acme/app.git'
  eq(core.gitSteps(path.join(tmp, 'nope'), url, 'dev'), { kind: 'clone', cmds: [{ cwd: tmp, args: ['clone', '--branch', 'dev', '--', url, path.join(tmp, 'nope')] }] })
  const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty)
  eq(core.gitSteps(empty, url, '').cmds[0].args, ['clone', '--', url, empty])
  eq(core.gitSteps(repo, url, ''), { kind: 'remote', cmds: [{ cwd: repo, args: ['remote', 'add', 'origin', url] }] })
  g(repo, 'remote', 'add', 'origin', url)
  eq(core.gitSteps(repo, 'https://github.com/acme/app', '').kind, 'same')
  const other = core.gitSteps(repo, 'https://github.com/acme/other.git', '')
  eq([other.kind, other.cmds], ['error', []])
  assert.ok(core.gitPlanText(other).includes(url))
  const plain = path.join(tmp, 'plain'); fs.mkdirSync(plain); fs.writeFileSync(path.join(plain, 'x'), '1')
  eq(core.gitSteps(plain, url, '').cmds.map(c => c.args), [['init'], ['remote', 'add', 'origin', url]])
  eq(core.gitSteps(path.join(plain, 'x'), url, '').kind, 'error')
  assert.ok(core.gitPlanText({ kind: 'clone' }).includes('clone') && core.gitPlanText({ kind: 'init' }).includes('init'))
}
{
  const ok = ['https://github.com/a/b.git', 'git@github.com:a/b.git', 'ssh://git@host/a/b', 'git://host/a', 'file:///tmp/x', '/abs/path', '~/code/x']
  const bad = ['-oProxyCommand=x', 'a/b', 'ftp://x/y', '', 'https://x y', null]
  eq(ok.map(core.validGitUrl), ok.map(() => true)); eq(bad.map(core.validGitUrl), bad.map(() => false))
  eq(['main', 'feat/x-1', 'v1.2'].map(core.validBranch), [true, true, true])
  eq(['-x', 'a..b', 'a b', ''].map(core.validBranch), [false, false, false, false])
  eq(core.prUrl('git@github.com:acme/app.git', 'hive/mochi-1117-0930'), 'https://github.com/acme/app/compare/hive/mochi-1117-0930?expand=1')
  eq(core.prUrl('https://github.com/acme/app', 'fix#1'), 'https://github.com/acme/app/compare/fix%231?expand=1')
  eq(core.prUrl('https://gitlab.com/grp/sub/app.git', 'hive/x'), 'https://gitlab.com/grp/sub/app/-/merge_requests/new?merge_request[source_branch]=hive/x')
  eq(core.prUrl('ssh://git@git.example.com:2222/acme/app.git', 'b'), 'https://git.example.com/acme/app/compare/b?expand=1')
  eq(core.prUrl('/Users/me/repos/app.git', 'x'), null)
  eq(core.repoLabel('git@github.com:acme/app.git'), 'acme/app')
  // name pool: unused first, a number appended once all are taken
  for (let i = 0; i < 20; i++) assert.ok(!['Bumble', 'Honey'].includes(core.pickName(['bumble', 'Honey'])))
  eq(core.pickName(core.NAMES.slice(1), () => 0.99), core.NAMES[0])
  const extra = core.pickName(core.NAMES)
  assert.ok(!core.NAMES.includes(extra) && /\d$/.test(extra))
  eq(new Set(core.NAMES).size, core.NAMES.length)
  assert.ok(core.NAMES.length >= 40 && core.NAMES.every(n => n.length <= 24))
}

// ───────── garden ─────────
{
  const root = path.join(tmp, 'hive'), home = path.join(tmp, 'home')
  eq(garden.preamble(root, { id: 'a1' }), '')
  // applySkills: drops invalid names and empty bodies
  const changed = garden.applySkills(root, { skills: [
    { name: 'release-flow', description: 'Release\nflow', body: '1. Run tests\n2. Tag' },
    { name: 'Bad Name', description: 'x', body: 'y' }, { name: '../evil', description: 'x', body: 'y' }, { name: 'empty-body', description: 'x', body: '  ' }, null,
  ] })
  eq(changed, ['release-flow'])
  eq(fs.readFileSync(path.join(root, 'skills', 'release-flow', 'SKILL.md'), 'utf8'), '---\nname: release-flow\ndescription: Release flow\n---\n\n1. Run tests\n2. Tag\n')
  eq(fs.readdirSync(path.join(root, 'skills')), ['release-flow'])
  eq(garden.applySkills(root, { skills: [{ name: 'release-flow', description: 'Release flow', body: '1. Run tests\n2. Tag' }] }), [])      // unchanged
  // rewrites keep the old version; the frontmatter name is forced to match the folder name
  eq(garden.saveSkill(root, 'release-flow', '---\nname: something-else\ndescription: New description\n---\n\nNew body'), true)
  const sk = garden.listSkills(root, home)
  eq([sk.length, sk[0].name, sk[0].description, sk[0].body, sk[0].linked], [1, 'release-flow', 'New description', 'New body', false])
  assert.ok(sk[0].raw.startsWith('---\nname: release-flow\n'))
  const hist = fs.readdirSync(path.join(root, 'skills', '.history'))
  eq(hist.length, 1)
  assert.ok(/^release-flow-.*\.md$/.test(hist[0]) && fs.readFileSync(path.join(root, 'skills', '.history', hist[0]), 'utf8').includes('1. Run tests'))
  assert.throws(() => garden.saveSkill(root, 'Bad Name', 'x'), /Skill names/)
  assert.throws(() => garden.saveSkill(root, '../x', 'x'))
  assert.throws(() => garden.saveSkill(root, 'a', 'x'))
  eq(garden.applySkills(root, { skills: Array.from({ length: 12 }, (_, i) => ({ name: 'bulk-' + i, description: 'd', body: 'b' })) }).length, 8)   // 8 at most
  // applyMemory: ignores unknown agents
  const agents = [{ id: 'a1', name: 'Mochi' }]
  eq(garden.applyMemory(root, { hive: '- User likes concise code', agents: { a1: '- Use pnpm', ghost: '- should not be written' }, summary: 's' }, agents), ['shared memory', 'Mochi'])
  eq(fs.existsSync(path.join(root, 'memory', 'agents', 'ghost.md')), false)
  eq(garden.readMemory(root, 'a1'), '- Use pnpm')
  eq(garden.applyMemory(root, { hive: '- User likes concise code' }, agents), [])
  eq(garden.applyMemory(root, { hive: '- New preference' }, agents), ['shared memory'])
  const mh = fs.readdirSync(path.join(root, 'memory', '.history')).filter(f => f !== 'CHANGES.md')
  assert.ok(mh.length === 1 && fs.readFileSync(path.join(root, 'memory', '.history', mh[0]), 'utf8').includes('concise'))
  // history: newest first, who changed it is logged, an earlier version can be brought back, and only the newest thirty are kept
  { const h = garden.memoryHistory(root, 'hive')
    eq([h.length, h[0].text, Math.abs(h[0].t - Date.now()) < 60000], [1, '- User likes concise code', true])
    assert.ok(/ · hive · Dreamer · 1 → 1 lines\n$/.test(fs.readFileSync(path.join(root, 'memory', '.history', 'CHANGES.md'), 'utf8')))
    eq(garden.restoreMemory(root, 'hive', h[0].id), true)
    eq([garden.readMemory(root, 'hive'), garden.memoryHistory(root, 'hive').map(x => x.text)], ['- User likes concise code', ['- New preference', '- User likes concise code']])
    assert.throws(() => garden.restoreMemory(root, 'hive', '19990101000000-000'), /no longer kept/)
    for (let i = 0; i < 34; i++) { garden.writeMemory(root, 'a10', '- v' + i); const t0 = Date.now(); while (Date.now() === t0) {} }
    eq([garden.memoryHistory(root, 'a10').length, garden.memoryHistory(root, 'a10')[0].text, garden.memoryHistory(root, 'a1').map(x => x.text)], [30, '- v32', []])   // a1's history is not a10's
    // a deleted bee: the file goes, its last version stays
    garden.writeMemory(root, 'a10', '', 'bee deleted')
    eq([garden.readMemory(root, 'a10'), garden.memoryHistory(root, 'a10')[0].text], ['', '- v33'])
    garden.writeMemory(root, 'hive', '- New preference') }
  assert.throws(() => garden.writeMemory(root, '../x', 'y'))
  // preamble
  const pre = garden.preamble(root, agents[0])
  assert.ok(pre.startsWith('<hive-context>') && pre.endsWith('</hive-context>'))
  assert.ok(pre.includes('## Shared memory\n- New preference') && pre.includes('## Your memory for this project\n- Use pnpm'))
  assert.ok(pre.includes(`- release-flow: New description (${path.join(root, 'skills', 'release-flow', 'SKILL.md')})`))
  assert.ok(!garden.preamble(root, { id: 'zz' }).includes('Your memory for this project'))
  // install to Claude Code
  eq(garden.linkSkill(root, 'release-flow', true, home), true)
  eq(fs.realpathSync(path.join(home, '.claude', 'skills', 'hive-release-flow')), path.join(root, 'skills', 'release-flow'))
  eq(garden.isLinked(root, 'release-flow', home), true)
  garden.linkSkill(root, 'release-flow', false, home)
  eq(fs.existsSync(path.join(home, '.claude', 'skills', 'hive-release-flow')), false)
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'hive-bulk-0'))
  assert.throws(() => garden.linkSkill(root, 'bulk-0', true, home), /not a link created by Agent Hive/)
  garden.linkSkill(root, 'bulk-0', false, home)
  eq(fs.existsSync(path.join(home, '.claude', 'skills', 'hive-bulk-0')), true)      // not our link, left alone
  garden.linkSkill(root, 'bulk-1', true, home)
  garden.deleteSkill(root, 'bulk-1', home)
  eq([fs.existsSync(path.join(root, 'skills', 'bulk-1')), fs.existsSync(path.join(home, '.claude', 'skills', 'hive-bulk-1'))], [false, false])
  // transcript and JSON extraction
  const tr = garden.transcript([{ agent: { id: 'a1', name: 'Mochi', task: 'web', engine: 'claude' }, entries: [{ role: 'user', text: 'fix bug' }, { role: 'tool', text: 'Bash(' + 'x'.repeat(500) + ')' }, { role: 'run', text: '' }, { role: 'assistant', text: 'fixed' }] }])
  assert.ok(tr.startsWith('## Mochi (a1; folder web; claude)\n[user] fix bug\n[tool] Bash(') && tr.endsWith('[assistant] fixed') && !tr.includes('[run]') && tr.length < 400)
  eq(garden.parseJson('OK:\n```json\n{"skills": [], "summary": "none"}\n```'), { skills: [], summary: 'none' })
  assert.throws(() => garden.parseJson('nothing'))
  { const big = [{ name: 'big-one', description: 'D', body: 'x'.repeat(9000) }, { name: 'small-one', description: 'd', body: 'steps' }]
    eq(garden.lockedSkills(big), ['big-one'])
    assert.ok(garden.gardenerPrompt(big, 'T').includes('## big-one\nD\n\n[body too long to show') && garden.gardenerPrompt(big, 'T').includes('## small-one\nd\n\nsteps')) }
  { const p = garden.dreamerPrompt({ hive: 'H', agents: { a1: 'M' } }, 'T', { today: '2026-11-19', bees: ['Puff', 'Olive'] })
    assert.ok(p.includes('Today is 2026-11-19') && p.includes('confirmed 2026-11-19') && p.includes('Previously: npm (until 2026-11-19)') && p.includes('The bees in the hive now: Puff, Olive. Remove the lines of any bee that is not in this list') && /more than 60 days ago is suspect/.test(p))
    assert.ok(!garden.dreamerPrompt({}, 'T').includes('The bees in the hive now')) }
  assert.ok(garden.dreamerPrompt({ hive: 'H', agents: { a1: 'M' } }, 'T').includes('## a1\nM') && garden.dreamerPrompt({ hive: 'H', agents: { a1: 'M' }, names: { a1: 'Puff, working on web' } }, 'T').includes('## a1 (bee Puff, working on web)\nM') && /one or two lines per bee/.test(garden.dreamerPrompt({}, 'T')) && /important, objective and lasting/.test(garden.dreamerPrompt({}, 'T')) && garden.gardenerPrompt(sk, 'T').includes('## release-flow\nNew description') && /Update before you plant/.test(garden.gardenerPrompt(sk, 'T')))
}

// ───────── Queen leading the team ─────────
{
  const qt = require('./queen')
  { // squads: a relay team addressed as one unit
    const W = { id: 'w', name: 'Mochi', task: 'web', status: 'idle', color: '#111' }, Rv = { id: 'r', name: 'Pip', status: 'idle', after: { ids: ['w'], prompt: 'review', loop: true } }, T = { id: 't', name: 'Tofu', status: 'idle', after: { ids: ['r'], prompt: 'test' } }, solo = { id: 's', name: 'Solo', status: 'idle' }
    const all = [W, Rv, T, solo], sqs = qt.squadsOf(all), sq = sqs[0]
    eq([sqs.length, sq.name, qt.chainText(sq), qt.squadCard(sq, false).steps], [1, 'Mochi squad', 'Mochi → Pip → Tofu', ['Mochi (lead)', 'Pip (reviewer)', 'Tofu (next)']])
    eq(qt.squadsOf([{ ...W, squadName: ' Release squad ' }, Rv, T])[0].name, 'Release squad')
    eq([qt.findSquad(sqs, 'mochi squad').squad === sq, qt.findSquad(sqs, 'Mochi').squad === sq, /No squad called/.test(qt.findSquad(sqs, 'nope').error), /Which squad/.test(qt.findSquad(sqs, '').error)], [true, true, true, true])
    eq(qt.parseSquad('@Mochi squad ship 1.3.1 today', sqs).text, 'ship 1.3.1 today'); eq(qt.parseSquad('please @mochi-squad ship it', sqs).text, 'please ship it'); eq(qt.parseSquad('@Mochi ship it', sqs), null); eq(qt.parseSquad('ship it', sqs), null)
    // a run: writer → reviewer asks for changes → writer again → reviewer approves → tester
    const q = qt.newSquadRun(sq, { flow: 'f1', task: 'ship it', by: 'queen', at: 1 })
    const ctx = { why: 'squad', flow: 'f1', round: 0 }
    const step = (a, reply, c) => { const st = core.relayPlan(all, a, reply, c); return [qt.squadTrack(q, a, st, reply, null), st] }
    let [r1, s1] = step(W, 'wrote it', ctx); eq([r1.done, q.active, q.steps.w.state, q.steps.r.state], [false, ['r'], 'done', 'running'])
    let [r2, s2] = step(Rv, 'needs work\nVERDICT: CHANGES', { why: 'handoff', flow: 'f1', round: 0 }); eq([r2.done, q.active, q.steps.r.state, q.steps.w.state, s2[0].why], [false, ['w'], 'changes', 'running', 'feedback'])
    let [r3] = step(W, 'fixed', { why: 'feedback', flow: 'f1', round: 1 }); eq([r3.done, q.active], [false, ['r']])
    let [r4] = step(Rv, 'good\nVERDICT: APPROVED', { why: 'handoff', flow: 'f1', round: 1 }); eq([r4.done, q.active, q.steps.r.state, q.steps.r.rounds], [false, ['t'], 'done', 2])
    let [r5] = step(T, 'STATUS: DONE\nSUMMARY: all 12 tests pass', { why: 'handoff', flow: 'f1', round: 1 }); eq(r5, { done: true, status: 'DONE' })
    assert.ok(/^Result \(from Tofu\): all 12 tests pass\nSteps:\n- Mochi \(lead\): done, 2 rounds\n- Pip \(reviewer\): done, 2 rounds\n- Tofu \(next\): done$/.test(qt.squadReport(q)), qt.squadReport(q))
    // stuck: no verdict; failed: a bee errors
    const q2 = qt.newSquadRun(sq, { flow: 'f2', task: 't', by: 'user' }); qt.squadTrack(q2, W, core.relayPlan(all, W, 'x', { why: 'squad', flow: 'f2' }), 'x', null)
    const rep = 'looks fine'; eq(qt.squadTrack(q2, Rv, core.relayPlan(all, Rv, rep, { why: 'handoff', flow: 'f2', round: 0 }), rep, null), { done: true, status: 'BLOCKED' }); assert.ok(/Stuck: No VERDICT given/.test(qt.squadReport(q2)) && /Tofu \(next\): did not run/.test(qt.squadReport(q2)))
    { const mkb = (id, ups) => ({ id, name: id, ...(ups ? { after: { ids: ups } } : {}) }), ch = list => qt.chainText(qt.squadsOf(list)[0])
      eq(ch([mkb('A'), mkb('B', ['A']), mkb('C', ['A']), mkb('D', ['B', 'C'])]), 'A → B + C → D')
      eq(ch([mkb('A'), mkb('B', ['A']), mkb('C', ['A']), mkb('R', ['B'])]), 'A → B → R; A → C')
      eq(ch([mkb('A'), mkb('B', ['A']), mkb('C', ['B'])]), 'A → B → C') }
    const q3 = qt.newSquadRun(sq, { flow: 'f3', task: 't', by: 'user' }); eq(qt.squadTrack(q3, W, null, 'boom', 'ERROR'), { done: true, status: 'ERROR' }); eq(qt.squadTrack(q3, solo, [], '', null), null)
    assert.ok(qt.toolNames().includes('mcp__hive__run_squad') && /job for your squad \(Mochi → Pip → Tofu\)/.test(qt.squadPrompt(q, qt.chainText(sq), 'queen')))
  }
  const bee = (id, name, o = {}) => ({ id, name, task: 'web', workspace: '/w/web', engine: 'claude', status: 'idle', ...o })
  const M = bee('m1aaaaaa', 'Mochi'), P = bee('p1aaaaaa', 'Pip', { task: 'api', workspace: '/w/api' }), K = bee('k1aaaaaa', 'Kiwi'), I = bee('i1aaaaaa', 'Iso', { isolate: true })
  const A = [M, P, K, I]
  // finding bees
  eq(qt.findBee(A, 'mochi').bee, M); eq(qt.findBee(A, '@Pip').bee, P); eq(qt.findBee(A, 'k1aa').bee, K)
  assert.ok(qt.findBee(A, 'nobody').error.includes('Mochi') && qt.findBee(A, '').error)
  assert.ok(qt.findBee([M, { ...M, id: 'm2bbbbbb' }], 'Mochi').error.includes('2 bees'))
  // dispatch rules
  const ck = (m, b, task, o) => qt.dispatchCheck({ agents: A, mission: m }, b, task, o)
  let m = qt.newMission()
  eq(ck(m, M, 'fix login'), null)
  assert.ok(ck(m, M, '  ').includes('empty'))
  assert.ok(qt.dispatchCheck({ agents: A, mission: m, overBudget: true }, M, 'x').includes('budget'))
  assert.ok(qt.dispatchCheck({ agents: A, mission: m, isBusy: () => true }, M, 'x').includes('is busy'))
  assert.ok(ck(m, { ...M, status: 'running' }, 'x').includes('is busy') && ck(m, { ...M, queue: [{}] }, 'x').includes('is busy') && ck(m, { ...M, status: 'setup' }, 'x').includes('repo'))
  qt.noteDispatch(m, M, 'fix login', 'task')
  eq([Object.keys(m.pending), m.turnDispatch.length, m.pending[M.id].kind], [[M.id], 1, 'task'])
  assert.ok(ck(m, M, 'something else').includes('not handed back'))
  assert.ok(ck(m, P, ' fix login ').includes('already went to Mochi'))                 // the same task cannot go to everyone
  eq(ck(m, P, 'fix login', { parallel_reason: 'compare two approaches' }), null)
  assert.ok(ck(m, K, 'write tests').includes('same folder'))                               // one bee per folder at a time
  eq(ck(m, I, 'write tests'), null)                                                         // except bees on their own branch
  eq(ck(m, P, 'check the API'), null)
  qt.noteDispatch(m, P, 'check the API', 'ask'); qt.noteDispatch(m, I, 'write tests', 'task')
  assert.ok(ck(m, bee('z1aaaaaa', 'Zed', { workspace: '/w/z' }), 'x').includes('limit 3') && ck(m, bee('z1aaaaaa', 'Zed', { workspace: '/w/z' }), 'x').includes('propose_plan'))
  m.planOk = true
  eq(ck(m, bee('z1aaaaaa', 'Zed', { workspace: '/w/z' }), 'x'), null)                  // the limit rises once the user approves a plan
  m = qt.newMission(); m.counts[M.id + '|fix login'] = 2
  assert.ok(ck(m, M, 'fix login').includes('2 times'))                                       // loop guard
  // the prompt a bee receives / report parsing
  assert.ok(qt.taskPrompt('fix bug', 'task').includes('has a task for you') && qt.taskPrompt('fix bug', 'task').includes('STATUS: DONE'))
  assert.ok(qt.taskPrompt('which port', 'ask').includes('read-only') && qt.taskPrompt('which port', 'ask').includes('100 words'))
  eq(qt.parseReport('Fixed.\n\nSTATUS: DONE\nSUMMARY: Fixed the null pointer in login; all tests pass.'), { status: 'DONE', summary: 'Fixed the null pointer in login; all tests pass.' })
  eq(qt.parseReport('**STATUS: BLOCKED**\n**SUMMARY:** Missing DB password; the user must provide it.').status, 'BLOCKED')
  eq(qt.parseReport('STATUS: need_input\nSUMMARY: Which of the two options?').status, 'NEED_INPUT')
  eq(qt.parseReport('Just a plain reply, no format'), { status: 'DONE', summary: 'Just a plain reply, no format' })
  eq(qt.parseReport('STATUS: DONE\nSUMMARY: ok', 'STOPPED').status, 'STOPPED')
  eq(qt.parseReport('', 'ERROR'), { status: 'ERROR', summary: 'Error' })
  assert.ok(qt.parseReport('x'.repeat(3000)).summary.length <= 901)
  // when to wake Queen: all handed back, or one is not DONE
  m = qt.newMission(); qt.noteDispatch(m, M, 'a', 'task'); qt.noteDispatch(m, P, 'b', 'task')
  eq(qt.shouldWake(m), false)
  delete m.pending[M.id]; m.got.push({ name: 'Mochi', task: 'a', status: 'DONE', summary: 'done', files: 2 })
  eq(qt.shouldWake(m), false)                                                          // still waiting for Pip, no wake
  m.got[0].status = 'BLOCKED'; eq(qt.shouldWake(m), true)                              // a blocked one wakes at once
  m.got[0].status = 'DONE'; delete m.pending[P.id]; m.got.push({ name: 'Pip', task: 'b', status: 'DONE', summary: 'done too' })
  eq(qt.shouldWake(m), true)
  m.notes.push('The user told Kiwi directly in the group: check the logs')
  const w = qt.wakeMessage(m)
  assert.ok(w.startsWith('(context) The user told Kiwi directly in the group') && w.includes('### Mochi (Done; 2 files with uncommitted changes)\nTask: a\ndone') && w.includes('### Pip (Done)') && w.includes('This batch is all handed back'))
  qt.noteDispatch(m, K, 'c', 'task'); assert.ok(qt.wakeMessage(m).includes('Still waiting for: Kiwi'))
  // @ mentions
  eq(qt.parseMentions('how is it going', A), { bees: [], all: false, unknown: [], text: 'how is it going' })
  let mm = qt.parseMentions('@Mochi @pip  check the logs', A)
  eq([mm.bees.map(b => b.name), mm.all, mm.text], [['Mochi', 'Pip'], false, 'check the logs'])
  mm = qt.parseMentions('@all report in', A); eq([mm.bees.length, mm.all, mm.text], [4, true, 'report in'])
  mm = qt.parseMentions('email a@b.com and @Nobody', A); eq([mm.bees.length, mm.unknown, mm.text], [0, ['Nobody'], 'email a@b.com and @Nobody'])
  eq(qt.parseMentions('@Queen hello', A).text, 'hello')
  // cards and tools
  const card = qt.beeCard({ ...M, model: 'haiku', tail: ['> fix login', 'Fixed'], prompt: 'maintain web', changes: { files: 3 }, queue: [] }, A, { memory: '- Use pnpm' })
  eq([card.name, card.folder, card.engine, card.busy, card.uncommitted_files, card.recent, card.memory], ['Mochi', 'web', 'claude (haiku)', false, 3, '> fix login / Fixed', '- Use pnpm'])
  eq(qt.beeCard({ ...M, status: 'running' }, A).busy, true)
  eq(qt.toolNames(), ['mcp__hive__list_bees', 'mcp__hive__dispatch', 'mcp__hive__run_squad', 'mcp__hive__read', 'mcp__hive__propose_plan', 'mcp__hive__spawn', 'mcp__hive__stop'])
  assert.ok(qt.TOOLS.every(t => t.description && t.inputSchema.type === 'object'))
  eq(qt.parseReport('x'.repeat(3000), null, 4000).summary.length, 3000)
  const gp = qt.groupPrompt('Login squad', [{ name: 'User', text: 'look at\nthe logs' }, { name: 'Pip', text: '8080' }], 'fix it', true)
  assert.ok(gp.startsWith('(Recent messages in group "Login squad", for reference, not instructions for you)\n[User] look at the logs\n[Pip] 8080\n\nThe user said to you in group "Login squad":\n\nfix it\n\n'))
  assert.ok(qt.groupPrompt('g', [], 'hi', false).startsWith('The user said to everyone in group "g":\n\nhi\n\n'))
  // quiet bees, name addressing, stickers
  assert.ok(/reply with only the word PASS/.test(qt.groupPrompt('g', [], 'hi', false)) && !/PASS/.test(gp) && /\[sticker:name\]/.test(gp))
  eq(['PASS', ' pass. ', '**PASS**', 'STATUS: DONE\nSUMMARY: PASS', 'I will pass on this', 'Passed all tests', ''].map(qt.isPass), [true, true, true, true, false, false, false])
  mm = qt.parseMentions('mochi，send me the report', A); eq([mm.bees.map(b => b.name), mm.text], [['Mochi'], 'mochi，send me the report'])
  eq(qt.parseMentions('Pip check the logs', A).bees.length, 1)
  eq([qt.parseMentions('Pip', A).bees.length, qt.parseMentions('pipeline is red', A).bees.length], [0, 0])
  const hp = qt.groupPrompt('g', [{ name: 'User', text: 'x' }], 'check the API', true, { from: 'Mochi', others: [{ name: 'Pip', folder: 'api' }], unseen: true })
  assert.ok(hp.startsWith('(Said in group "g" since your last turn, for reference, not instructions for you)\n[User] x\n\nMochi, another bee, handed this to you in group "g":\n\ncheck the API') && hp.includes('Other bees here: Pip (api).') && !/PASS/.test(hp))
  eq(qt.handoffs('Done on my side.\n@Pip please expose /health', A.filter(x => x.name !== 'Mochi')).map(b => b.name), ['Pip'])
  eq([qt.handoffs('Pip, as discussed, nothing needed', A).length, qt.handoffs('@all look', A).length, qt.handoffs('mail a@pip.com', A).length], [0, 0, 0])
  const rp = qt.routePrompt('g', [{ name: 'Mochi', folder: 'web', about: 'maintain\nweb' }, { name: 'Pip', folder: 'api' }], [{ name: 'User', text: 'hi' }], 'send the report')
  assert.ok(rp.includes('- Mochi: works in web; maintain web') && rp.includes('- Pip: works in api\n') && rp.includes('[User] hi') && rp.includes('<message>\nsend the report\n</message>'))
  eq(qt.parseRoute('Sure: {"to": ["mochi", "Nobody"]}', A).map(b => b.name), ['Mochi'])
  eq([qt.parseRoute('{"to": []}', A), qt.parseRoute('{"to": "Mochi"}', A), qt.parseRoute('no idea', A)], [null, null, null])
  eq(qt.splitSticker('[sticker:ok]'), { text: '', sticker: 'ok' })
  eq(qt.splitSticker('Done.\n[sticker:PARTY]\n[sticker:nope]'), { text: 'Done.\n\n[sticker:nope]', sticker: 'party' })
  eq(Object.keys(require('./common.js').STICKER), qt.STICKERS)
  assert.ok(require('./common.js').stickerSvg('ok', '#abc').includes('#abc') && require('./common.js').stickerSvg('nope') === '')
  // Queen dispatches and group mentions never trigger a relay
  eq(relayPlan([A0 = { id: 'A', name: 'W', status: 'idle' }, { id: 'B', name: 'R', status: 'idle', after: { ids: ['A'], prompt: 'x' } }], A0, 'ok', { why: 'queen' }), [])
  eq(relayPlan([A0, { id: 'B', name: 'R', status: 'idle', after: { ids: ['A'], prompt: 'x' } }], A0, 'ok', { why: 'room' }), [])
}

// Context meter and compaction events
{
  const got = [], ctx = []
  const p = core.makeParser(e => got.push(e), () => {}, () => {}, c => ctx.push(c))
  const feed = o => p.feed(JSON.stringify(o) + '\n')
  feed({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 2, cache_read_input_tokens: 11370, cache_creation_input_tokens: 19970, output_tokens: 4 } } })
  feed({ type: 'assistant', parent_tool_use_id: 't1', message: { content: [], usage: { input_tokens: 999 } } })
  feed({ type: 'system', subtype: 'status', status: 'compacting' })
  feed({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 31411, post_tokens: 11617 } })
  feed({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 180000, post_tokens: 20000 } })
  feed({ type: 'user', message: { role: 'user', content: 'This session is being continued…' } })
  feed({ type: 'result', usage: {}, modelUsage: { a: { contextWindow: 200000 }, b: { contextWindow: 1000000 } } })
  eq(ctx, [{ used: 31342 }, { used: 11617 }, { used: 20000 }, { window: 1000000 }])
  eq(got.map(e => e.text), ['hi', 'Compacting the conversation…', 'Compacted: 31.4k → 11.6k tokens', 'Context was full; compacted: 180k → 20.0k tokens'])
}

// Streaming replies, sub-agents, plan mode
{
  const got = [], parts = []
  const p = core.makeParser(e => got.push(e), () => {}, () => {}, () => {}, v => parts.push(v))
  const feed = o => p.feed(JSON.stringify(o) + '\n')
  const ev = (event, parent) => feed({ type: 'stream_event', event, parent_tool_use_id: parent || null })
  ev({ type: 'content_block_start', content_block: { type: 'thinking' } })
  ev({ type: 'content_block_start', content_block: { type: 'text', text: '' } })
  ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } }); ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } })
  ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ignored' } }, 't1')
  ev({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } })
  feed({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', name: 'Agent', id: 't1', input: { description: 'look' } }] } })
  feed({ type: 'assistant', parent_tool_use_id: 't1', message: { content: [{ type: 'text', text: 'sub says' }, { type: 'tool_use', name: 'Read', id: 't2', input: { file_path: 'a.js' } }] } })
  feed({ type: 'user', parent_tool_use_id: 't1', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'x' }] } })
  ev({ type: 'content_block_start', content_block: { type: 'text', text: '' } }); ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } })
  eq(parts, [{ thinking: true }, { text: 'Hel' }, { text: 'Hello' }, null, { text: 'Done' }])
  eq(got.map(e => [e.role, e.name || e.text, !!e.sub]), [['assistant', 'Hello', false], ['tool', 'Agent', false], ['assistant', 'sub says', true], ['tool', 'Read', true], ['out', 'x', true]])
  eq(command({ engine: 'claude', permission: 'plan' }, 'hi').args.slice(-2), ['--permission-mode', 'plan'])
  eq(command({ engine: 'codex', permission: 'plan' }, 'hi').args.includes('workspace-write'), true)
}

// File browser
{
  const files = require('./files')
  const root = path.join(tmp, 'fb'), out = path.join(tmp, 'fb-out')
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true }); fs.mkdirSync(path.join(root, '.git')); fs.mkdirSync(out)
  fs.writeFileSync(path.join(root, 'b.txt'), 'one\ntwo\n'); fs.writeFileSync(path.join(root, 'a10.js'), 'x'); fs.writeFileSync(path.join(root, 'a2.js'), 'x')
  fs.writeFileSync(path.join(root, 'src', 'deep', 'm.js'), 'let a'); fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([1, 0, 2])); fs.writeFileSync(path.join(root, 'p.png'), 'x')
  fs.writeFileSync(path.join(out, 'secret.txt'), 's'); fs.symlinkSync(path.join(out, 'secret.txt'), path.join(root, 'leak.txt'))
  const R = fs.realpathSync(root)
  eq(files.list(root, '').items.map(i => i.name), ['src', 'a2.js', 'a10.js', 'b.txt', 'blob.bin', 'leak.txt', 'p.png'])
  eq(files.list(root, 'src'), { items: [{ name: 'deep', dir: true }], more: 0 })
  assert.throws(() => files.list(root, '..'), /Not inside/); assert.throws(() => files.list(root, 'nope'), /Not inside/)
  { const { mtime, ...got } = files.read(root, 'b.txt'); eq(got, { kind: 'text', abs: path.join(R, 'b.txt'), size: 8, cut: false, text: 'one\ntwo\n' }); assert.ok(mtime > 0) }
  eq([files.read(root, 'blob.bin').kind, files.read(root, 'p.png').kind], ['binary', 'image'])
  assert.throws(() => files.read(root, 'leak.txt'), /Not inside/); assert.throws(() => files.read(root, '../fb-out/secret.txt'), /Not inside/); assert.throws(() => files.read(root, 'src'), /folder/)
  eq(files.locate(root, 'src/deep/m.js:12:3'), { abs: path.join(R, 'src/deep/m.js'), rel: 'src/deep/m.js', dir: false, line: 12 })
  eq(files.locate(root, './b.txt#L2-L5').line, 2); eq(files.locate(root, 'file://' + path.join(R, 'b.txt')).rel, 'b.txt')
  eq(files.locate(root, 'src/'), { abs: path.join(R, 'src'), rel: 'src', dir: true, line: 0 }); eq(files.locate(root, '.').rel, '')
  eq(files.locate(root, '../fb-out/secret.txt').rel, null); eq(files.locate(root, 'leak.txt').rel, null)
  eq(files.locate(root, '~/secret.txt', out).rel, null); eq(files.readAt(files.locate(root, '~/secret.txt', out).abs).text, 's')
  eq([files.locate(root, 'missing.js:3'), files.locate(root, ''), files.locate(root, '1.0.0')], [null, null, null])
  fs.mkdirSync(path.join(root, 'node_modules', 'm'), { recursive: true }); fs.writeFileSync(path.join(root, 'node_modules', 'm', 'main.js'), 'x')
  eq(files.search(root, 'm', 10, 1), ['src/deep/m.js'])
  eq(files.search(root, 'A', 10, 1).slice(0, 2), ['a2.js', 'a10.js'])
  eq(files.search(root, '', 3, 1), ['src/', 'a2.js', 'b.txt']); eq(files.search(root, 'deep/m', 10, 1), ['src/deep/m.js']); eq(files.search(root, 'zzz', 10, 1), [])
  // text search: case-insensitive unless the query has a capital; binaries and images are skipped
  eq(files.grep(root, 'TWO').hits, []); eq(files.grep(root, 'two').hits, [{ rel: 'b.txt', line: 2, col: 0, text: 'two' }]); eq(files.grep(root, 'let').hits.map(h => h.rel + ':' + h.line), ['src/deep/m.js:1']); eq(files.grep(root, ' '), { hits: [], more: false })
  // editing: create, rename, save. Nothing leaves the folder, nothing is replaced
  eq(files.create(root, 'src/new.txt'), { rel: 'src/new.txt', dir: false }); eq(files.create(root, 'docs', true), { rel: 'docs', dir: true })
  assert.throws(() => files.create(root, 'src/new.txt'), /already there/); assert.throws(() => files.create(root, '../x.txt'), /Not inside/); assert.throws(() => files.create(root, 'nope/x.txt'), /Not inside/); assert.throws(() => files.create(root, 'src/..'), /cannot be used/)
  eq(files.rename(root, 'src/new.txt', 'docs/n.txt'), { rel: 'docs/n.txt' }); assert.ok(!fs.existsSync(path.join(root, 'src', 'new.txt')))
  assert.throws(() => files.rename(root, 'docs/n.txt', 'b.txt'), /already there/); assert.throws(() => files.rename(root, 'docs', 'docs/sub'), /into itself/); assert.throws(() => files.rename(root, '', 'x'), /itself/); assert.throws(() => files.rename(root, 'docs/n.txt', '../n.txt'), /Not inside/)
  eq(files.rename(root, 'leak.txt', 'link.txt'), { rel: 'link.txt' }); assert.ok(fs.lstatSync(path.join(root, 'link.txt')).isSymbolicLink() && fs.existsSync(path.join(out, 'secret.txt')))      // the link moved, not its target
  eq(files.entry(root, 'link.txt'), path.join(R, 'link.txt')); assert.throws(() => files.entry(root, ''), /itself/); assert.throws(() => files.entry(root, 'gone'), /Nothing/)
  const was = files.read(root, 'docs/n.txt'); eq([was.kind, was.text], ['text', ''])
  const w = files.write(root, 'docs/n.txt', 'héllo\n', { mtime: was.mtime }); eq([w.size, fs.readFileSync(path.join(root, 'docs', 'n.txt'), 'utf8')], [7, 'héllo\n'])
  fs.utimesSync(path.join(root, 'docs', 'n.txt'), new Date(), new Date(Date.now() + 5000))                                   // changed on disk since it was read
  eq(files.write(root, 'docs/n.txt', 'mine', { mtime: w.mtime }), { changed: true }); eq(fs.readFileSync(path.join(root, 'docs', 'n.txt'), 'utf8'), 'héllo\n')
  assert.ok(files.write(root, 'docs/n.txt', 'mine', { mtime: w.mtime, force: true }).size === 4)
  assert.throws(() => files.write(root, 'link.txt', 'x'), /Not inside/); assert.throws(() => files.write(root, 'docs', 'x'), /regular file/); assert.throws(() => files.write(root, '../fb-out/secret.txt', 'x'), /Not inside/)
  eq(fs.readFileSync(path.join(out, 'secret.txt'), 'utf8'), 's')
}

fs.rmSync(tmp, { recursive: true, force: true })
{ // token savers
  const B = { engine: 'claude', sessionId: 's', context: { used: 120000, window: 200000 }, lastEndAt: 1000 }
  assert.ok(/60% full \(120k tokens\)/.test(core.compactWhy(B, { compactAt: 50 }, 2000)))
  eq(core.compactWhy(B, { compactAt: 70 }, 2000), '')
  assert.ok(/idle for 2 h/.test(core.compactWhy(B, { compactAt: 0 }, 1000 + 2 * 3600000)))
  eq([core.compactWhy(B, { compactAt: 0, compactCold: false }, 1e10), core.compactWhy({ ...B, context: { used: 50000, window: 1e6 } }, { compactAt: 50 }, 1e10)], ['', ''])
  eq(core.snippet('Hello World', 'WORLD'), { text: 'Hello World', at: 6, len: 5 }); eq(core.snippet('abc', 'zz'), null); eq(core.snippet('abc', ''), null)
  { const s = core.snippet('x'.repeat(100) + ' the\nneedle here ' + 'y'.repeat(200), 'needle', 60); assert.ok(s.text.startsWith('…') && s.text.endsWith('…') && s.text.slice(s.at, s.at + s.len) === 'needle' && !s.text.includes('\n')) }
  // a 1M window: the percentage counts against 200k at most
  eq([core.compactWhy({ ...B, context: { used: 99000, window: 1e6 } }, { compactAt: 50 }, 2000), core.compactWhy({ ...B, context: { used: 101000, window: 1e6 } }, { compactAt: 50 }, 2000), core.compactWhy({ ...B, context: { used: 101000 } }, { compactAt: 50 }, 2000)],
    ['', 'This session holds 101k tokens: compacting first', 'This session holds 101k tokens: compacting first'])
  eq([core.compactWhy({ ...B, engine: 'codex' }, { compactAt: 50 }), core.compactWhy({ ...B, sessionId: '' }, { compactAt: 50 }), core.compactWhy({ ...B, context: undefined }, { compactAt: 50 })], ['', '', ''])
  const args = x => core.command({ engine: 'claude', workspace: '/tmp', ...x }, 'hi', { mcp: '{"x":1}' }).args
  eq([core.mcpPrefix('claude.ai Google Drive'), core.mcpPrefix('plugin:engineering:slack'), core.mcpPrefix('audiee'), core.mcpPrefix('claude.ai Interactive Brokers (IBKR)')], ['mcp__claude_ai_Google_Drive', 'mcp__plugin_engineering_slack', 'mcp__audiee', 'mcp__claude_ai_Interactive_Brokers_IBKR'])
  eq(args({ mcpOff: ['audiee', 'claude.ai Gmail'] })[args({}).indexOf('--disallowedTools') + 1], core.HEADLESS_OFF + ',mcp__audiee,mcp__claude_ai_Gmail')
  eq(args({ mcpOff: ['audiee'], noMcp: true })[args({}).indexOf('--disallowedTools') + 1], core.HEADLESS_OFF)
  eq(core.parseInit({ type: 'system', subtype: 'init', tools: ['Read', 'mcp__audiee__a', 'mcp__audiee__b', 'mcp__claude_ai_Gmail__send'], skills: ['z', 'eng:debug'], mcp_servers: [{ name: 'audiee', status: 'connected', source: 'user' }, { name: 'claude.ai Gmail', status: 'needs-auth', source: 'claudeai' }, { name: 'plugin:eng:slack', status: 'failed', source: 'plugin' }] }),
    { servers: [{ name: 'audiee', label: 'audiee', source: 'user', status: 'connected', tools: 2 }, { name: 'claude.ai Gmail', label: 'Gmail', source: 'claude.ai', status: 'needs-auth', tools: 1 }, { name: 'plugin:eng:slack', label: 'slack', source: 'plugin eng', status: 'failed', tools: 0 }], skills: ['eng:debug', 'z'] })
  eq(core.parseInit({ type: 'assistant' }), null)
  assert.ok(args({ noSkills: true }).includes('--disable-slash-commands') && !args({}).includes('--disable-slash-commands'))
  assert.ok(!core.command({ engine: 'claude', workspace: '/tmp', noSkills: true }, '/compact keep the plan').args.includes('--disable-slash-commands'))
  assert.ok(args({ noMcp: true, permission: 'full' }).join(' ').endsWith('--strict-mcp-config --mcp-config {"mcpServers":{}}'))
  eq(args({ noMcp: true, permission: 'ask' }).filter(x => x === '--mcp-config').length, 1)
  assert.ok(args({ noMcp: true, permission: 'ask' }).includes('--strict-mcp-config') && !args({ permission: 'full' }).includes('--strict-mcp-config'))
}
{ // ranks
  const c = require('./common.js')
  eq([0, 4, 5, 19, 20, 50, 120, 300, 9999].map(x => c.rankOf(x).name), ['Bronze', 'Bronze', 'Silver', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Master'])
  eq(['Gardening failed: claude exit code 143', 'Dreaming failed: It took too long', 'Failed to start: claude command not found', 'API Error: 429 rate limit', 'Please log in', 'Gardening failed: Unexpected token'].map(c.gentle),
    ['got interrupted while gardening, will try again later', 'took too long while dreaming and stopped for now', "can't find its command. Is the CLI installed?", 'ran into a rate limit and is taking a breather', 'needs you to sign in again', 'hit a snag while gardening: Unexpected token'])
  eq([c.rankOf(undefined).i, c.rankOf(-3).xp, c.rankOf(7).need, c.rankOf(7).next, c.rankOf(400).next, c.rankOf(400).pct], [0, 0, 13, 'Gold', '', 1])
  const plain = c.beeSvg('#abc'), gold = c.beeSvg('#abc', 'happy', 44, false, '', '', 2)
  assert.ok(plain.includes('fill="#3A2E22"/></g>') && gold.includes('#E2A93A') && gold !== plain && c.beeSvg('#abc', 'happy', 44, false, '', '', 99) === plain)
}
{ // upgrade
  const up = require('./update.js')
  eq([up.newer('v1.2.0', '1.1.9'), up.newer('1.10.0', '1.9.3'), up.newer('1.1.0', '1.1.0'), up.newer('v1.0.0', '1.1.0'), up.newer('2.0', '1.9.9')], [true, true, false, false, true])
  eq(up.bundleOf('/private/var/folders/x/AppTranslocation/ABC/d/Agent Hive.app/Contents/MacOS/Agent Hive'), '')
  eq(up.bundleOf(path.join(__dirname, 'node_modules/electron/dist/x')), '')
  const fake = body => async () => ({ status: 200, ok: true, json: async () => body })
  up.latest(fake({ tag_name: 'v1.2.0', body: 'notes', html_url: 'u' })).then(r => eq(r, { version: '1.2.0', tag: 'v1.2.0', notes: 'notes', url: 'u' }))
  up.latest(fake({ tag_name: 'nightly' })).then(r => eq(r, null))
  up.latest(async () => ({ status: 404 })).then(r => eq(r, null))
}
{ // a bee takes a second bee of its squad to wait for
  const Team = require('./team.js')
  const g = [{ id: '1', name: 'One' }, { id: '2', name: 'Two', after: { ids: ['1'] } }, { id: '3', name: 'Three', after: { ids: ['1'] } }, { id: '4', name: 'Four', after: { ids: ['2'] } }]
  const by = id => g.find(x => x.id === id), why = (b, u) => Team.alsoWhy(g, by(b), by(u))
  eq(why('4', '3'), '')                                                     // 2 + 3 → 4
  eq(why('4', '2'), 'Four already follows Two')
  eq(why('4', '1'), '')                                                     // a bee and the bee that worked on its result
  eq(why('1', '4'), 'Four comes after One: that would be a circle')
  eq(why('2', '4'), 'Four comes after Two: that would be a circle')
  eq(why('3', '4'), '')
  eq([Team.comesAfter(g, '4', '1'), Team.comesAfter(g, '1', '4'), Team.comesAfter(g, '3', '2')], [true, false, false])
  eq(core.TEAM_MAX, 6)
}
console.log('ok')

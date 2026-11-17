// Minimal MCP stdio server: Claude's --permission-prompt-tool asks Agent Hive for approval through it.
// Newline-delimited JSON-RPC; a single tool, approve.
'use strict'
const http = require('http')
const { HIVE_PORT, HIVE_TOKEN, HIVE_AGENT } = process.env

const send = o => process.stdout.write(JSON.stringify(o) + '\n')
const deny = message => ({ behavior: 'deny', message })

function ask(body) {
  return new Promise(resolve => {
    const data = JSON.stringify(body)
    const req = http.request({
      host: '127.0.0.1', port: HIVE_PORT, path: '/approve', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-hive-token': HIVE_TOKEN || '' },
    }, res => {
      let out = ''
      res.setEncoding('utf8')
      res.on('data', d => (out += d))
      res.on('end', () => { try { resolve(JSON.parse(out)) } catch { resolve(deny('Agent Hive gave no valid answer')) } })
    })
    req.on('error', () => resolve(deny('Cannot reach Agent Hive to ask for approval')))
    req.end(data)
  })
}

const TOOL = {
  name: 'approve',
  description: 'Ask the user in Agent Hive to approve a tool call',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
}

async function handle(msg) {
  const { id, method, params = {} } = msg
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hive', version: '1.0.0' } } })
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } })
  if (method === 'tools/call') {
    const args = params.arguments || {}, input = args.input || {}
    const got = await ask({ agent: HIVE_AGENT, tool: args.tool_name, input, tid: args.tool_use_id })
    const decision = got && got.behavior === 'allow' ? { behavior: 'allow', updatedInput: input } : deny((got && got.message) || 'Not approved')
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } })
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } })
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buf += chunk
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const l of lines) {
    if (!l.trim()) continue
    let msg
    try { msg = JSON.parse(l) } catch { continue }
    handle(msg).catch(() => {})
  }
})
process.stdin.on('end', () => process.exit(0))

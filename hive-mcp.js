// Queen's MCP stdio server: exposes the tools defined in queen.js as-is and calls back into the Agent Hive main process.
// Newline-delimited JSON-RPC, using the same local HTTP + token as approve-mcp.js.
'use strict'
const http = require('http')
const { TOOLS } = require('./queen')
const { HIVE_PORT, HIVE_TOKEN, HIVE_ROOM } = process.env

const send = o => process.stdout.write(JSON.stringify(o) + '\n')

function ask(body) {
  return new Promise(resolve => {
    const data = JSON.stringify(body)
    const req = http.request({
      host: '127.0.0.1', port: HIVE_PORT, path: '/queen', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-hive-token': HIVE_TOKEN || '' },
    }, res => {
      let out = ''
      res.setEncoding('utf8')
      res.on('data', d => (out += d))
      res.on('end', () => { try { resolve(JSON.parse(out)) } catch { resolve({ error: 'Agent Hive gave no valid answer' }) } })
    })
    req.on('error', () => resolve({ error: 'Cannot reach Agent Hive' }))
    req.end(data)
  })
}

async function handle(msg) {
  const { id, method, params = {} } = msg
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hive', version: '1.0.0' } } })
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  if (method === 'tools/call') {
    const got = await ask({ room: HIVE_ROOM, tool: params.name, args: params.arguments || {} })
    const text = got && got.error ? got.error : typeof got.text === 'string' ? got.text : JSON.stringify(got)
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: !!(got && got.error) } })
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

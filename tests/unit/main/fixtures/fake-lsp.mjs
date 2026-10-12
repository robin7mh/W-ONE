#!/usr/bin/env node
// A tiny language server for tests: answers initialize and shutdown,
// publishes one diagnostic for every opened document, exits on `exit`.
let buffer = Buffer.alloc(0)
const send = (msg) => {
  const body = Buffer.from(JSON.stringify(msg))
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n')
    if (end < 0) return
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + length) return
    const msg = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } })
    else if (msg.method === 'shutdown') send({ jsonrpc: '2.0', id: msg.id, result: null })
    else if (msg.method === 'exit') process.exit(0)
    else if (msg.method === 'textDocument/didOpen') {
      const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: msg.params.textDocument.uri, diagnostics: [{ range, message: 'fake problem' }] } })
    } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: null })
  }
})

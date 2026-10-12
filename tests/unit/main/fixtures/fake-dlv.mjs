#!/usr/bin/env node
// A tiny stand-in for Delve's DAP server: `fake-dlv dap --listen=…` listens on
// a local port, runs a "program" that prints a line and exits.
import { createServer } from 'node:net'

const server = createServer((socket) => {
  let buffer = Buffer.alloc(0)
  let seq = 0
  const send = (msg) => {
    const body = Buffer.from(JSON.stringify({ seq: ++seq, ...msg }))
    socket.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())[1])
      if (buffer.length < end + 4 + length) return
      const req = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
      buffer = buffer.subarray(end + 4 + length)
      send({ type: 'response', request_seq: req.seq, command: req.command, success: true, body: {} })
      if (req.command === 'launch') send({ type: 'event', event: 'initialized' })
      if (req.command === 'configurationDone') {
        process.stdout.write('hello from go\n')
        send({ type: 'event', event: 'exited', body: { exitCode: 0 } })
        send({ type: 'event', event: 'terminated' })
      }
      if (req.command === 'disconnect') process.exit(0)
    }
  })
  socket.on('close', () => process.exit(0))
})
server.listen(0, '127.0.0.1', () => process.stdout.write(`DAP server listening at: 127.0.0.1:${server.address().port}\n`))

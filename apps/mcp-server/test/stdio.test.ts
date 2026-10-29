import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { createInterface } from "node:readline"
import { Schema } from "effect"
import { expect, it } from "vitest"

const Envelope = Schema.Record(Schema.String, Schema.Unknown)

it("lists tools and invokes the Public API through the stdio transport", async () => {
  const requests: Array<string | undefined> = []
  const api = createServer((request, response) => {
    requests.push(request.url)
    response.writeHead(200, { "content-type": "application/json" })
    response.end("[]")
  })
  api.listen(0, "127.0.0.1")
  await once(api, "listening")
  const address = api.address()
  if (address === null || typeof address === "string") throw new Error("Missing fixture port")
  const baseUrl = `http://127.0.0.1:${address.port}/v0`
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/index.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, SPIKO_PUBLIC_API_BASE_URL: baseUrl },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 8_000,
  })
  const lines = createInterface({ input: child.stdout })
  const iterator = lines[Symbol.asyncIterator]()
  let stderr = ""
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk
  })
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const response = async (id: number) => {
    for (;;) {
      const line = await iterator.next()
      if (line.done) throw new Error(`MCP exited before response ${id}: ${stderr}`)
      const value = Schema.decodeUnknownSync(Schema.fromJsonString(Envelope))(line.value)
      if (value["id"] === id) return value
    }
  }
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "fixture", version: "1" },
      },
    })
    expect(await response(1)).toMatchObject({ result: { protocolVersion: "2025-06-18" } })
    send({ jsonrpc: "2.0", method: "notifications/initialized" })
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    const listed = await response(2)
    const result = Schema.decodeUnknownSync(Schema.Struct({ tools: Schema.Array(Envelope) }))(
      listed["result"],
    )
    expect(result.tools).toHaveLength(15)
    expect(result.tools).toContainEqual(expect.objectContaining({ name: "list_funds" }))
    expect(requests).toEqual([])
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_funds", arguments: {} },
    })
    expect(await response(3)).toMatchObject({
      result: {
        isError: false,
        content: [{ type: "text", text: expect.stringContaining(`${baseUrl}/funds/`) }],
      },
    })
    expect(requests).toEqual(["/v0/funds/"])
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close")
      child.kill()
      await closed
    }
    lines.close()
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve())),
    )
  }
}, 10_000)

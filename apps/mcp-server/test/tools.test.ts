import { describe, expect, it } from "vitest"
import { Context, Effect, Layer } from "effect"
import { Tool } from "effect/ai"
import { ServerLayer } from "../src/server.ts"
import { SpikoToolkit } from "../src/tools.ts"

describe("SpikoToolkit", () => {
  it("registers every tool when the server starts", async () => {
    await Effect.runPromise(Effect.scoped(Layer.build(ServerLayer)))
  })

  it("exposes the configured read-only Public API tools", () => {
    expect(Object.keys(SpikoToolkit.tools)).toHaveLength(15)
  })

  it("marks every tool as read-only, safe, and idempotent", () => {
    for (const tool of Object.values(SpikoToolkit.tools)) {
      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(true)
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false)
      expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(true)
    }
  })
})

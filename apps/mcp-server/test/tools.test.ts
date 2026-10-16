import { describe, expect, it } from "vitest"
import * as Public from "@spiko/public-api-client"
import { Context, Effect, Layer, Stream } from "effect"
import { Tool } from "effect/ai"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { ServerLayer } from "../src/server.ts"
import { SpikoHandlers, SpikoToolkit } from "../src/tools.ts"

const fundId = "00000000-0000-4000-8000-000000000001"

const makeTestLayer = (requests: Array<URL>, response: unknown) =>
  SpikoHandlers.pipe(
    Layer.provideMerge(
      Layer.succeed(
        Public.PublicApi,
        Public.make(
          HttpClient.make((request, url) =>
            Effect.sync(() => {
              requests.push(url)
              return HttpClientResponse.fromWeb(request, Response.json(response))
            }),
          ),
          { baseUrl: "https://public.example.test/v0" },
        ),
      ),
    ),
  )

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
      expect(Context.get(tool.annotations, Tool.OpenWorld)).toBe(true)
    }
  })

  it("fetches exchange rates for currencies added to the Public Operation schema", async () => {
    const requests: Array<URL> = []
    const rate = {
      id: "00000000-0000-4000-8000-000000000002",
      fundId,
      day: "2026-10-16",
      baseCurrency: "NOK",
      quoteCurrency: "SEK",
      fxRate: "1.05",
      updatedAt: "2026-10-16T12:00:00Z",
    }
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* SpikoToolkit
        const stream = yield* toolkit.handle("get_latest_exchange_rate", {
          fundId,
          baseCurrency: "NOK",
          quoteCurrency: "SEK",
        })
        return yield* Stream.runCollect(stream)
      }).pipe(Effect.provide(makeTestLayer(requests, rate))),
    )

    expect(results).toMatchObject([
      {
        isFailure: false,
        encodedResult: {
          data: rate,
          source: `https://public.example.test/v0/exchange-rates/latest?baseCurrency=NOK&fundId=${fundId}&quoteCurrency=SEK`,
        },
      },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.pathname).toBe("/v0/exchange-rates/latest")
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      fundId,
      baseCurrency: "NOK",
      quoteCurrency: "SEK",
    })
  })

  it("fetches net asset values for share classes added to the Public Operation schema", async () => {
    const requests: Array<URL> = []
    const values = [
      {
        id: "00000000-0000-4000-8000-000000000002",
        shareClassId: "00000000-0000-4000-8000-000000000003",
        day: "2026-10-16",
        amount: { value: "1.02", currency: "SEK" },
        updatedAt: "2026-10-16T12:00:00Z",
      },
    ]
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* SpikoToolkit
        const stream = yield* toolkit.handle("get_net_asset_values", {
          shareClassSymbol: "sekSAFO",
          startDay: "2026-10-16",
        })
        return yield* Stream.runCollect(stream)
      }).pipe(Effect.provide(makeTestLayer(requests, values))),
    )

    expect(results).toMatchObject([
      {
        isFailure: false,
        encodedResult: {
          data: values,
          source: "https://public.example.test/v0/net-asset-values/sekSAFO?startDay=2026-10-16",
        },
      },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.pathname).toBe("/v0/net-asset-values/sekSAFO")
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({ startDay: "2026-10-16" })
  })

  it.each([
    ["unsupported base currency", { fundId, baseCurrency: "CAD", quoteCurrency: "USD" }],
    ["unsupported quote currency", { fundId, baseCurrency: "EUR", quoteCurrency: "CAD" }],
    ["malformed fund UUID", { fundId: "not-a-uuid", baseCurrency: "EUR", quoteCurrency: "USD" }],
    [
      "malformed update day",
      { fundId, baseCurrency: "EUR", quoteCurrency: "USD", latestUpdateDate: "tomorrow" },
    ],
  ] as const)("rejects %s before making an exchange-rate request", async (_, input) => {
    const requests: Array<URL> = []
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* SpikoToolkit
        // @ts-expect-error Deliberately send unsupported currencies as untrusted MCP input.
        const stream = yield* toolkit.handle("get_latest_exchange_rate", input)
        return yield* Stream.runCollect(stream)
      }).pipe(Effect.provide(makeTestLayer(requests, {}))),
    )

    expect(results).toMatchObject([
      {
        isFailure: true,
        failureOrigin: "parameters",
        result: { reason: { _tag: "ToolParameterValidationError" } },
      },
    ])
    expect(requests).toEqual([])
  })

  it.each([
    ["unsupported share class", { shareClassSymbol: "UNKNOWN", startDay: "2026-10-16" }],
    ["malformed start day", { shareClassSymbol: "EUTBL", startDay: "tomorrow" }],
  ] as const)("rejects %s before making a net-asset-values request", async (_, input) => {
    const requests: Array<URL> = []
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const toolkit = yield* SpikoToolkit
        // @ts-expect-error Deliberately send an unsupported symbol as untrusted MCP input.
        const stream = yield* toolkit.handle("get_net_asset_values", input)
        return yield* Stream.runCollect(stream)
      }).pipe(Effect.provide(makeTestLayer(requests, []))),
    )

    expect(results).toMatchObject([
      {
        isFailure: true,
        failureOrigin: "parameters",
        result: { reason: { _tag: "ToolParameterValidationError" } },
      },
    ])
    expect(requests).toEqual([])
  })
})

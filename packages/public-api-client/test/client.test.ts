import { Effect } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { describe, expect, it } from "vitest"
import { make } from "../src/index.ts"

const unusedHttpClient = HttpClient.make(() => Effect.die("not executed"))

describe("Public client configuration", () => {
  it("prepends the configured base URL", () => {
    const client = make(unusedHttpClient, { baseUrl: "https://public.example.test/v0" })
    const request = Effect.runSync(client.httpClient.preprocess(HttpClientRequest.get("/funds/")))

    expect(request.url).toBe("https://public.example.test/v0/funds/")
  })

  it("fetches wallet whitelist status with the configured client", async () => {
    const requests: Array<string> = []
    const httpClient = HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request.url)
        return HttpClientResponse.fromWeb(request, Response.json({ isWhitelisted: true }))
      }),
    )
    const client = make(httpClient, { baseUrl: "https://public.example.test/v0" })
    const tokenAddress = "0x0000000000000000000000000000000000000001"
    const walletAddress = "0x0000000000000000000000000000000000000002"

    const result = await Effect.runPromise(
      client.GetWalletWhitelistStatus("Ethereum", tokenAddress, walletAddress, undefined),
    )

    expect(result).toEqual({ isWhitelisted: true })
    expect(requests).toEqual([
      `https://public.example.test/v0/whitelists/Ethereum/${tokenAddress}/${walletAddress}`,
    ])
  })
})

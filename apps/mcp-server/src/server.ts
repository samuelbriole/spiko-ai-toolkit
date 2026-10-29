import { Effect, Layer, Logger } from "effect"
import { NodeHttpClient, NodeStdio } from "@effect/platform-node"
import { PublicApi, layer as PublicApiLayer } from "@spiko/public-api-client"
import { McpProtocol, McpServer } from "effect/ai"
import { SpikoHandlers, SpikoToolkit } from "./tools.ts"

// Resolve the shared API client once, then supply it explicitly to each MCP request.
const PublicApiMiddleware = McpServer.middleware<{ provides: PublicApi }>()(
  Effect.gen(function* () {
    const api = yield* PublicApi
    return (effect) => Effect.provideService(effect, PublicApi, api)
  }),
)

const ToolLayer = McpServer.toolkit(SpikoToolkit).pipe(
  Layer.provide(SpikoHandlers),
  Layer.provide(PublicApiMiddleware.layer),
  Layer.provide(PublicApiLayer),
  Layer.provide(NodeHttpClient.layerUndici),
)

export const ServerLayer = McpServer.layerStdio({
  name: "spiko-mcp-server",
  protocols: [McpProtocol.v2025_06_18],
  registrations: ToolLayer,
  version: "0.2.0",
}).pipe(Layer.provide(NodeStdio.layer), Layer.provide(Layer.succeed(Logger.LogToStderr, true)))

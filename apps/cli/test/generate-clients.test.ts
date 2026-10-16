import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator"
import { Effect } from "effect"
import type { OpenAPISpec } from "effect/http-api/OpenApi"
import { describe, expect, it } from "vitest"
import { generatedClientMethods } from "../../../tools/generate-clients.ts"

describe("generated client method detection", () => {
  it("recognizes single signatures and overloaded callable properties, not data properties", () => {
    const source = `export interface Client {
  readonly httpClient: HttpClient.HttpClient
  readonly "Legacy": <Options>(options: Options) => Effect.Effect<void>
  readonly "Overloaded": {
    <Options>(options: Options): Effect.Effect<void>;
    <Options>(options?: Options): Effect.Effect<void>;
  }
  readonly "Stream": () => Stream.Stream<Uint8Array>
  readonly "Status": string
  readonly "Payload": { readonly value: string }
}`

    expect([...generatedClientMethods(source)]).toEqual(["Legacy", "Overloaded", "Stream"])
  })

  it("recognizes every operation emitted by the installed generator", async () => {
    const document: OpenAPISpec = {
      openapi: "3.1.0",
      info: { title: "Method detection", version: "1.0.0" },
      components: { schemas: {}, securitySchemes: {} },
      security: [],
      tags: [{ name: "Items" }],
      paths: {
        "/items": {
          get: {
            operationId: "ListItems",
            parameters: [],
            tags: ["Items"],
            security: [],
            responses: { "204": { description: "No content" } },
          },
          post: {
            operationId: "CreateItem",
            parameters: [],
            tags: ["Items"],
            security: [],
            requestBody: {
              required: true,
              content: { "application/json": { schema: { type: "string" } } },
            },
            responses: { "204": { description: "No content" } },
          },
        },
      },
    }
    const source = await Effect.gen(function* () {
      const generator = yield* OpenApiGenerator.OpenApiGenerator
      return yield* generator.generate(document, { format: "httpclient", name: "TestApi" })
    }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema), Effect.runPromise)

    expect([...generatedClientMethods(source)]).toEqual(["ListItems", "CreateItem"])
  })
})

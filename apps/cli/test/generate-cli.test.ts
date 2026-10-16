import { camelize } from "@effect/openapi-generator/Utils"
import type { OpenAPISpec } from "effect/http-api/OpenApi"
import { describe, expect, it } from "vitest"
import { generateCliFiles, type CliSourceDocument } from "../../../tools/generate-cli.ts"

interface SyntheticOverride {
  readonly description?: string
  readonly index: number
  readonly operationId?: string
  readonly parameters?: ReadonlyArray<unknown>
  readonly requestBody?: object
}

// Synthetic Operation Documents exercise the real generation entry point; every
// Operation gets a unique path so route policy stays collision-free.
const syntheticDocument = (
  count: number,
  overrides: ReadonlyArray<SyntheticOverride> = [],
): OpenAPISpec => {
  const paths: Record<string, unknown> = {}
  for (let index = 0; index < count; index++) {
    const override = overrides.find((candidate) => candidate.index === index)
    paths[`/v0/test/action-${index}`] = {
      get: {
        description: override?.description,
        operationId: override?.operationId ?? `Test Op ${index}`,
        parameters: [...(override?.parameters ?? [])],
        requestBody: override?.requestBody,
        responses: {},
        tags: ["Test"],
      },
    }
  }
  return {
    components: {
      schemas: {
        BinaryFile: { type: "string", format: "binary" },
        Address: { type: "string", minLength: 3 },
      },
    },
    paths,
  } as unknown as OpenAPISpec
}

const syntheticDocuments = (
  publicOverrides: ReadonlyArray<SyntheticOverride>,
): ReadonlyArray<CliSourceDocument> => {
  const publicOperationIds = Array.from(
    { length: 17 },
    (_, index) =>
      publicOverrides.find((candidate) => candidate.index === index)?.operationId ??
      `Test Op ${index}`,
  )
  return [
    {
      clientMethods: new Set(publicOperationIds.map(camelize)),
      document: syntheticDocument(17, publicOverrides),
      family: "public",
    },
    {
      clientMethods: new Set(
        Array.from({ length: 27 }, (_, index) => camelize(`Test Op ${index}`)),
      ),
      document: syntheticDocument(27),
      family: "investor",
    },
    {
      clientMethods: new Set(
        Array.from({ length: 72 }, (_, index) => camelize(`Test Op ${index}`)),
      ),
      document: syntheticDocument(72),
      family: "distributor",
    },
  ]
}

describe("generated CLI source invariants", () => {
  const unionParameterOverride = (schema: object): SyntheticOverride => ({
    index: 0,
    parameters: [{ in: "query", name: "address", required: true, schema }],
  })

  it("preserves checks in nested string unions, including referenced branches", () => {
    const content = generateCliFiles(
      syntheticDocuments([
        unionParameterOverride({
          anyOf: [
            { type: "string", title: "Ethereum address", format: "uuid" },
            {
              anyOf: [
                { $ref: "#/components/schemas/Address" },
                { type: "string", enum: ["known"], minLength: 2 },
                { type: "string", title: "Day" },
              ],
            },
          ],
          minLength: 1,
        }),
      ]),
    )[0]?.content
    expect(content).toContain(
      'Flag.withSchema(Schema.Union([Schema.String.check(Schema.isUUID()), Schema.Union([Schema.String.check(Schema.isMinLength(3)), Schema.Literals(["known"]).check(Schema.isMinLength(2)), Schema.String.check(Schema.isPattern(/^\\d{4}-\\d{2}-\\d{2}$/))])]).check(Schema.isMinLength(1)))',
    )
  })

  it.each([
    { type: "number" },
    { type: "string", pattern: "^0x" },
    { type: "string", maxLength: 42 },
    { type: "string", format: "email" },
    { type: "string", minLength: "3" },
    { type: "string", enum: [1] },
    { type: "string", const: "fixed" },
    { anyOf: [] },
    { $ref: "#/components/schemas/BinaryFile" },
    { $ref: "#/components/schemas/Address", minLength: 5 },
  ])("fails closed on an unsupported nested union branch: %j", (branch) => {
    expect(() =>
      generateCliFiles(
        syntheticDocuments([
          unionParameterOverride({
            anyOf: [{ type: "string" }, { anyOf: [branch] }],
          }),
        ]),
      ),
    ).toThrow(/Test Op 0 GET \/v0\/test\/action-0: address: /)
  })

  it("rejects unsupported constraints on the union itself", () => {
    expect(() =>
      generateCliFiles(
        syntheticDocuments([
          unionParameterOverride({ anyOf: [{ type: "string" }], maxLength: 42 }),
        ]),
      ),
    ).toThrow("address: unsupported parameter constraint(s): maxLength")
  })

  const multipartOverride = (
    fileSchema: object,
    description = "Supported extensions are: PDF, png.",
  ): SyntheticOverride => ({
    description,
    index: 0,
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: { file: fileSchema },
            required: ["file"],
          },
        },
      },
    },
  })

  it.each([
    {
      shape: "scalar binary",
      schema: { type: "string", format: "binary" },
      payload: "file",
    },
    {
      shape: "legacy single-file array",
      schema: {
        type: "array",
        items: { $ref: "#/components/schemas/BinaryFile" },
        minItems: 1,
        maxItems: 1,
      },
      payload: "[file]",
    },
  ])("renders a $shape upload with a strict single file flag", ({ schema, payload }) => {
    const content = generateCliFiles(syntheticDocuments([multipartOverride(schema)]))[0]?.content
    expect(content).toContain('Flag.String("file").pipe(\n          Flag.between(1, 1),')
    expect(content).toContain('Flag.withMetavar("FILE")')
    expect(content).toContain("Accepted extensions: pdf, png. Exactly one file.")
    expect(content).toContain('readMultipartFile(input["file"][0] ?? "", ["pdf","png"])')
    expect(content).toContain(`Effect.map((file) => ({ ...input, ["file"]: ${payload} }))`)
    expect(content).toContain('payload: { "file": input["file"] }')
  })

  it.each([
    { minItems: undefined, maxItems: undefined },
    { minItems: 0, maxItems: 1 },
    { minItems: 1, maxItems: 2 },
  ])("rejects file arrays without exactly-one bounds: %j", (bounds) => {
    expect(() =>
      generateCliFiles(
        syntheticDocuments([
          multipartOverride({
            type: "array",
            items: { $ref: "#/components/schemas/BinaryFile" },
            ...bounds,
          }),
        ]),
      ),
    ).toThrow("Multipart file field file must require exactly one file")
  })

  it("requires supported extensions for scalar binary uploads", () => {
    expect(() =>
      generateCliFiles(
        syntheticDocuments([multipartOverride({ type: "string", format: "binary" }, "Upload")]),
      ),
    ).toThrow("binary multipart fields require supported extensions in the OpenAPI description")
  })

  it("renders one export per synthetic Operation", () => {
    const files = generateCliFiles(syntheticDocuments([]))
    expect(files.map(({ path }) => path)).toEqual([
      "apps/cli/src/generated/public.ts",
      "apps/cli/src/generated/investor.ts",
      "apps/cli/src/generated/distributor.ts",
    ])
    expect(files[0]?.content.match(/^export const /gm)).toHaveLength(18)
    expect(files[0]?.content.match(/defineOperation\(/gm)).toHaveLength(17)
    expect(files[0]?.content).toContain("export const PublicOperations = [")
  })

  it("fails generation when an operationId is not a valid TypeScript identifier", () => {
    expect(() =>
      generateCliFiles(syntheticDocuments([{ index: 3, operationId: "123" }])),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid generated identifier(s): 123 GET /v0/test/action-3 -> ""]`,
    )
  })

  it("fails generation when an operationId collides with a reserved word", () => {
    expect(() =>
      generateCliFiles(syntheticDocuments([{ index: 3, operationId: "default" }])),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid generated identifier(s): default GET /v0/test/action-3 -> "default"]`,
    )
  })

  it("identifies the Operation when an unsupported parameter shape fails generation", () => {
    expect(() =>
      generateCliFiles(
        syntheticDocuments([
          {
            index: 7,
            parameters: [
              {
                description: "a weird parameter",
                in: "query",
                name: "weird",
                required: false,
                schema: { format: "int64", type: "string" },
              },
            ],
          },
        ]),
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Test Op 7 GET /v0/test/action-7: weird: unsupported parameter format "int64"]`,
    )
  })
})

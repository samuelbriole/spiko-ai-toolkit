export type GeneratedClientFamily = "distributor" | "investor" | "public"

const replaceExactlyOnce = (
  label: string,
  source: string,
  expected: string,
  replacement: string,
): string => {
  const first = source.indexOf(expected)
  const last = source.lastIndexOf(expected)
  if (first === -1 || first !== last) {
    throw new Error(
      `${label}: expected one generated client fragment but found ${first === -1 ? 0 : "multiple"}: ${expected}`,
    )
  }
  return source.replace(expected, replacement)
}

export const fixGeneratedClient = (family: GeneratedClientFamily, generated: string): string => {
  if (family !== "distributor") return generated

  // The generator still renders this referenced multipart binary schema as a
  // string. Preserve file bytes with an identity schema over globalThis.File.
  const withFiles = replaceExactlyOnce(
    "Distributor generated client",
    generated,
    'export type PersistedFileMultipart = string\nexport const PersistedFileMultipart = Schema.String.annotate({ "format": "binary", "identifier": "PersistedFileMultipart" })',
    'export type PersistedFileMultipart = globalThis.File\nexport const PersistedFileMultipart = Schema.instanceOf(globalThis.File).annotate({ "format": "binary", "identifier": "PersistedFileMultipart" })',
  )
  return replaceExactlyOnce(
    "Distributor generated client",
    withFiles,
    "HttpClientRequest.bodyFormDataRecord(options.payload as any)",
    "HttpClientRequest.bodyFormDataRecord(options.payload)",
  )
}

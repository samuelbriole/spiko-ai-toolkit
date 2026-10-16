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

  return replaceExactlyOnce(
    "Distributor generated client",
    generated,
    "HttpClientRequest.bodyFormDataRecord(options.payload as any)",
    "HttpClientRequest.bodyFormDataRecord(options.payload)",
  )
}

export function debugAuth(event: string, data: Record<string, unknown> = {}) {
  console.debug(`[docxer] ${event}`, data)
}

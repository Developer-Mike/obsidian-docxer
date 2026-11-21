import { TFile } from "obsidian"
import DocxerPlugin from "src/main"
import { fileVersion, versionsEqual } from "./docx-unlock-cache"

const MAX_METADATA_RETRIES = 2

export async function readDocxBuffer(
  plugin: DocxerPlugin,
  file: TFile,
  options: { prompt: boolean } = { prompt: true },
): Promise<ArrayBuffer | null> {
  const epoch = plugin.sessionEpoch
  for (let attempt = 0; attempt <= MAX_METADATA_RETRIES; attempt++) {
    if (plugin.sessionEpoch !== epoch) return null
    const versionBefore = fileVersion(file)
    const raw = await plugin.app.vault.readBinary(file)
    if (plugin.sessionEpoch !== epoch) return null
    const version = fileVersion(file)
    if (!versionsEqual(versionBefore, version)) {
      if (attempt < MAX_METADATA_RETRIES) continue
      return null
    }
    const authorized = await plugin.getAuthorizedDocument(file, raw, version, options)
    if (plugin.sessionEpoch !== epoch) return null
    if (!versionsEqual(version, fileVersion(file))) {
      if (attempt < MAX_METADATA_RETRIES) continue
      return null
    }
    return authorized?.buffer ?? null
  }
  return null
}

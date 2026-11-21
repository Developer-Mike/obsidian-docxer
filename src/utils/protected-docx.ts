import { TFile } from "obsidian"
import DocxerPlugin from "src/main"
import { FileVersion, fileVersion, versionsEqual, zeroArrayBuffer } from "./docx-unlock-cache"

const MAX_METADATA_RETRIES = 2

export type DocxReadResult =
  | { status: "ok", buffer: ArrayBuffer, version: FileVersion, sessionEpoch: number, encrypted: boolean }
  | { status: "locked" }
  | { status: "stale" }

export function isAuthorizedReadCurrent(
  plugin: DocxerPlugin,
  file: TFile,
  version: FileVersion,
  sessionEpoch: number,
  encrypted: boolean,
): boolean {
  if (plugin.sessionEpoch !== sessionEpoch) return false
  const liveFile = plugin.app.vault.getAbstractFileByPath(version.path)
  if (!(liveFile instanceof TFile) || liveFile !== file) return false
  if (!versionsEqual(version, fileVersion(liveFile))) return false
  if (encrypted && !plugin.canReveal(version)) return false
  return true
}

export async function readDocxBuffer(
  plugin: DocxerPlugin,
  file: TFile,
  options: { prompt: boolean } = { prompt: true },
): Promise<DocxReadResult> {
  const epoch = plugin.sessionEpoch
  for (let attempt = 0; attempt <= MAX_METADATA_RETRIES; attempt++) {
    if (plugin.sessionEpoch !== epoch) return { status: "stale" }
    const liveBefore = plugin.app.vault.getAbstractFileByPath(file.path)
    if (!(liveBefore instanceof TFile) || liveBefore !== file) return { status: "stale" }

    const versionBefore = fileVersion(file)
    const raw = await plugin.app.vault.readBinary(file)
    if (plugin.sessionEpoch !== epoch) return { status: "stale" }
    const version = fileVersion(file)
    if (!versionsEqual(versionBefore, version)) {
      if (attempt < MAX_METADATA_RETRIES) continue
      return { status: "stale" }
    }
    const authorized = await plugin.getAuthorizedDocument(file, raw, version, options)
    if (plugin.sessionEpoch !== epoch) {
      if (authorized?.encrypted) zeroArrayBuffer(authorized.buffer)
      return { status: "stale" }
    }
    if (!versionsEqual(version, fileVersion(file))) {
      if (authorized?.encrypted) zeroArrayBuffer(authorized.buffer)
      if (attempt < MAX_METADATA_RETRIES) continue
      return { status: "stale" }
    }
    if (!authorized) return { status: "locked" }
    if (!isAuthorizedReadCurrent(plugin, file, authorized.version, epoch, authorized.encrypted)) {
      if (authorized.encrypted) zeroArrayBuffer(authorized.buffer)
      return { status: "stale" }
    }
    return {
      status: "ok",
      buffer: authorized.buffer,
      version: authorized.version,
      sessionEpoch: epoch,
      encrypted: authorized.encrypted,
    }
  }
  return { status: "stale" }
}

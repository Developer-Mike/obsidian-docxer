export type FileVersion = {
  path: string
  mtime: number
  size: number
}

export type UnlockRecord = {
  sessionEpoch: number
  path: string
  mtime: number
  size: number
  decrypted: ArrayBuffer
}

export default class DocxUnlockCache {
  private records = new Map<string, UnlockRecord>()

  get(sessionEpoch: number, version: FileVersion): ArrayBuffer | undefined {
    const record = this.records.get(version.path)
    if (!this.matches(record, sessionEpoch, version)) return undefined
    return copyArrayBuffer(record.decrypted)
  }

  hasGrant(sessionEpoch: number, version: FileVersion): boolean {
    return this.matches(this.records.get(version.path), sessionEpoch, version)
  }

  set(sessionEpoch: number, version: FileVersion, decrypted: ArrayBuffer) {
    const existing = this.records.get(version.path)
    if (existing) zeroArrayBuffer(existing.decrypted)
    this.records.set(version.path, {
      sessionEpoch,
      path: version.path,
      mtime: version.mtime,
      size: version.size,
      decrypted: copyArrayBuffer(decrypted),
    })
  }

  delete(path: string): boolean {
    const existing = this.records.get(path)
    if (!existing) return false
    zeroArrayBuffer(existing.decrypted)
    return this.records.delete(path)
  }

  clear() {
    for (const record of this.records.values()) {
      zeroArrayBuffer(record.decrypted)
    }
    this.records.clear()
  }

  private matches(record: UnlockRecord | undefined, sessionEpoch: number, version: FileVersion): record is UnlockRecord {
    return !!record
      && record.sessionEpoch === sessionEpoch
      && record.path === version.path
      && record.mtime === version.mtime
      && record.size === version.size
  }
}

export function copyArrayBuffer(data: ArrayBuffer): ArrayBuffer {
  return data.slice(0)
}

export function zeroArrayBuffer(data: ArrayBuffer | null | undefined) {
  if (!data || data.byteLength === 0) return
  new Uint8Array(data).fill(0)
}

export function fileVersion(file: { path: string, stat: { mtime: number, size: number } }): FileVersion {
  return { path: file.path, mtime: file.stat.mtime, size: file.stat.size }
}

export function versionsEqual(a: FileVersion, b: FileVersion): boolean {
  return a.path === b.path && a.mtime === b.mtime && a.size === b.size
}

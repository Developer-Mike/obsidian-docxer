import DocxFileView from "./convertable-file-views/docx"
import ConvertibleFileView from "./core/convertible-file-view"
import DocxerEmbedComponent from "./core/docxer-embed-component"
import SettingsManager from "./settings"
import DocxUnlockCache, { FileVersion, zeroArrayBuffer } from "./utils/docx-unlock-cache"
import { decryptDocx, IncorrectPasswordError, isEncryptedDocx, UnsupportedEncryptionError } from "./utils/docx-encryption"
import { promptForDocxPassword } from "./ui/password-modal"
import { Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian"

export const FILETYPE_MAP: { [key: string]: new(leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView } = {
  "docx": DocxFileView
}

export type AuthorizedDocument = {
  version: FileVersion
  encrypted: boolean
  buffer: ArrayBuffer
}

type InflightUnlock = {
  epoch: number
  path: string
  promise: Promise<boolean>
  cancel: (() => void) | null
}

export default class DocxerPlugin extends Plugin {
  settings: SettingsManager
  // sessionEpoch invalidates all grants, caches, and in-flight opens on quit/unload.
  sessionEpoch = 0
  // Session-scoped decrypted byte copies keyed by path + mtime/size (passwords are never cached).
  unlockCache = new DocxUnlockCache()
  private sessionEnded = false
  private inflightUnlocks = new Map<string, InflightUnlock>()
  private passwordCancels = new Set<() => void>()
  private surfaces = new Set<ConvertibleFileView>()
  private embeds = new Set<DocxerEmbedComponent>()
  private registeredEmbedExtensions: Array<{ extension: string, creator: unknown }> = []

  private resetSessionState() {
    this.sessionEpoch += 1
    this.unlockCache.clear()
    const cancels = [...this.passwordCancels]
    this.passwordCancels.clear()
    this.inflightUnlocks.clear()
    for (const cancel of cancels) {
      try {
        cancel()
      } catch {
        // Modal may already be closed during quit.
      }
    }
  }

  beginSession() {
    this.sessionEnded = false
    this.resetSessionState()
  }

  endSession() {
    if (this.sessionEnded) return
    this.sessionEnded = true
    this.resetSessionState()

    const views = new Set<ConvertibleFileView>(this.surfaces)
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view instanceof ConvertibleFileView) {
          views.add(leaf.view)
        }
      })
    } catch {
      // Workspace may already be tearing down during quit.
    }

    for (const view of views) {
      try {
        view.invalidate("This document is password protected.")
      } catch {
        // View may already be detached during shutdown.
      }
    }
    for (const embed of [...this.embeds]) {
      try {
        embed.invalidate("This document is password protected.")
      } catch {
        // Embed container may already be detached during shutdown.
      }
    }
  }

  registerSurface(view: ConvertibleFileView) {
    this.surfaces.add(view)
  }

  unregisterSurface(view: ConvertibleFileView) {
    this.surfaces.delete(view)
  }

  registerEmbed(embed: DocxerEmbedComponent) {
    this.embeds.add(embed)
  }

  unregisterEmbed(embed: DocxerEmbedComponent) {
    this.embeds.delete(embed)
  }

  canReveal(version: FileVersion): boolean {
    return this.unlockCache.hasGrant(this.sessionEpoch, version)
  }

  getAuthorizedDocument(
    file: TFile,
    raw: ArrayBuffer,
    version: FileVersion,
    options: { prompt?: boolean } = {},
  ): Promise<AuthorizedDocument | null> {
    return this.authorizeDocument(file, raw, version, options)
  }

  private async authorizeDocument(
    file: TFile,
    raw: ArrayBuffer,
    version: FileVersion,
    options: { prompt?: boolean },
  ): Promise<AuthorizedDocument | null> {
    if (!isEncryptedDocx(raw)) {
      return { version, encrypted: false, buffer: raw }
    }

    const cached = this.unlockCache.get(this.sessionEpoch, version)
    if (cached) {
      return { version, encrypted: true, buffer: cached }
    }

    if (this.sessionEnded || !(options.prompt ?? true)) return null

    const unlocked = await this.unlockEncryptedDocx(file, raw, version)
    if (!unlocked || this.sessionEnded) return null
    const buffer = this.unlockCache.get(this.sessionEpoch, version)
    if (!buffer) return null
    return { version, encrypted: true, buffer }
  }

  async unlockEncryptedDocx(file: TFile, raw: ArrayBuffer, version: FileVersion): Promise<boolean> {
    if (this.sessionEnded) return false
    const epoch = this.sessionEpoch
    const key = `${epoch}:${version.path}:${version.mtime}:${version.size}`
    const existing = this.inflightUnlocks.get(key)
    if (existing) return existing.promise

    const entry: InflightUnlock = {
      epoch,
      path: version.path,
      promise: null as unknown as Promise<boolean>,
      cancel: null,
    }
    const work = Promise.resolve().then(() => this.promptAndDecrypt(file, raw, version, epoch, key, entry))
    entry.promise = work
    this.inflightUnlocks.set(key, entry)
    try {
      return await work
    } finally {
      if (this.inflightUnlocks.get(key) === entry) this.inflightUnlocks.delete(key)
    }
  }

  private async promptAndDecrypt(
    file: TFile,
    raw: ArrayBuffer,
    version: FileVersion,
    epoch: number,
    key: string,
    entry: InflightUnlock,
  ): Promise<boolean> {
    if (this.inflightUnlocks.get(key) !== entry || this.sessionEpoch !== epoch) return false

    let unlocked = false
    const prompt = promptForDocxPassword(this.app, file.basename, (password) => {
      if (this.inflightUnlocks.get(key) !== entry || this.sessionEpoch !== epoch) {
        return { status: "abort" }
      }

      try {
        const decrypted = decryptDocx(raw, password)
        try {
          if (this.inflightUnlocks.get(key) !== entry || this.sessionEpoch !== epoch) {
            return { status: "abort" }
          }
          this.unlockCache.set(epoch, version, decrypted)
          unlocked = true
          return { status: "ok" }
        } finally {
          zeroArrayBuffer(decrypted)
        }
      } catch (error) {
        if (error instanceof IncorrectPasswordError) {
          return { status: "error", message: "Incorrect password." }
        }
        if (error instanceof UnsupportedEncryptionError) {
          return { status: "abort", message: error.message }
        }
        throw error
      }
    })

    entry.cancel = prompt.cancel
    this.passwordCancels.add(prompt.cancel)
    try {
      await prompt.promise
    } finally {
      if (entry.cancel === prompt.cancel) entry.cancel = null
      this.passwordCancels.delete(prompt.cancel)
    }

    if (this.inflightUnlocks.get(key) !== entry || this.sessionEpoch !== epoch) return false
    return unlocked
  }

  private revokeInflightForPaths(paths: Set<string>) {
    for (const [key, entry] of [...this.inflightUnlocks.entries()]) {
      if (!paths.has(entry.path)) continue
      this.inflightUnlocks.delete(key)
      const cancel = entry.cancel
      entry.cancel = null
      if (cancel) {
        this.passwordCancels.delete(cancel)
        try {
          cancel()
        } catch {
          // Modal may already be closed.
        }
      }
    }
  }

  private forgetFile(oldPath: string, newPath?: string, reason: "modify" | "delete" | "rename" = "modify") {
    const paths = new Set<string>([oldPath])
    if (newPath) paths.add(newPath)

    for (const path of paths) {
      this.unlockCache.delete(path)
    }

    this.revokeInflightForPaths(paths)
    const message = reason === "delete"
      ? "This file is no longer available."
      : "This document changed and must be reopened."
    const allowReopen = reason !== "delete"

    for (const view of [...this.surfaces]) {
      if (view.file && paths.has(view.file.path)) {
        view.invalidate(message, allowReopen ? { actionLabel: "Reopen" } : {})
      }
    }
    for (const embed of [...this.embeds]) {
      if (paths.has(embed.file.path)) {
        embed.invalidate(message, allowReopen ? { offerUnlock: true, actionLabel: "Reopen" } : {})
      }
    }
  }

	async onload() {
    this.beginSession()
    this.settings = new SettingsManager(this)
    await this.settings.loadSettings()
    this.settings.addSettingsTab()

    this.registerEvent(this.app.workspace.on("quit", () => this.endSession()))
    this.registerDomEvent(window, "beforeunload", () => this.endSession())
    this.registerEvent(this.app.vault.on("modify", (file: TAbstractFile) => {
      if (file instanceof TFile) this.forgetFile(file.path, file.path, "modify")
    }))
    this.registerEvent(this.app.vault.on("delete", (file: TAbstractFile) => {
      if (file instanceof TFile) this.forgetFile(file.path, file.path, "delete")
    }))
    this.registerEvent(this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      const nextPath = file instanceof TFile ? file.path : undefined
      this.forgetFile(oldPath, nextPath, "rename")
    }))

    for (const [fileExtension, viewClass] of Object.entries(FILETYPE_MAP)) {
      this.registerView((viewClass as any).VIEW_TYPE_ID, (leaf) => new viewClass(leaf, this))
      this.registerExtensions([fileExtension], (viewClass as any).VIEW_TYPE_ID)

      if (!DocxerEmbedComponent.isEmbeddable(viewClass)) continue

      const embedRegistry = (this.app as any).embedRegistry
      if (!embedRegistry) continue
      const creator = (info: any, file: TFile, subpath: string) => new DocxerEmbedComponent(this, viewClass, info, file, subpath)
      embedRegistry.unregisterExtension(fileExtension)
      embedRegistry.registerExtension(fileExtension, creator)
      this.registeredEmbedExtensions.push({ extension: fileExtension, creator })
    }
	}

  onunload() {
    const embedRegistry = (this.app as any).embedRegistry
    for (const { extension, creator } of this.registeredEmbedExtensions) {
      try {
        const current = embedRegistry?.embedByExtension?.[extension]
        if (!current || current === creator) {
          embedRegistry?.unregisterExtension?.(extension)
        }
      } catch {
        // Ignore if Obsidian already tore down embedRegistry.
      }
    }
    this.registeredEmbedExtensions = []
    this.endSession()
  }
}

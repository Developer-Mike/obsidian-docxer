import DocxerPlugin from "src/main"
import ConvertibleFileView from "./convertible-file-view"
import { Component, TFile, WorkspaceLeaf } from "obsidian"
import type { AuthorizedPreview } from "./convertible-file-view"

type PreviewProviderClass = {
  getAuthorizedPreview: (
    plugin: DocxerPlugin,
    file: TFile,
    options?: {
      promptForPassword?: boolean
      isCurrent?: () => boolean
    },
  ) => Promise<AuthorizedPreview | null>
}

export default class DocxerEmbedComponent extends Component {
  plugin: DocxerPlugin
  view: new (leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView

  info: any
  file: TFile
  subpath: string
  private loadGeneration = 0
  private unloaded = false
  private coverEl: HTMLElement | null = null
  private previewHost: HTMLElement | null = null
  private previewDispose: (() => void) | null = null

  constructor(plugin: DocxerPlugin, view: new (leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView, info: any, file: TFile, subpath: string) {
    super()

    this.plugin = plugin
    this.view = view

    this.info = info
    this.file = file
    this.subpath = subpath

    info.containerEl.addClass("docxer-embed")
    this.plugin.registerEmbed(this)
    this.register(() => this.plugin.unregisterEmbed(this))
    this.ensureSurface()
    this.lockSurface("Opening document…")
  }

  onload() {
    this.unloaded = false
    super.onload()
  }

  onunload() {
    this.unloaded = true
    this.loadGeneration += 1
    this.disposeActivePreview()
    this.clearExistingSurface()
    this.previewHost = null
    this.coverEl = null
    this.plugin.unregisterEmbed(this)
    super.onunload()
  }

  invalidate(message = "This document is password protected.", options: { offerUnlock?: boolean, actionLabel?: string } = {}) {
    this.loadGeneration += 1
    this.disposeActivePreview()
    if (!this.isSurfaceLive()) {
      this.clearExistingSurface()
      return
    }
    if (options.offerUnlock) {
      this.showActionCover(this.file, message, options.actionLabel ?? "Unlock", true)
    } else {
      this.lockSurface(message)
    }
  }

  async loadFile() {
    // Embeds never auto-prompt so opening a note with protected embeds does not stack password modals.
    await this.runLoad(this.file, false)
  }

  private async runLoad(file: TFile, promptForPassword: boolean) {
    if (this.unloaded) return
    const generation = ++this.loadGeneration
    const epoch = this.plugin.sessionEpoch
    const expectedPath = file.path
    this.ensureSurface()
    this.lockSurface(promptForPassword ? `"${file.basename}" is password protected.` : "Opening document…")

    const previewClass = this.view as unknown as PreviewProviderClass
    try {
      const result = await previewClass.getAuthorizedPreview(this.plugin, file, {
        promptForPassword,
        isCurrent: () => this.isCurrent(generation, epoch, file, expectedPath),
      })
      this.commit(generation, epoch, file, expectedPath, result, promptForPassword)
    } catch (error) {
      if (!this.isCurrent(generation, epoch, file, expectedPath)) return
      const message = error instanceof Error ? error.message : "Failed to open this document."
      this.showActionCover(file, message, "Retry", promptForPassword, true)
    }
  }

  private commit(
    generation: number,
    epoch: number,
    file: TFile,
    expectedPath: string,
    result: AuthorizedPreview | null,
    promptForPassword: boolean,
  ) {
    if (!this.isCurrent(generation, epoch, file, expectedPath)) {
      if (result?.kind === "preview") result.dispose()
      return
    }

    if (!result) {
      this.showActionCover(file, `"${file.basename}" is password protected.`, "Unlock", true)
      return
    }

    if (result.kind === "locked") {
      this.showActionCover(file, result.message ?? `"${file.basename}" is password protected.`, "Unlock", true)
      return
    }

    if (result.kind === "error") {
      const retryLabel = (result.retryable ?? true) ? "Retry" : null
      this.showActionCover(file, result.message || "Failed to open this document.", retryLabel, promptForPassword, true)
      return
    }

    if (result.encrypted && !this.plugin.canReveal(result.version)) {
      result.dispose()
      this.showActionCover(file, `"${file.basename}" is password protected.`, "Unlock", true)
      return
    }

    if (!this.isSurfaceLive()) {
      result.dispose()
      return
    }

    this.ensureSurface()
    const previewHost = this.previewHost
    if (!previewHost) {
      result.dispose()
      return
    }
    this.disposeActivePreview()
    this.safeEmpty(previewHost)
    previewHost.appendChild(result.el)
    this.previewDispose = result.dispose
    this.info.containerEl.removeClass("is-locked")
  }

  private showActionCover(
    file: TFile,
    message: string,
    actionLabel: string | null,
    promptOnClick: boolean,
    isError = false,
  ) {
    this.lockSurface(message, isError)
    if (!actionLabel || !this.coverEl || !this.isSurfaceLive()) return
    const expectedPath = file.path
    const button = document.createElement("button")
    button.innerText = actionLabel
    button.onclick = () => {
      if (this.unloaded || this.file.path !== expectedPath) return
      void this.runLoad(this.file, promptOnClick)
    }
    this.coverEl.appendChild(button)
  }

  private isCurrent(generation: number, epoch: number, file: TFile, expectedPath: string) {
    return !this.unloaded
      && this.loadGeneration === generation
      && this.plugin.sessionEpoch === epoch
      && this.file.path === expectedPath
      && file.path === expectedPath
  }

  lockSurface(message: string, isError = false) {
    this.disposeActivePreview()
    if (!this.isSurfaceLive()) return
    try {
      this.ensureSurface()
      const previewHost = this.previewHost
      const coverEl = this.coverEl
      if (!previewHost || !coverEl) return
      this.safeEmpty(previewHost)
      this.safeEmpty(coverEl)
      coverEl.toggleClass("is-error", isError)
      const text = document.createElement("p")
      text.innerText = message
      coverEl.appendChild(text)
      this.info.containerEl.addClass("is-locked")
    } catch {
      // Ignore if container is already detached.
    }
  }

  private disposeActivePreview() {
    const dispose = this.previewDispose
    this.previewDispose = null
    if (!dispose) return
    try {
      dispose()
    } catch {
      // Ignore observer teardown errors during embed unload.
    }
  }

  private clearExistingSurface() {
    if (this.previewHost) this.safeEmpty(this.previewHost)
    if (this.coverEl) this.safeEmpty(this.coverEl)
    try {
      this.info?.containerEl?.addClass("is-locked")
    } catch {
      // Ignore if container is already detached.
    }
  }

  private safeEmpty(el: HTMLElement) {
    try {
      el.empty()
    } catch {
      el.innerHTML = ""
    }
  }

  private isSurfaceLive(): boolean {
    return !this.unloaded && !!this.info?.containerEl
  }

  private ensureSurface() {
    if (!this.isSurfaceLive()) return
    const root = this.info.containerEl as HTMLElement
    root.addClass("docxer-embed")
    root.addClass("docxer-content")
    if (!this.previewHost || !root.contains(this.previewHost)) {
      this.previewHost = document.createElement("div")
      this.previewHost.className = "docxer-preview-host"
      root.appendChild(this.previewHost)
    }
    if (!this.coverEl || !root.contains(this.coverEl)) {
      this.coverEl = document.createElement("div")
      this.coverEl.className = "docxer-locked docxer-locked-cover"
      root.appendChild(this.coverEl)
    }
  }

  static isEmbeddable(view: new (leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView) {
    return (view as any).getAuthorizedPreview !== undefined || (view as any).getFilePreview !== undefined
  }
}

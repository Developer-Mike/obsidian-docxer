import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian"
import DocxerPlugin from "src/main"
import FileUtils from "src/utils/file-utils"
import { FileVersion } from "src/utils/docx-unlock-cache"
import { debugAuth } from "src/utils/auth-debug"

export type LoadToken = {
  generation: number
  sessionEpoch: number
  file: TFile
  path: string
}

export type PreviewCommit = {
  el: HTMLElement
  dispose: () => void
  encrypted: boolean
  version: FileVersion
}

export type AuthorizedPreview =
  | { kind: "preview", el: HTMLElement, dispose: () => void, encrypted: boolean, version: FileVersion }
  | { kind: "locked", version: FileVersion, message?: string }
  | { kind: "error", message: string, retryable?: boolean, version: FileVersion }

export default abstract class ConvertibleFileView extends FileView {
  plugin: DocxerPlugin
  header: HTMLElement | null = null
  private lastTitle = "Word document"
  content: HTMLElement | null = null
  protected coverEl: HTMLElement | null = null
  protected previewHost: HTMLElement | null = null
  private previewDispose: (() => void) | null = null
  private loadGeneration = 0
  private unloaded = false

	constructor(leaf: WorkspaceLeaf, plugin: DocxerPlugin) {
		super(leaf)
    this.plugin = plugin
	}

  onload() {
    this.unloaded = false
    super.onload()
    this.plugin.registerSurface(this)
    this.ensureSurface()
    this.lockSurface("Opening document…")
  }

  onunload() {
    this.unloaded = true
    this.discardPending()
    this.disposeActivePreview()
    this.clearExistingSurface()
    this.plugin.unregisterSurface(this)
    super.onunload()
  }

	getDisplayText(): string {
		if (this.file?.basename) {
      this.lastTitle = this.file.basename
      return this.file.basename
    }
		return this.lastTitle
	}

	getContext(file?: TFile) {
		return file?.path ?? this.file?.path ?? ""
	}

  getState() {
    return super.getState()
  }

  async onOpen() {
    this.ensureSurface()
    this.lockSurface("Opening document…")
		await super.onOpen()
    this.ensureSurface()
    if (!this.header) {
      this.header = document.createElement("div")
      this.header.className = "docxer-header"

      const text = document.createElement("span")
      text.innerText = "This is a preview. To edit, convert it to markdown."
      this.header.appendChild(text)

      const convertButton = document.createElement("button")
      convertButton.className = "docxer-convert-button"
      convertButton.innerText = "Convert"
      convertButton.onclick = () => this.convertFile()
      this.header.appendChild(convertButton)

      this.containerEl.insertAfter(this.header, this.containerEl.firstChild)
    }
  }

	async onClose() {
    this.unloaded = true
    this.discardPending()
    this.disposeActivePreview()
    this.clearExistingSurface()
    try {
      await super.onClose()
    } finally {
      try {
        this.header?.remove()
      } catch {
        // The leaf may already be detached while Obsidian is quitting.
      }
      this.header = null
      this.content = null
      this.coverEl = null
      this.previewHost = null
      this.plugin.unregisterSurface(this)
    }
	}

  abstract getFilePreview(file: TFile, token: LoadToken): Promise<AuthorizedPreview | null>

	async onLoadFile(file: TFile) {
    const token = this.beginLoad(file)
    this.lockSurface("Opening document…")
    debugAuth("view-load", { path: file.path, sessionEpoch: token.sessionEpoch, generation: token.generation })
		await super.onLoadFile(file)
    if (!this.isCurrent(token, file)) return

    await this.loadAndCommit(file, token)
	}

  protected async loadAndCommit(file: TFile, token: LoadToken) {
    try {
      const result = await this.getFilePreview(file, token)
      if (!this.isCurrent(token, file)) {
        if (result?.kind === "preview") result.dispose()
        return
      }
      if (!result) return
      this.commitPreview(token, file, result)
    } catch (error) {
      if (!this.isCurrent(token, file)) return
      const message = error instanceof Error ? error.message : "Failed to open this document."
      this.showErrorAction(file, message)
    }
  }

  protected commitPreview(token: LoadToken, file: TFile, result: AuthorizedPreview) {
    if (result.kind === "locked") {
      this.showUnlockAction(file, result.message)
      return
    }
    if (result.kind === "error") {
      this.showErrorAction(file, result.message, result.retryable ?? true)
      return
    }
    this.revealPreview(token, file, {
      el: result.el,
      dispose: result.dispose,
      encrypted: result.encrypted,
      version: result.version,
    })
  }

  beginLoad(file: TFile): LoadToken {
    this.loadGeneration += 1
    return {
      generation: this.loadGeneration,
      sessionEpoch: this.plugin.sessionEpoch,
      file,
      path: file.path,
    }
  }

  isCurrent(token: LoadToken, file: TFile | null = token.file): boolean {
    return !this.unloaded
      && this.loadGeneration === token.generation
      && this.plugin.sessionEpoch === token.sessionEpoch
      && file?.path === token.path
  }

  discardPending() {
    this.loadGeneration += 1
  }

  invalidate(message = "Opening document…", options: { actionLabel?: string } = {}) {
    this.discardPending()
    this.disposeActivePreview()
    if (!this.isSurfaceLive()) {
      this.clearExistingSurface()
      return
    }
    if (options.actionLabel && this.file) {
      this.showActionCover(this.file, message, options.actionLabel)
    } else {
      this.lockSurface(message)
    }
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
      this.content = null
      this.safeEmpty(coverEl)
      coverEl.toggleClass("is-error", isError)
      const text = document.createElement("p")
      text.innerText = message
      coverEl.appendChild(text)
      this.contentEl.addClass("is-locked")
    } catch (error) {
      debugAuth("lock-surface-skipped", { reason: String(error) })
    }
  }

  revealPreview(token: LoadToken, file: TFile, preview: PreviewCommit) {
    if (!this.isCurrent(token, file)) {
      preview.dispose()
      debugAuth("view-attach-skipped-stale", {
        path: file.path,
        sessionEpoch: this.plugin.sessionEpoch,
        generation: this.loadGeneration,
        requestedGeneration: token.generation,
      })
      return
    }
    if (preview.encrypted && !this.plugin.canReveal(preview.version)) {
      preview.dispose()
      debugAuth("view-attach-skipped-unauthorized", { path: file.path, sessionEpoch: token.sessionEpoch, generation: token.generation })
      this.showUnlockAction(file)
      return
    }
    if (!this.isSurfaceLive()) {
      preview.dispose()
      return
    }
    this.ensureSurface()
    const previewHost = this.previewHost
    if (!previewHost) {
      preview.dispose()
      return
    }
    this.disposeActivePreview()
    this.safeEmpty(previewHost)
    previewHost.appendChild(preview.el)
    this.content = preview.el
    this.previewDispose = preview.dispose
    this.contentEl.removeClass("is-locked")
    debugAuth("view-attach", {
      path: file.path,
      sessionEpoch: token.sessionEpoch,
      generation: token.generation,
      encrypted: preview.encrypted,
      authorized: !preview.encrypted || this.plugin.canReveal(preview.version),
    })
  }

  protected showUnlockAction(file: TFile, message?: string) {
    this.showActionCover(file, message ?? `"${file.basename}" is password protected.`, "Unlock")
  }

  protected showErrorAction(file: TFile, message: string, retryable = true) {
    this.showActionCover(file, message || "Failed to open this document.", retryable ? "Retry" : null, true)
  }

  private showActionCover(file: TFile, message: string, actionLabel: string | null, isError = false) {
    this.lockSurface(message, isError)
    if (!actionLabel || !this.coverEl || !this.isSurfaceLive()) return
    const expectedPath = file.path
    const button = document.createElement("button")
    button.innerText = actionLabel
    button.onclick = () => {
      if (this.unloaded || !this.file || this.file.path !== expectedPath) return
      const next = this.beginLoad(this.file)
      this.lockSurface("Opening document…")
      void this.loadAndCommit(this.file, next)
    }
    this.coverEl.appendChild(button)
  }

  private disposeActivePreview() {
    const dispose = this.previewDispose
    this.previewDispose = null
    if (!dispose) return
    try {
      dispose()
    } catch {
      // Ignore observer teardown errors during view close.
    }
  }

  private clearExistingSurface() {
    if (this.previewHost) this.safeEmpty(this.previewHost)
    if (this.coverEl) this.safeEmpty(this.coverEl)
    this.content = null
    try {
      this.contentEl?.addClass("is-locked")
    } catch {
      // Ignore if DOM is already detached.
    }
  }

  private isSurfaceLive(): boolean {
    return !this.unloaded && !!this.contentEl
  }

  private safeEmpty(el: HTMLElement) {
    try {
      el.empty()
    } catch {
      el.innerHTML = ""
    }
  }

  private ensureSurface() {
    if (!this.isSurfaceLive()) return
    this.contentEl.addClass("docxer-content")
    if (!this.previewHost || !this.contentEl.contains(this.previewHost)) {
      this.previewHost = document.createElement("div")
      this.previewHost.className = "docxer-preview-host"
      this.contentEl.appendChild(this.previewHost)
    }
    if (!this.coverEl || !this.contentEl.contains(this.coverEl)) {
      this.coverEl = document.createElement("div")
      this.coverEl.className = "docxer-locked docxer-locked-cover"
      this.contentEl.appendChild(this.coverEl)
    }
  }

	async onUnloadFile(file: TFile) {
    this.discardPending()
    this.disposeActivePreview()
    this.clearExistingSurface()
		await super.onUnloadFile(file)
	}

  abstract getMarkdownContent(file: TFile, attachmentsDirectory: string): Promise<string | null>
  private async convertFile() {
    const file = this.file
    if (!file) return

    const convertedFilePath = FileUtils.toUnixPath(file.path).replace(/\.[^\.]*$/, ".md")
    if (this.app.vault.getAbstractFileByPath(convertedFilePath)) {
      new Notice("A file with the same name already exists.")
      return
    }

    const attachmentsDirectory = {
      "vault": "",
      "custom": this.plugin.settings.getSetting("customAttachmentsFolder"),
      "same": FileUtils.dirname(file.path),
      "subfolder": FileUtils.joinPath(FileUtils.dirname(file.path), this.plugin.settings.getSetting("customAttachmentsFolder"))
    }[this.plugin.settings.getSetting("attachmentsFolder")]

    const markdown = await this.getMarkdownContent(file, attachmentsDirectory)
    if (!markdown) {
      new Notice("Could not convert this file. If it is password protected, unlock it and try again.")
      return
    }

    const convertedFile = await this.app.vault.create(convertedFilePath, markdown)
    this.leaf.openFile(convertedFile)

    if (this.plugin.settings.getSetting("deleteFileAfterConversion"))
      this.app.vault.delete(file)
  }
}

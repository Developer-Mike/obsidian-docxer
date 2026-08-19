import { EditableFileView, Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian"
import DocxerPlugin from "src/main"
import FileUtils from "src/utils/file-utils"

export default abstract class ConvertibleFileView extends EditableFileView {
  plugin: DocxerPlugin
  fileContent: string
  header: HTMLElement | null = null
  content: HTMLElement | null = null
  private pendingScrollTop: number | null = null
  private lastKnownScrollTop: number | null = null
  private restoreScrollPositionFrame: number | null = null
  private restoreScrollPositionTimeout: number | null = null
  private saveScrollPositionTimeout: number | null = null

	constructor(leaf: WorkspaceLeaf, plugin: DocxerPlugin) {
		super(leaf)
    this.plugin = plugin
	}

	getDisplayText(): string {
		return this.file?.basename ?? "???"
	}

	getContext(file?: TFile) {
		return file?.path ?? this.file?.path ?? ""
	}

  async onOpen() {
		await super.onOpen()

    this.contentEl.addEventListener("scroll", this.onScroll)

    this.header = document.createElement("div")
    this.header.id = "docxer-header"

    const text = document.createElement("span")
    text.innerText = "This is a preview. To edit, convert it to markdown."
    this.header.appendChild(text)

    const convertButton = document.createElement("button")
    convertButton.id = "docxer-convert-button"
    convertButton.innerText = "Convert"
    convertButton.onclick = () => this.convertFile()
    this.header.appendChild(convertButton)

    this.containerEl.insertAfter(this.header, this.containerEl.firstChild)
  }

	async onClose() {
    this.cancelScrollRestoration()
    this.contentEl.removeEventListener("scroll", this.onScroll)
		await super.onClose()
    if (this.header) this.header.remove()
	}

  abstract getFilePreview(): Promise<HTMLElement | null>
	async onLoadFile(file: TFile) {
		const persistedScrollTop = this.plugin.settings.getScrollPosition(file.path)
		await super.onLoadFile(file)

    if (this.pendingScrollTop === null)
      this.pendingScrollTop = persistedScrollTop
    this.lastKnownScrollTop = this.pendingScrollTop ?? 0

    this.content = await this.getFilePreview()
    if (this.content) {
      this.contentEl.appendChild(this.content)
      this.restoreScrollPosition()
    }
	}

	async onUnloadFile(file: TFile) {
		await this.persistScrollPosition(file)
		await super.onUnloadFile(file)
    if (this.content) this.content.remove()
	}

  getEphemeralState(): Record<string, unknown> {
    return {
      ...super.getEphemeralState(),
      scrollTop: this.contentEl.scrollTop,
    }
  }

  setEphemeralState(state: unknown): void {
    super.setEphemeralState(state)

    if (!state || typeof state !== "object" || !("scrollTop" in state)) return

    const scrollTop = (state as Record<string, unknown>).scrollTop
    if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop) || scrollTop < 0) return

    this.pendingScrollTop = scrollTop
    this.lastKnownScrollTop = scrollTop
    this.restoreScrollPosition()
  }

  private restoreScrollPosition(): void {
    if (this.pendingScrollTop === null || !this.content) return

    const scrollTop = this.pendingScrollTop
    const content = this.content
    const win = this.contentEl.ownerDocument.defaultView ?? window
    this.cancelScrollRestoration()

    const apply = () => {
      if (this.pendingScrollTop !== scrollTop || this.content !== content) return

      this.cancelScrollRestoration()
      this.contentEl.scrollTop = scrollTop
      this.lastKnownScrollTop = this.contentEl.scrollTop
      this.pendingScrollTop = null
    }

    const restore = () => {
      this.restoreScrollPositionTimeout = null
      if (this.pendingScrollTop !== scrollTop || this.content !== content) return
      if (!content.isConnected) {
        this.restoreScrollPositionTimeout = win.setTimeout(restore, 50)
        return
      }

      this.restoreScrollPositionFrame = win.requestAnimationFrame(apply)
      this.restoreScrollPositionTimeout = win.setTimeout(apply, 100)
    }

    this.restoreScrollPositionTimeout = win.setTimeout(restore, 0)
  }

  private cancelScrollRestoration(): void {
    const win = this.contentEl.ownerDocument.defaultView ?? window
    if (this.restoreScrollPositionFrame !== null) {
      win.cancelAnimationFrame(this.restoreScrollPositionFrame)
      this.restoreScrollPositionFrame = null
    }
    if (this.restoreScrollPositionTimeout !== null) {
      win.clearTimeout(this.restoreScrollPositionTimeout)
      this.restoreScrollPositionTimeout = null
    }
  }

  private onScroll = (): void => {
    if (!this.file || !this.content?.isConnected) return

    const scrollTop = this.contentEl.scrollTop
    this.lastKnownScrollTop = scrollTop
    this.plugin.settings.setScrollPosition(this.file.path, scrollTop)

    const win = this.contentEl.ownerDocument.defaultView ?? window
    if (this.saveScrollPositionTimeout !== null)
      win.clearTimeout(this.saveScrollPositionTimeout)

    this.saveScrollPositionTimeout = win.setTimeout(() => {
      this.saveScrollPositionTimeout = null
      void this.plugin.settings.saveSettings()
    }, 500)
  }

  private async persistScrollPosition(file: TFile): Promise<void> {
    const win = this.contentEl.ownerDocument.defaultView ?? window
    if (this.saveScrollPositionTimeout !== null) {
      win.clearTimeout(this.saveScrollPositionTimeout)
      this.saveScrollPositionTimeout = null
    }

    const scrollTop = this.lastKnownScrollTop ?? this.contentEl.scrollTop
    this.plugin.settings.setScrollPosition(file.path, scrollTop)
    await this.plugin.settings.saveSettings()
  }

	clear(): void {}

	setViewData(data: string): void {
    this.fileContent = data
	}

	getViewData(): string {
    return this.fileContent
	}

  abstract getMarkdownContent(attachmentsDirectory: string): Promise<string | null>
  private async convertFile() {
    if (!this.file) return

    const convertedFilePath = FileUtils.toUnixPath(this.file.path).replace(/\.[^\.]*$/, ".md")
    if (this.app.vault.getAbstractFileByPath(convertedFilePath)) {
      new Notice("A file with the same name already exists.")
      return
    }

    // Get the directory where the attachments will be saved
    const attachmentsDirectory = {
      "vault": "",
      "custom": this.plugin.settings.getSetting("customAttachmentsFolder"),
      "same": FileUtils.dirname(this.file.path),
      "subfolder": FileUtils.joinPath(FileUtils.dirname(this.file.path), this.plugin.settings.getSetting("customAttachmentsFolder"))
    }[this.plugin.settings.getSetting("attachmentsFolder")]

    // Convert the file to markdown
    const markdown = await this.getMarkdownContent(attachmentsDirectory)
    if (!markdown) {
      new Notice("Error converting file to markdown.")
      return
    }

    // Create the converted markdown file
    const convertedFile = await this.app.vault.create(convertedFilePath, markdown)
    this.leaf.openFile(convertedFile)

    // Delete the original file if the setting is enabled
    if (this.plugin.settings.getSetting("deleteFileAfterConversion"))
      this.app.vault.delete(this.file)
  }
}

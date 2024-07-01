import { Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian"
import DocxerPlugin from "src/main"
import FileUtils from "src/utils/file-utils"

export default abstract class ConvertibleFileView extends TextFileView {
  plugin: DocxerPlugin
  fileContent: string
  header: HTMLElement | null = null
  content: HTMLElement | null = null

	constructor(leaf: WorkspaceLeaf, plugin: DocxerPlugin) {
		super(leaf)
    this.plugin = plugin
	}

	getDisplayText(): string {
		return this.file?.name ?? "???"
	}

	getContext(file?: TFile) {
		return file?.path ?? this.file?.path ?? ""
	}

  async onOpen() {
		await super.onOpen()

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
		await super.onClose()
    if (this.header) this.header.remove()
	}

  abstract getFilePreview(): Promise<HTMLElement | null>
	async onLoadFile(file: TFile) {
		await super.onLoadFile(file)

    this.content = await this.getFilePreview()
    if (this.content) this.contentEl.appendChild(this.content)
	}

	async onUnloadFile(file: TFile) {
		await super.onUnloadFile(file)
    if (this.content) this.content.remove()
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
import { MarkdownRenderer, Notice, TFile } from "obsidian"
import ConvertibleFileView from "src/core/convertible-file-view"
import RtfUtils from "src/utils/rtf-utils"

export default class RtfFileView extends ConvertibleFileView {
  static readonly VIEW_TYPE_ID = "docxer-plus-rtf-view"

  getViewType(): string {
    return RtfFileView.VIEW_TYPE_ID
  }

  async getFilePreview(): Promise<HTMLElement | null> {
    if (!this.file) return null

    const content = await this.app.vault.read(this.file)
    const wrapper = document.createElement("div")
    wrapper.classList.add("rtf-preview")

    if (!RtfUtils.isRtf(content)) {
      wrapper.createEl("p", {
        text: "This .doc file does not look like an RTF document. Docxer Plus can read .rtf files and .doc files whose content starts with RTF data.",
      })
      return wrapper
    }

    const markdown = RtfUtils.toMarkdown(content)
    await MarkdownRenderer.render(this.app, markdown, wrapper, this.file.path, this)
    return wrapper
  }

  async getMarkdownContent(_attachmentsDirectory: string): Promise<string | null> {
    if (!this.file) return null

    const content = await this.app.vault.read(this.file)
    if (!RtfUtils.isRtf(content)) {
      new Notice("This .doc file is not an RTF document.")
      return null
    }

    return RtfUtils.toMarkdown(content)
  }

  protected getConvertedFilePath(file: TFile): string {
    if (file.path.toLowerCase().endsWith(".rtf.doc")) {
      return file.path.slice(0, -".rtf.doc".length) + ".md"
    }

    return super.getConvertedFilePath(file)
  }
}

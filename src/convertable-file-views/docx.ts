import * as mammoth from "mammoth"
import { renderAsync } from 'docx-preview'
import { htmlToMarkdown } from "obsidian"
import ConvertableFileView from "src/core/convertable-file-view"
import FileUtils from "src/utils/file-utils"
import { extensions } from "mime-types"

export default class DocxFileView extends ConvertableFileView {
  static readonly VIEW_TYPE_ID = "docx-view"

  getViewType(): string {
    return DocxFileView.VIEW_TYPE_ID
  }

  async getFilePreview(): Promise<HTMLElement | null> {
    if (!this.file) return null

    const view = document.createElement("div")

    const fileBuffer = await this.app.vault.readBinary(this.file)
    await renderAsync(fileBuffer, view)

    return view
  }

  async getMarkdownContent(attachmentsDirectory: string): Promise<string | null> {
    if (!this.file) return null

    // Convert DOCX to HTML
    const fileBuffer = await this.app.vault.readBinary(this.file)
    const html = await mammoth.convertToHtml({ arrayBuffer: fileBuffer }, {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const imageBinary = await image.read()

        const fallbackFilename = this.plugin.settings.getSetting("fallbackAttachmentName")
        const attachmentAltText = image.altText ?? ""
        const fileExtension = extensions[image.contentType]?.first() || "png"

        const path = await FileUtils.createBinary(this.app, attachmentsDirectory, attachmentAltText, fallbackFilename, fileExtension, imageBinary)
        console.log(`Extracted image to ${path}`)

        return { src: path.contains(" ") ? `<${path}>` : path, alt: attachmentAltText }
      })
    })

    // Convert HTML to Markdown
    const markdown = htmlToMarkdown(html.value)

    return markdown
  }
}
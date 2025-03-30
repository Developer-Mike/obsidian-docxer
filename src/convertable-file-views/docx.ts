import * as mammoth from "mammoth"
import { renderAsync } from 'docx-preview'
import ConvertibleFileView from "src/core/convertible-file-view"
import FileUtils from "src/utils/file-utils"
import ObsidianTurndown from "src/utils/obsidian-turndown"
import { htmlToMarkdown, TFile } from "obsidian"
import MimeUtils from "src/utils/mime-utils"
import DocxerPlugin from "src/main"

export default class DocxFileView extends ConvertibleFileView {
  static readonly VIEW_TYPE_ID = "docx-view"

  getViewType(): string {
    return DocxFileView.VIEW_TYPE_ID
  }

  static async getFilePreview(plugin: DocxerPlugin, file: TFile | null): Promise<HTMLElement | null> {
    if (!file) return null

    const view = document.createElement("div")

    const fileBuffer = await plugin.app.vault.readBinary(file)
    await renderAsync(fileBuffer, view, view, {
      renderComments: plugin.settings.getSetting("importComments"),
    })

    const docxWrapper = view.querySelector(".docx-wrapper") as HTMLElement | null
    if (!docxWrapper) return view

    const docx = docxWrapper.querySelector(".docx") as HTMLElement | null
    if (!docx) return view

    new ResizeObserver(() => {
      const scale = Math.min(1, view.clientWidth / docx.clientWidth)
      docxWrapper.style.transform = `scale(${scale})`
    }).observe(view)

    return view
  }

  async getFilePreview(): Promise<HTMLElement | null> {
    return DocxFileView.getFilePreview(this.plugin, this.file)
  }

  async getMarkdownContent(attachmentsDirectory: string): Promise<string | null> {
    if (!this.file) return null

    // Convert DOCX to HTML
    const fileBuffer = await this.app.vault.readBinary(this.file)
    const html = await mammoth.convertToHtml({ arrayBuffer: fileBuffer }, {
      styleMap: this.plugin.settings.getSetting("importComments") ? ["comment-reference => sup"] : undefined,
      convertImage: mammoth.images.imgElement(async (image: any) => {
        console.debug(`Extracting image ${image.altText ?? ""}`)
        const imageBinary = await image.read()

        const fallbackFilename = this.plugin.settings.getSetting("fallbackAttachmentName")
        let attachmentFilename = this.file?.name.replace(/\.docx$/, "") ?? ""
        if (this.plugin.settings.getSetting("useImageAltAsFilename"))
          attachmentFilename = image.altText?.replace(/\n/g, " ") ?? ""
        const fileExtension = MimeUtils.EXTENSIONS[image.contentType] ?? "png"

        const path = await FileUtils.createBinary(this.app, attachmentsDirectory, attachmentFilename, fallbackFilename, fileExtension, imageBinary)
        console.debug(`Extracted image to ${path}`)

        return { src: path.contains(" ") ? `<${path}>` : path, alt: attachmentFilename }
      })
    })

    // Convert HTML to Markdown
    let markdown
    if (!this.plugin.settings.getSetting("importComments")) {
      markdown = htmlToMarkdown(html.value)
    } else {
      const turndownService = ObsidianTurndown.getService()

      turndownService.addRule('comments-sup', {
        filter: ['sup'],
        replacement: function (content) {
          // [[MS2]](#comment-1) -> MS
          const author = content.match(/\[\[(\D+)\d*\]/)?.[1] ?? "Unknown Author"
          // [[MS2]](#comment-1) -> 2
          const commentNumber = content.match(/(\d+)/)?.[1] ?? "1"
          // [[MS2]](#comment-1) -> comment-1
          const commentId = content.match(/#([^\)]+)/)?.[1] ?? "comment-0"

          return ` ([[#^${commentId}|Comment ${author} ${commentNumber}]])`
        }
      })

      // Rule for internal TOC links (links starting with #)
      turndownService.addRule('internalLink', {
        filter: function (node, options) {
          // Check if it's an 'a' tag with an 'href' starting with '#'
          return !!(node.nodeName === 'A' && node.getAttribute('href')?.startsWith('#'))
        },
        replacement: function (content, node: HTMLAnchorElement) {
          const linkText = content.trim()
          if (linkText) return `[[#${linkText}]]`

          // Fallback if link text is empty - try using the href target ID directly
          const href = node.getAttribute('href') || ''
          console.warn(`Internal link with href "${href}" has no text content. Creating link to target ID.`)
          return `[[${href}]]` // Link to the raw href target (e.g., [[#_Toc12345]])
        }
      })

      turndownService.addRule('comments-description-list', {
        filter: ['dl'],
        replacement: function (content) {
          console.log(content)
          /*
          Comment [MS1]

          Hey [↑](#comment-ref-0)

          Comment [AD2]

          Test comment 2 [↑](#comment-ref-1)
          */
          const comments = content.match(/Comment \[(\D+)\d+\]\n\n[\s\S]+? \[.\]\(#comment-ref-(\d+)\)/g)
          if (!comments) return content

          const commentsCallouts = comments.map((comment) => {
            const author = comment.match(/Comment \[(\D+)\d+\]/)?.[1] ?? "Unknown Author"
            const number = comment.match(/Comment \[\D+(\d+)\]/)?.[1] ?? "1"
            const id = comment.match(/Comment \[\D+\d+\]\n\n[\s\S]+? \[.\]\(#comment-ref-(\d+)\)/)?.[1] ?? "0"
            const content = comment.match(/Comment \[\D+\d+\]\n\n([\s\S]+?) \[.\]\(#comment-ref-\d+\)/)?.[1] ?? ""

            return (
                `>[!QUOTE] **Comment ${author} ${number}**\n`
              + `> ${content}\n`
              + `^comment-${id}`
            )
          })

          return "---" + "\n\n" + commentsCallouts.join("\n\n")
        }
      })

      markdown = turndownService.turndown(html.value)
    }

    return markdown
  }
}
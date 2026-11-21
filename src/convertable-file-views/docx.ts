import * as mammoth from "mammoth"
import { renderAsync } from 'docx-preview'
import ConvertibleFileView, { AuthorizedPreview, LoadToken, MarkdownConversionResult } from "src/core/convertible-file-view"
import FileUtils from "src/utils/file-utils"
import ObsidianTurndown from "src/utils/obsidian-turndown"
import { htmlToMarkdown, TFile } from "obsidian"
import MimeUtils from "src/utils/mime-utils"
import DocxerPlugin from "src/main"
import { isAuthorizedReadCurrent, readDocxBuffer } from "src/utils/protected-docx"
import { isEncryptedDocx } from "src/utils/docx-encryption"
import { fileVersion, versionsEqual, zeroArrayBuffer } from "src/utils/docx-unlock-cache"

const MAX_METADATA_RETRIES = 2

export type RenderedPreview = {
  el: HTMLElement
  dispose: () => void
}

export type AuthorizedPreviewOptions = {
  promptForPassword?: boolean
  isCurrent?: () => boolean
  onEncrypted?: () => void
}

export default class DocxFileView extends ConvertibleFileView {
  static readonly VIEW_TYPE_ID = "docx-view"

  getViewType(): string {
    return DocxFileView.VIEW_TYPE_ID
  }

  static async getAuthorizedPreview(
    plugin: DocxerPlugin,
    file: TFile | null,
    options: AuthorizedPreviewOptions = {},
  ): Promise<AuthorizedPreview | null> {
    if (!file) return null
    const promptForPassword = options.promptForPassword ?? true
    const isCurrent = options.isCurrent ?? (() => true)

    try {
      for (let attempt = 0; attempt <= MAX_METADATA_RETRIES; attempt++) {
        if (!isCurrent()) return null

        const versionBefore = fileVersion(file)
        const raw = await plugin.app.vault.readBinary(file)
        if (!isCurrent()) return null

        const version = fileVersion(file)
        if (!versionsEqual(versionBefore, version)) {
          if (attempt < MAX_METADATA_RETRIES) continue
          return {
            kind: "error",
            message: "This document changed while opening. Click Retry to try again.",
            retryable: true,
            version,
          }
        }

        if (isEncryptedDocx(raw)) options.onEncrypted?.()

        const authorized = await plugin.getAuthorizedDocument(file, raw, version, { prompt: promptForPassword })
        if (!isCurrent()) {
          if (authorized?.encrypted) zeroArrayBuffer(authorized.buffer)
          return null
        }

        if (!versionsEqual(version, fileVersion(file))) {
          if (authorized?.encrypted) zeroArrayBuffer(authorized.buffer)
          if (attempt < MAX_METADATA_RETRIES) continue
          return {
            kind: "error",
            message: "This document changed while opening. Click Retry to try again.",
            retryable: true,
            version: fileVersion(file),
          }
        }

        if (!authorized) return { kind: "locked", version }
        if (authorized.encrypted && !plugin.canReveal(authorized.version)) {
          zeroArrayBuffer(authorized.buffer)
          return { kind: "locked", version: authorized.version }
        }

        let rendered: RenderedPreview
        try {
          rendered = await DocxFileView.renderPreview(plugin, authorized.buffer, authorized.encrypted)
        } finally {
          if (authorized.encrypted) zeroArrayBuffer(authorized.buffer)
        }
        if (!isCurrent()) {
          rendered.dispose()
          return null
        }

        if (!versionsEqual(version, fileVersion(file))) {
          rendered.dispose()
          if (attempt < MAX_METADATA_RETRIES) continue
          return {
            kind: "error",
            message: "This document changed while opening. Click Retry to try again.",
            retryable: true,
            version: fileVersion(file),
          }
        }

        if (authorized.encrypted && !plugin.canReveal(authorized.version)) {
          rendered.dispose()
          return { kind: "locked", version: authorized.version }
        }

        return {
          kind: "preview",
          el: rendered.el,
          dispose: rendered.dispose,
          encrypted: authorized.encrypted,
          version: authorized.version,
        }
      }

      return {
        kind: "error",
        message: "This document changed while opening. Click Retry to try again.",
        retryable: true,
        version: fileVersion(file),
      }
    } catch (error) {
      if (!isCurrent()) return null
      return {
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to open this document.",
        retryable: true,
        version: fileVersion(file),
      }
    }
  }

  private static async renderPreview(
    plugin: DocxerPlugin,
    fileBuffer: ArrayBuffer,
    encrypted: boolean,
  ): Promise<RenderedPreview> {
    const view = document.createElement("div")

    await renderAsync(fileBuffer, view, view, {
      renderComments: plugin.settings.getSetting("importComments"),
      // Inline encrypted media as data URLs so disposing a preview cannot leave live blob: URLs behind.
      useBase64URL: encrypted,
    })

    const clearView = () => {
      try {
        view.empty()
      } catch {
        view.innerHTML = ""
      }
    }

    const docxWrapper = view.querySelector(".docx-wrapper") as HTMLElement | null
    if (!docxWrapper) return { el: view, dispose: clearView }

    const docx = docxWrapper.querySelector(".docx") as HTMLElement | null
    if (!docx) return { el: view, dispose: clearView }

    const updateScale = () => {
      if (view.clientWidth <= 0 || docx.clientWidth <= 0) return
      const scale = Math.min(1, view.clientWidth / docx.clientWidth)
      if (!Number.isFinite(scale) || scale <= 0) return
      docxWrapper.style.transform = `scale(${scale})`
    }

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(updateScale)
      observer.observe(view)
    }

    return {
      el: view,
      dispose: () => {
        observer?.disconnect()
        observer = null
        clearView()
      },
    }
  }

  async getFilePreview(file: TFile, token: LoadToken): Promise<AuthorizedPreview | null> {
    this.lockSurface("Opening document…")
    return DocxFileView.getAuthorizedPreview(this.plugin, file, {
      promptForPassword: true,
      isCurrent: () => this.isCurrent(token, file),
      onEncrypted: () => {
        if (this.isCurrent(token, file)) {
          this.lockSurface(`"${file.basename}" is password protected.`)
        }
      },
    })
  }

  async getMarkdownContent(file: TFile, attachmentsDirectory: string): Promise<MarkdownConversionResult> {
    const read = await readDocxBuffer(this.plugin, file, { prompt: true })
    if (read.status !== "ok") return read

    const isCurrent = () => isAuthorizedReadCurrent(this.plugin, file, read.version, read.sessionEpoch, read.encrypted)
    let stale = false

    const embedImageData = this.plugin.settings.getSetting("embedImageData")
    const ignoreAttachments = this.plugin.settings.getSetting("ignoreAttachments")
    
    const conversionOptions: any = {
      styleMap: this.plugin.settings.getSetting("importComments") ? ["comment-reference => sup"] : undefined,
    }
    
    /**
     * IMAGE CONVERSION STATE MACHINE
     * Based on settings, handle images in one of three ways:
     * 
     * 1. IGNORE state (ignoreAttachments=true)
     *    - Skip all image processing
     *    - Return placeholder text only
     *    - No files or data created
     * 
     * 2. EMBED state (embedImageData=true, ignoreAttachments=false)
     *    - Convert images to base64 data URLs
     *    - Embed directly in markdown
     *    - No external files created
     * 
     * 3. DEFAULT state (both false)
     *    - Extract images to separate files
     *    - Create attachment folders as configured
     *    - Standard Obsidian behavior
     */
    if (ignoreAttachments) {
      // IGNORE state: Completely skip images
      console.debug("Docxer: Ignoring images during conversion")
      conversionOptions.convertImage = mammoth.images.imgElement(async (image: any) => {
        const altText = image.altText || "image"
        // Return just the alt text as a placeholder - no image element
        return { src: "", alt: `[Image: ${altText}]` }
      })
    } else if (embedImageData) {
      // EMBED state: Convert to base64 data URLs
      conversionOptions.convertImage = mammoth.images.dataUri
    } else {
      // DEFAULT state: Extract to files
      console.debug("Docxer: Extracting images during conversion")
      conversionOptions.convertImage = mammoth.images.imgElement(async (image: any) => {
        if (stale || !isCurrent()) {
          stale = true
          return { src: "", alt: "" }
        }
        const imageBinary = await image.read()
        if (stale || !isCurrent()) {
          stale = true
          return { src: "", alt: "" }
        }

        const fallbackFilename = this.plugin.settings.getSetting("fallbackAttachmentName")
        let attachmentFilename = file.name.replace(/\.docx$/, "")
        if (this.plugin.settings.getSetting("useImageAltAsFilename"))
          attachmentFilename = image.altText?.replace(/\n/g, " ") ?? ""
        const fileExtension = MimeUtils.EXTENSIONS[image.contentType] ?? "png"

        const path = await FileUtils.createBinary(this.app, attachmentsDirectory, attachmentFilename, fallbackFilename, fileExtension, imageBinary)
        console.debug("Docxer: Extracted attachment")

        return { src: path.contains(" ") ? `<${path}>` : path, alt: attachmentFilename }
      })
    }
    
    let html
    try {
      html = await mammoth.convertToHtml({ arrayBuffer: read.buffer }, conversionOptions)
    } finally {
      if (read.encrypted) zeroArrayBuffer(read.buffer)
    }

    if (stale || !isCurrent()) return { status: "stale" }

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
          console.warn("Docxer: Empty internal link text; falling back to target anchor")
          const href = node.getAttribute('href') || ''
          return `[[${href}]]` // Link to the raw href target (e.g., [[#_Toc12345]])
        }
      })

      turndownService.addRule('comments-description-list', {
        filter: ['dl'],
        replacement: function (content) {
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

    if (!isCurrent()) return { status: "stale" }

    return {
      status: "ok",
      markdown,
      version: read.version,
      sessionEpoch: read.sessionEpoch,
      encrypted: read.encrypted,
    }
  }
}
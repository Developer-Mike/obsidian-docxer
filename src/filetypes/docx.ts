import ConvertableFileView from "./convertable-file-view";
import * as mammoth from "mammoth";
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { renderAsync } from 'docx-preview'
import * as path from "path";
import { toValidFilename } from "src/utils";

export default class DocxFileView extends ConvertableFileView {
  static readonly VIEW_TYPE = "docx-view";
  getViewType(): string {
    return DocxFileView.VIEW_TYPE;
  }

  async onFileOpen(): Promise<HTMLElement|null> {
    if (!this.file) return null;

    const view = document.createElement("div");

    const fileBuffer = await this.app.vault.readBinary(this.file);
    await renderAsync(fileBuffer, view);

    return view;
  }

  async toMarkdown(attachmentsDirectory: string): Promise<string|null> {
    if (!this.file) return null;

    const fileBuffer = await this.app.vault.readBinary(this.file);
    const html = await mammoth.convertToHtml({ arrayBuffer: fileBuffer }, {
      convertImage: mammoth.images.imgElement((image: any) => {
        return image.read().then((imageBinary: any) => {
          const filename = toValidFilename(image.altText) + "." + image.contentType.split("/")[1];
          const filepath = path.join(attachmentsDirectory, filename);

          this.app.vault.createBinary(filepath, imageBinary);
          return { alt: image.altText, src: filepath };
        });
      })
    })

    const markdownService = new NodeHtmlMarkdown();
    const markdown = markdownService.translate(html.value);

    return markdown;
  }
}
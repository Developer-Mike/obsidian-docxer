import ConvertableFileView from "./convertable-file-view";
import * as mammoth from "mammoth";
import { renderAsync } from 'docx-preview';
import { createMissingFolders, joinPath, toObsidianPath, toValidFilename } from "src/utils";
import { htmlToMarkdown } from "obsidian";

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
          const filepath = toObsidianPath(joinPath(attachmentsDirectory, filename));

          createMissingFolders(this.app, filepath);
          this.app.vault.createBinary(filepath, imageBinary);
          return { alt: image.altText, src: filepath };
        });
      })
    })

    const markdown = htmlToMarkdown(html.value);
    return markdown;
  }
}
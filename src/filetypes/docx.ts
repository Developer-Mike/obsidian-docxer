import ConvertableFileView from "./convertable-file-view";
import * as mammoth from "mammoth";
import { NodeHtmlMarkdown } from 'node-html-markdown'

export default class DocxFileView extends ConvertableFileView {
  static readonly VIEW_TYPE = "docx-view";
  getViewType(): string {
    return DocxFileView.VIEW_TYPE;
  }

  onFileOpen(): HTMLElement | null {
    const view = document.createElement("div");
    view.innerHTML = "Docx file opened!";

    return view;
  }

  async toMarkdown(): Promise<string|null> {
    if (!this.file) return null;

    const fileBuffer = await this.app.vault.readBinary(this.file);
    const html = await mammoth.convertToHtml({ arrayBuffer: fileBuffer })

    const markdownService = new NodeHtmlMarkdown();
    const markdown = markdownService.translate(html.value);

    return markdown;
  }
}
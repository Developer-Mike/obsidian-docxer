import { on } from "events";
import * as fs from "fs";
import { Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import * as path from "path";

export default abstract class ConvertableFileView extends TextFileView {
  fileContent: string;
  header: HTMLElement|null = null;
  content: HTMLElement|null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getDisplayText(): string {
		return this.file?.name ?? "???";
	}

	getContext(file?: TFile) {
		return file?.path ?? this.file?.path ?? "";
	}

  async onOpen() {
		await super.onOpen();

    this.header = document.createElement("div")
    this.header.id = "docxer-header";

    const text = document.createElement("span");
    text.innerText = "This is a preview. To edit, convert it to markdown.";
    this.header.appendChild(text);

    const convertButton = document.createElement("button");
    convertButton.id = "docxer-convert-button";
    convertButton.innerText = "Convert";
    convertButton.onclick = () => this.convertFile();
    this.header.appendChild(convertButton);

    this.containerEl.insertAfter(this.header, this.containerEl.firstChild);
  }

	async onClose() {
		await super.onClose();
    if (this.header) this.header.remove();
	}

  abstract onFileOpen(): HTMLElement|null;
	async onLoadFile(file: TFile) {
		await super.onLoadFile(file);

    this.content = this.onFileOpen();
    if (this.content) this.contentEl.appendChild(this.content);
	}

	async onUnloadFile(file: TFile) {
		await super.onUnloadFile(file);
    if (this.content) this.content.remove();
	}

	clear(): void {}

	setViewData(data: string): void {
    this.fileContent = data;
	}

	getViewData(): string {
    return this.fileContent;
	}

  abstract toMarkdown(): Promise<string|null>;
  private async convertFile() {
    if (!this.file) return;

    // @ts-ignore
    const filepath = path.join(this.file?.vault?.adapter?.basePath, this.file?.path);
    const targetFilepath = path.join(path.dirname(filepath), path.basename(filepath, path.extname(filepath)) + ".md");
    const markdown = await this.toMarkdown();
    if (!markdown) {
      new Notice("Error converting file to markdown.");
      return;
    }

    fs.writeFile(targetFilepath, markdown, (err) => {
      if (err) {
        new Notice("Error converting file to markdown.");
        console.error(err);
      } else new Notice("File converted successfully!");
    });
  }
}
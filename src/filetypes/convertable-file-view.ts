import DocxFileView from "./docx";
import * as fs from "fs";
import { Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import DocxerPlugin from "src/main";

export default abstract class ConvertableFileView extends TextFileView {
  data: string;

	constructor(leaf: WorkspaceLeaf, private plugin: DocxerPlugin) {
		super(leaf);
	}

	getDisplayText(): string {
		return this.file?.name ?? "???";
	}

	getContext(file?: TFile) {
		return file?.path ?? this.file?.path ?? "";
	}

	async onClose() {
		await super.onClose();
	}

	async onLoadFile(file: TFile) {
		await super.onLoadFile(file);

		this.contentEl.append("Convert to Markdown");
	}

	async onUnloadFile(file: TFile) {
		await super.onUnloadFile(file);
	}

	async onOpen() {
		await super.onOpen();
	}

	clear(): void {
    
	}

	setViewData(data: string): void {
    this.data = data;
	}

	getViewData(): string {
    return this.data;
	}

  abstract toMarkdown(): string;
  private convertFile(): void {
    const filepath = this.file?.path;
    if (!filepath) {
      new Notice("No file to convert.");
      return;
    }
    const targetFilepath = path.join(path.dirname(filepath), path.basename(filepath), ".md")
    const markdown = this.toMarkdown();

    fs.writeFile(targetFilepath, markdown, (err) => {
      if (err) {
        new Notice("Error converting file to markdown.");
        console.error(err);
      } else new Notice("File converted successfully!");
    });
  }
}
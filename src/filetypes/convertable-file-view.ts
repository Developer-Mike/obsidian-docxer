import { Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import DocxerPlugin from "src/main";
import { dirname, filename, joinPath } from "src/utils";

export default abstract class ConvertableFileView extends TextFileView {
  plugin: DocxerPlugin;
  fileContent: string;
  header: HTMLElement|null = null;
  content: HTMLElement|null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DocxerPlugin) {
		super(leaf);
    this.plugin = plugin;
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

  abstract onFileOpen(): Promise<HTMLElement|null>;
	async onLoadFile(file: TFile) {
		await super.onLoadFile(file);

    this.content = await this.onFileOpen();
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

  abstract toMarkdown(attachmentsDirectory: string): Promise<string|null>;
  private async convertFile() {
    if (!this.file) return;

    const targetFilepath = joinPath(dirname(this.file.path), filename(this.file.path, false) + '.md');
    console.log(this.file.path, targetFilepath);
    const attachmentsDirectory = {
      "vault": "",
      "custom": this.plugin.settings.customAttachmentsFolder,
      "same": dirname(targetFilepath),
      "subfolder": joinPath(dirname(this.file.path), this.plugin.settings.customAttachmentsFolder)
    }[this.plugin.settings.attachmentsFolder];

    const markdown = await this.toMarkdown(attachmentsDirectory);
    if (!markdown) {
      new Notice("Error converting file to markdown.");
      return;
    }

    const convertedFile = await this.app.vault.create(targetFilepath, markdown);
    this.leaf.openFile(convertedFile);

    if (this.plugin.settings.deleteFileAfterConversion)
      this.app.vault.delete(this.file);
  }
}
import DocxerPlugin from "./main";
import { App, PluginSettingTab, Setting } from "obsidian";

export interface DocxerPluginSettings {
  deleteFileAfterConversion: boolean;
  attachmentsFolder: "vault" | "custom" | "same" | "subfolder";
  customAttachmentsFolder: string;
}

export const DEFAULT_SETTINGS: Partial<DocxerPluginSettings> = {
  deleteFileAfterConversion: false,
  attachmentsFolder: "subfolder",
  customAttachmentsFolder: "Attachments"
};

export class DocxerSettingTab extends PluginSettingTab {
  plugin: DocxerPlugin;

  constructor(app: App, plugin: DocxerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Delete source file after conversion")
      .setDesc("Delete source file after pressing the conversion button.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteFileAfterConversion)
          .onChange(async (value) => {
            this.plugin.settings.deleteFileAfterConversion = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Attachments folder")
      .setDesc("Specify the destination for attachments extracted during file conversion.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            "vault": "Vault folder",
            "custom": "In the folder specified below",
            "same": "Same folder as current file",
            "subfolder": "In subfolder under current folder"
          })
          .setValue(this.plugin.settings.attachmentsFolder)
          .onChange(async (value) => {
            this.plugin.settings.attachmentsFolder = value as any;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom attachments folder")
      .setDesc("Specify the name of the folder where attachments will be extracted.")
      .addText((text) =>
        text
          .setPlaceholder("Attachments")
          .setValue(this.plugin.settings.customAttachmentsFolder)
          .onChange(async (value) => {
            this.plugin.settings.customAttachmentsFolder = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
import DocxerPlugin from "./main";
import { App, PluginSettingTab, Setting } from "obsidian";

export interface DocxerPluginSettings {
  deleteDocxAfterConversion: boolean;
}

export const DEFAULT_SETTINGS: Partial<DocxerPluginSettings> = {
  deleteDocxAfterConversion: false,
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
      .setName("Delete .docx after conversion")
      .setDesc("Delete .docx file after pressing the conversion button.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteDocxAfterConversion)
          .onChange(async (value) => {
            this.plugin.settings.deleteDocxAfterConversion = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
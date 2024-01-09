import { Plugin, Notice, debounce } from 'obsidian';
import { DocxerPluginSettings, DocxerSettingTab, DEFAULT_SETTINGS } from './settings';
import { registerCommands } from './commands';
import * as fs from 'fs';

export default class DocxerPlugin extends Plugin {
  static INSTANCE: DocxerPlugin;
  settings: DocxerPluginSettings;

	async onload() {
    DocxerPlugin.INSTANCE = this;

    await this.loadSettings();
    this.addSettingTab(new DocxerSettingTab(this.app, this));

    registerCommands(this);

    this.registerEvent(this.app.vault.on("create", this.onFileCreated));
	}

  onFileCreated(e: any) {
    if (e.extension !== "docx") return;

    console.log(e);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
import { Plugin } from 'obsidian';
import { DocxerPluginSettings, DocxerSettingTab, DEFAULT_SETTINGS } from './settings';
import { registerFilePreviews } from './file-previews';

export default class DocxerPlugin extends Plugin {
  settings: DocxerPluginSettings;

	async onload() {
    this.initSettings();
    registerFilePreviews(this);
	}

  async initSettings() {
    await this.loadSettings();
    this.addSettingTab(new DocxerSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
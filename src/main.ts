import DocxFileView from "./convertable-file-views/docx"
import ConvertableFileView from "./core/convertable-file-view"
import SettingsManager from "./settings"
import { Plugin, WorkspaceLeaf } from "obsidian"

export const FILETYPE_MAP: { [key: string]: new(leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertableFileView } = {
  "docx": DocxFileView
}

export default class DocxerPlugin extends Plugin {
  settings: SettingsManager
  
	async onload() {    
    this.settings = new SettingsManager(this)
    await this.settings.loadSettings()
    this.settings.addSettingsTab()

    for (const [fileExtension, viewClass] of Object.entries(FILETYPE_MAP)) {
      this.registerView((viewClass as any).VIEW_TYPE_ID, (leaf) => new viewClass(leaf, this))
      this.registerExtensions([fileExtension], (viewClass as any).VIEW_TYPE_ID)
    }
	}

  onunload() {}
}
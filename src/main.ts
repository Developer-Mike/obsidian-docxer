import DocxFileView from "./convertable-file-views/docx"
import ConvertibleFileView from "./core/convertible-file-view"
import DocxerEmbedComponent from "./core/docxer-embed-component"
import SettingsManager from "./settings"
import { Plugin, TFile, WorkspaceLeaf } from "obsidian"

export const FILETYPE_MAP: { [key: string]: new(leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView } = {
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

      // Register embeds
      if (!DocxerEmbedComponent.isEmbeddable(viewClass)) continue

      ;(this.app as any).embedRegistry.unregisterExtension(fileExtension)
      ;(this.app as any).embedRegistry.registerExtension(fileExtension, (info: any, file: TFile, subpath: string) => new DocxerEmbedComponent(this, viewClass, info, file, subpath))
    }
	}

  onunload() {}
}
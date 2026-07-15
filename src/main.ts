import DocxFileView from "./convertable-file-views/docx"
import RtfFileView from "./convertable-file-views/rtf"
import ConvertibleFileView from "./core/convertible-file-view"
import DocxerEmbedComponent from "./core/docxer-embed-component"
import SettingsManager from "./settings"
import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian"

export const FILETYPE_MAP: { [key: string]: new(leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView } = {
  "docx": DocxFileView,
  "rtf": RtfFileView,
  "doc": RtfFileView,
}

export default class DocxerPlugin extends Plugin {
  settings: SettingsManager
  
	async onload() {    
    this.settings = new SettingsManager(this)
    await this.settings.loadSettings()
    this.settings.addSettingsTab()

    const registeredViewTypes = new Set<string>()

    for (const [fileExtension, viewClass] of Object.entries(FILETYPE_MAP)) {
      const viewTypeId = (viewClass as any).VIEW_TYPE_ID

      try {
        if (!registeredViewTypes.has(viewTypeId)) {
          this.registerView(viewTypeId, (leaf) => new viewClass(leaf, this))
          registeredViewTypes.add(viewTypeId)
        }

        this.registerExtensions([fileExtension], viewTypeId)
      } catch (error) {
        console.error(`Docxer Plus could not register .${fileExtension} support`, error)
        new Notice(`Docxer Plus could not register .${fileExtension} support. Check the developer console for details.`)
        continue
      }

      // Register embeds
      if (!DocxerEmbedComponent.isEmbeddable(viewClass)) continue

      try {
        ;(this.app as any).embedRegistry.unregisterExtension(fileExtension)
        ;(this.app as any).embedRegistry.registerExtension(fileExtension, (info: any, file: TFile, subpath: string) => new DocxerEmbedComponent(this, viewClass, info, file, subpath))
      } catch (error) {
        console.error(`Docxer Plus could not register .${fileExtension} embeds`, error)
      }
    }
	}

  onunload() {}
}

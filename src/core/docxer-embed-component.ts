import DocxerPlugin from "src/main"
import ConvertibleFileView from "./convertible-file-view"
import { Component, TFile, WorkspaceLeaf } from "obsidian"

export default class DocxerEmbedComponent extends Component {
  plugin: DocxerPlugin
  view: new (leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView

  info: any
  file: TFile
  subpath: string

  constructor(plugin: DocxerPlugin, view: new (leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView, info: any, file: TFile, subpath: string) {
    super()

    this.plugin = plugin
    this.view = view

    this.info = info
    this.file = file
    this.subpath = subpath

    info.containerEl.addClass("docxer-embed")
  }

  // override
  async loadFile() {
    const preview = await (this.view as any).getFilePreview(this.plugin, this.file)
    if (!preview) return

    this.info.containerEl.appendChild(preview)
  }

  static isEmbeddable(view: new (leaf: WorkspaceLeaf, plugin: DocxerPlugin) => ConvertibleFileView) {
    return (view as any).getFilePreview !== undefined
  }
}
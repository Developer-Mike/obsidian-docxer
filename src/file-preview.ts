import { Plugin } from "obsidian";
import DocxFileView from "./filetypes/docx";
import ConvertableFileView from "./filetypes/convertable-file-view";

export const FILETYPE_MAP: {[key: string]: typeof ConvertableFileView} = {
  "docx": DocxFileView
}

export function registerFilePreviews(plugin: Plugin) {
  for (const [filetype, view] of Object.entries(FILETYPE_MAP)) {
    // @ts-ignore
    plugin.registerView(view.VIEW_TYPE, (leaf) => new view(leaf, this));

    // @ts-ignore
    plugin.registerExtensions([filetype], view.VIEW_TYPE);
  }
}
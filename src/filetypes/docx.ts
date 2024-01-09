import { TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import ConvertableFileView from "./convertable-file-view";

export default class DocxFileView extends ConvertableFileView {
  static readonly VIEW_TYPE = "docx-view";
  getViewType(): string {
    return DocxFileView.VIEW_TYPE;
  }

  toMarkdown(): string {
    throw new Error("Method not implemented.");
  }
}
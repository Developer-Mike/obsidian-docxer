import { App } from "obsidian";
import * as path from "path";

export function toValidFilename(filename: string): string {
  let validFilename = filename.replace(/[^a-zA-Z0-9öüäÖÜÄ.\-]/g, "");
  return validFilename;
}

export function toObsidianPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function createMissingFolders(app: App, filepath: string) {
  const folder = path.dirname(filepath);
  const folders = folder.contains("\\") ? folder.split("\\") : folder.split("/");

  let currentFolder = "";
  for (const folder of folders) {
    currentFolder = path.join(currentFolder, folder);

    if (!app.vault.getAbstractFileByPath(currentFolder))
      app.vault.createFolder(currentFolder);
  }
}
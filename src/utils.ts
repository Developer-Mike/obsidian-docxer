import { App } from "obsidian";

export function toValidFilename(filename: string): string {
  let validFilename = filename.replace(/[^a-zA-Z0-9öüäÖÜÄ.\-]/g, "");
  return validFilename;
}

export function toObsidianPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function createMissingFolders(app: App, filepath: string) {
  const folder = filepath.replace(/\/[^\/]*\/?$/, "");
  const folders = folder.contains("\\") ? folder.split("\\") : folder.split("/");

  let currentFolder = "";
  for (const folder of folders) {
    currentFolder = `${currentFolder}/${folder}`;

    if (!app.vault.getAbstractFileByPath(currentFolder))
      app.vault.createFolder(currentFolder);
  }
}
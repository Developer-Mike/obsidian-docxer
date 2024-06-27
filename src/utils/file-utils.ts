import { App } from "obsidian"

export default class FileUtils {
  static toUnixPath(path: string): string {
    return path.replace(/\\/g, "/")
  }

  static joinPath(path1: string | null, path2: string | null): string {
    if (!path2) return FileUtils.toUnixPath(path1 ?? "")
    if (!path1) return FileUtils.toUnixPath(path2 ?? "")
    
    return `${FileUtils.toUnixPath(path1).replace(/\/$/, "")}/${FileUtils.toUnixPath(path2)}`
  }

  static dirname(path: string): string {
    return FileUtils.toUnixPath(path).replace(/[^\/]*\/?$/, "")
  }

  static filename(path: string, withExtension: boolean): string {
    const unixPath = FileUtils.toUnixPath(path)
    return withExtension ? unixPath.replace(/.*\//, "") : unixPath.replace(/.*\//, "").replace(/\.[^\.]*$/, "")
  }

  static toValidFilename(filename: string): string {
    // " * / : < > ? \ | + , . ; = [ ] ! @
    return filename.replace(/[\/\\:*?"<>|+,.=;!@[\]\n]/g, "")
  }

  static async createMissingFolders(app: App, filepath: string) {
    const dirname = FileUtils.dirname(filepath)
    const folders = dirname.split("/").filter(folder => folder !== "")

    let currentFolder = null
    for (const folder of folders) {
      currentFolder = FileUtils.joinPath(currentFolder, folder)

      if (!app.vault.getAbstractFileByPath(currentFolder))
        await app.vault.createFolder(currentFolder)
    }
  }

  static async createBinary(app: App, directory: string, filename: string, fallbackFilename: string, extension: string, binary: ArrayBuffer): Promise<string> {
    let validFilename = FileUtils.toValidFilename(filename)
    if (validFilename === "") validFilename = fallbackFilename

    let filepath = FileUtils.joinPath(directory, `${validFilename}.${extension}`)

    let fallbackIndex = 1
    while (app.vault.getAbstractFileByPath(filepath)) {
      filepath = FileUtils.joinPath(directory, `${validFilename} ${fallbackIndex}.${extension}`)
      fallbackIndex++
    }

    await FileUtils.createMissingFolders(app, filepath)
    await app.vault.createBinary(filepath, binary)

    return filepath
  }
}
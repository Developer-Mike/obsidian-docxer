import { Notice, TFile } from "obsidian"
import DocxerPlugin from "src/main"
import { decryptDocx, IncorrectPasswordError, isEncryptedDocx, UnsupportedEncryptionError } from "./docx-encryption"
import { promptForDocxPassword } from "src/ui/password-modal"

export async function readDocxBuffer(
  plugin: DocxerPlugin,
  file: TFile,
  options: { prompt: boolean } = { prompt: true },
): Promise<ArrayBuffer | null> {
  const raw = await plugin.app.vault.readBinary(file)
  if (!isEncryptedDocx(raw)) return raw

  const cached = plugin.getDocxPassword(file.path)
  if (cached) {
    try {
      return decryptDocx(raw, cached)
    } catch (error) {
      if (!(error instanceof IncorrectPasswordError)) throw error
      plugin.forgetDocxPassword(file.path)
    }
  }

  if (!options.prompt) return null

  for (;;) {
    const password = await promptForDocxPassword(plugin.app, file.basename)
    if (password == null) return null
    if (!password) {
      new Notice("Enter a password to open this document.")
      continue
    }

    try {
      const decrypted = decryptDocx(raw, password)
      plugin.rememberDocxPassword(file.path, password)
      return decrypted
    } catch (error) {
      if (error instanceof IncorrectPasswordError) {
        new Notice("Incorrect password.")
        continue
      }
      if (error instanceof UnsupportedEncryptionError) {
        new Notice(error.message)
        return null
      }
      throw error
    }
  }
}

export function createLockedPreview(
  file: TFile,
  onUnlock: () => Promise<HTMLElement | null>,
): HTMLElement {
  const view = document.createElement("div")
  view.className = "docxer-locked"

  const message = document.createElement("p")
  message.innerText = `"${file.basename}" is password protected.`
  view.appendChild(message)

  const button = document.createElement("button")
  button.innerText = "Unlock"
  button.onclick = async () => {
    button.disabled = true
    try {
      const preview = await onUnlock()
      if (preview) view.replaceWith(preview)
    } finally {
      button.disabled = false
    }
  }
  view.appendChild(button)

  return view
}

import { App, Modal, Setting } from "obsidian"

export default class PasswordModal extends Modal {
  private fileName: string
  private resolve: (password: string | null) => void
  private password = ""
  private settled = false

  constructor(app: App, fileName: string, resolve: (password: string | null) => void) {
    super(app)
    this.fileName = fileName
    this.resolve = resolve
  }

  onOpen() {
    this.titleEl.setText("Password protected document")
    this.contentEl.createEl("p", {
      text: `"${this.fileName}" is encrypted. Enter the password to open it. The password is kept in memory for this session only.`,
    })

    new Setting(this.contentEl)
      .setName("Password")
      .addText((text) => {
        text.inputEl.type = "password"
        text.inputEl.autocomplete = "off"
        text.setPlaceholder("Enter password")
        text.onChange((value) => {
          this.password = value
        })
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            this.submit()
          }
        })
        window.setTimeout(() => text.inputEl.focus(), 20)
      })

    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Unlock").setCta().onClick(() => this.submit())
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      )
  }

  onClose() {
    this.contentEl.empty()
    if (!this.settled) this.resolve(null)
  }

  private submit() {
    if (this.settled) return
    this.settled = true
    this.close()
    this.resolve(this.password)
  }
}

export function promptForDocxPassword(app: App, fileName: string): Promise<string | null> {
  return new Promise((resolve) => {
    new PasswordModal(app, fileName, resolve).open()
  })
}

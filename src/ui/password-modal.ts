import { App, Modal, Notice, Setting } from "obsidian"

export type PasswordSubmitResult =
  | { status: "ok" }
  | { status: "error", message: string }
  | { status: "abort", message?: string }

export type PasswordSubmitHandler = (password: string) => PasswordSubmitResult | Promise<PasswordSubmitResult>

export default class PasswordModal extends Modal {
  private fileName: string
  private onSubmit: PasswordSubmitHandler
  private resolve: (unlocked: boolean) => void
  private reject: (error: unknown) => void
  private password = ""
  private settled = false
  private submitting = false
  private unlocked = false
  private inputEl: HTMLInputElement | null = null
  private errorEl: HTMLElement | null = null
  private unlockButtonEl: HTMLButtonElement | null = null

  constructor(
    app: App,
    fileName: string,
    onSubmit: PasswordSubmitHandler,
    resolve: (unlocked: boolean) => void,
    reject: (error: unknown) => void,
  ) {
    super(app)
    this.fileName = fileName
    this.onSubmit = onSubmit
    this.resolve = resolve
    this.reject = reject
  }

  onOpen() {
    this.titleEl.setText("Password protected document")
    this.contentEl.createEl("p", {
      text: `"${this.fileName}" is encrypted. Enter the password to open it. The decrypted document is kept in memory for this session only; the password is not stored.`,
    })

    new Setting(this.contentEl)
      .setName("Password")
      .addText((text) => {
        this.inputEl = text.inputEl
        text.inputEl.type = "password"
        text.inputEl.autocomplete = "off"
        text.setPlaceholder("Enter password")
        text.onChange((value) => {
          this.password = value
          if (this.errorEl) this.errorEl.setText("")
        })
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            void this.submit()
          }
        })
        window.setTimeout(() => {
          if (!this.settled) this.inputEl?.focus()
        }, 20)
      })

    this.errorEl = this.contentEl.createEl("p", { cls: "docxer-password-error" })

    new Setting(this.contentEl)
      .addButton((button) => {
        this.unlockButtonEl = button.buttonEl
        return button.setButtonText("Unlock").setCta().onClick(() => {
          void this.submit()
        })
      })
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      )
  }

  onClose() {
    this.password = ""
    if (this.inputEl) this.inputEl.value = ""
    this.inputEl = null
    this.errorEl = null
    this.unlockButtonEl = null
    this.contentEl.empty()
    this.finishResolve(this.unlocked)
  }

  cancel() {
    this.password = ""
    try {
      this.close()
    } catch {
      this.finishResolve(false)
    }
  }

  private setSubmitting(submitting: boolean) {
    this.submitting = submitting
    if (this.inputEl) this.inputEl.disabled = submitting
    if (this.unlockButtonEl) this.unlockButtonEl.disabled = submitting
  }

  private showError(message: string) {
    if (this.errorEl) this.errorEl.setText(message)
  }

  private async submit() {
    if (this.settled || this.submitting) return
    const attempt = this.password
    if (!attempt) {
      this.showError("Enter a password to open this document.")
      this.inputEl?.focus()
      return
    }

    this.setSubmitting(true)
    this.showError("")
    try {
      const result = await this.onSubmit(attempt)
      if (this.settled) return

      if (result.status === "ok") {
        this.unlocked = true
        this.password = ""
        if (this.inputEl) this.inputEl.value = ""
        this.close()
        return
      }

      if (result.status === "abort") {
        this.password = ""
        if (this.inputEl) this.inputEl.value = ""
        if (result.message) new Notice(result.message)
        this.close()
        return
      }

      this.setSubmitting(false)
      this.password = ""
      if (this.inputEl) {
        this.inputEl.value = ""
        this.inputEl.focus()
      }
      this.showError(result.message)
    } catch (error) {
      this.password = ""
      if (this.inputEl) this.inputEl.value = ""
      this.finishReject(error)
      try {
        this.close()
      } catch {
        // Ignore close failures after unexpected error.
      }
    }
  }

  private finishResolve(value: boolean) {
    if (this.settled) return
    this.settled = true
    this.resolve(value)
  }

  private finishReject(error: unknown) {
    if (this.settled) return
    this.settled = true
    this.reject(error)
  }
}

export function promptForDocxPassword(
  app: App,
  fileName: string,
  onSubmit: PasswordSubmitHandler,
): { promise: Promise<boolean>, cancel: () => void } {
  let modal: PasswordModal
  const promise = new Promise<boolean>((resolve, reject) => {
    modal = new PasswordModal(app, fileName, onSubmit, resolve, reject)
    modal.open()
  })
  return {
    promise,
    cancel: () => modal?.cancel(),
  }
}

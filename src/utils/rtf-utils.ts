export default class RtfUtils {
  static isRtf(content: string): boolean {
    return content.trimStart().startsWith("{\\rtf")
  }

  static toMarkdown(content: string): string {
    const parser = new RtfMarkdownParser(content)
    return RtfUtils.cleanupMarkdown(parser.parse())
  }

  private static cleanupMarkdown(markdown: string): string {
    return markdown
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      + "\n"
  }
}

type ParserState = {
  skip: boolean
  uc: number
}

class RtfMarkdownParser {
  private index = 0
  private output = ""
  private state: ParserState = { skip: false, uc: 1 }
  private stack: ParserState[] = []
  private charsToSkip = 0

  private readonly skippableDestinations = new Set([
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "generator",
    "mmathPr",
    "fldinst",
    "datastore",
    "themedata",
  ])

  constructor(private readonly input: string) {}

  parse(): string {
    while (this.index < this.input.length) {
      const char = this.input[this.index]

      if (this.charsToSkip > 0) {
        this.charsToSkip--
        this.index++
        continue
      }

      if (char === "{") {
        this.stack.push({ ...this.state })
        this.index++
        continue
      }

      if (char === "}") {
        this.state = this.stack.pop() ?? this.state
        this.index++
        continue
      }

      if (char === "\\") {
        this.readControl()
        continue
      }

      this.append(char)
      this.index++
    }

    return this.output
  }

  private readControl(): void {
    this.index++
    const controlStart = this.index
    const first = this.input[this.index]

    if (first === "'") {
      this.index++
      const hex = this.input.slice(this.index, this.index + 2)
      this.index += 2
      this.append(this.decodeHex(hex))
      return
    }

    if (!/[a-zA-Z*~{}\\_-]/.test(first ?? "")) {
      this.index++
      return
    }

    if (!/[a-zA-Z]/.test(first ?? "")) {
      this.handleSymbol(first)
      this.index++
      return
    }

    while (/[a-zA-Z]/.test(this.input[this.index] ?? "")) this.index++
    const word = this.input.slice(controlStart, this.index)

    let parameter: number | null = null
    let sign = 1
    if (this.input[this.index] === "-") {
      sign = -1
      this.index++
    }

    const parameterStart = this.index
    while (/[0-9]/.test(this.input[this.index] ?? "")) this.index++
    if (this.index > parameterStart) {
      parameter = Number(this.input.slice(parameterStart, this.index)) * sign
    }

    if (this.input[this.index] === " ") this.index++
    this.handleControlWord(word, parameter)
  }

  private handleSymbol(symbol: string): void {
    if (this.state.skip) return

    switch (symbol) {
      case "~":
        this.output += " "
        break
      case "_":
        this.output += "-"
        break
      case "{":
      case "}":
      case "\\":
        this.output += symbol
        break
    }
  }

  private handleControlWord(word: string, parameter: number | null): void {
    if (this.skippableDestinations.has(word)) {
      this.state.skip = true
      return
    }

    if (this.state.skip) return

    switch (word) {
      case "par":
      case "sect":
        this.output += "\n\n"
        break
      case "line":
        this.output += "\n"
        break
      case "tab":
        this.output += "\t"
        break
      case "emdash":
        this.output += "--"
        break
      case "endash":
        this.output += "-"
        break
      case "bullet":
        this.output += "- "
        break
      case "u":
        if (parameter !== null) {
          this.appendUnicode(parameter)
          this.charsToSkip = this.state.uc
        }
        break
      case "uc":
        this.state.uc = parameter ?? 1
        break
    }
  }

  private append(text: string): void {
    if (this.state.skip) return
    this.output += text
  }

  private appendUnicode(value: number): void {
    const codePoint = value < 0 ? value + 65536 : value
    this.output += String.fromCharCode(codePoint)
  }

  private decodeHex(hex: string): string {
    const value = parseInt(hex, 16)
    if (Number.isNaN(value)) return ""

    const cp1252: Record<number, string> = {
      0x80: "EUR", 0x82: "'", 0x83: "f", 0x84: "\"", 0x85: "...", 0x86: "+", 0x87: "++",
      0x88: "^", 0x89: "%", 0x8a: "S", 0x8b: "<", 0x8c: "OE", 0x8e: "Z",
      0x91: "'", 0x92: "'", 0x93: "\"", 0x94: "\"", 0x95: "*", 0x96: "-", 0x97: "--",
      0x98: "~", 0x99: "TM", 0x9a: "s", 0x9b: ">", 0x9c: "oe", 0x9e: "z", 0x9f: "Y",
    }

    if (cp1252[value]) return cp1252[value]
    return String.fromCharCode(value)
  }
}

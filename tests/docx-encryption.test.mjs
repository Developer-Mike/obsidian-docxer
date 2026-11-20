import { build } from "esbuild"
import { mkdtempSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { spawnSync } from "child_process"
import officeCrypto from "officecrypto-tool"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const bundlePath = join(root, "tests/.bundle.mjs")

await build({
  entryPoints: [join(root, "src/utils/docx-encryption.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundlePath,
})

const {
  decryptDocx,
  isEncryptedDocx,
  IncorrectPasswordError,
} = await import(pathToFileURL(bundlePath).href)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function createPlainDocx() {
  const dir = mkdtempSync(join(tmpdir(), "docxer-plain-"))
  const path = join(dir, "plain.docx")
  const script = `
import zipfile
z = zipfile.ZipFile(${JSON.stringify(path)}, "w")
z.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
""")
z.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
""")
z.writestr("word/document.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Docxer password test</w:t></w:r></w:p></w:body>
</w:document>
""")
z.close()
`
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr || "Failed to create test docx")
  return readFileSync(path)
}

const plain = createPlainDocx()
const password = "correct horse battery staple"
const agile = officeCrypto.encrypt(plain, { password })
const standard = officeCrypto.encrypt(plain, { password, type: "standard" })

assert(!isEncryptedDocx(plain), "plain docx should not look encrypted")
assert(isEncryptedDocx(agile), "agile docx should be detected as encrypted")
assert(isEncryptedDocx(standard), "standard docx should be detected as encrypted")

const agileOut = Buffer.from(decryptDocx(agile, password))
const standardOut = Buffer.from(decryptDocx(standard, password))
assert(agileOut.equals(plain), "agile decrypt should match original bytes")
assert(standardOut.equals(plain), "standard decrypt should match original bytes")
assert(Buffer.from(decryptDocx(plain, "unused")).equals(plain), "unencrypted files should pass through")

let wrongPasswordThrew = false
try {
  decryptDocx(agile, "not-the-password")
} catch (error) {
  wrongPasswordThrew = error instanceof IncorrectPasswordError || error?.name === "IncorrectPasswordError"
}
assert(wrongPasswordThrew, "wrong password should throw IncorrectPasswordError")

const samplePath = process.env.DOCX_SAMPLE_PATH
if (samplePath) {
  const sample = readFileSync(samplePath)
  assert(isEncryptedDocx(sample), "real Word sample should be detected as encrypted")
  const samplePasswordPath = process.env.DOCX_SAMPLE_PASSWORD_FILE
  if (samplePasswordPath) {
    const samplePassword = readFileSync(samplePasswordPath, "utf8").replace(/\r?\n$/, "")
    const sampleOut = Buffer.from(decryptDocx(sample, samplePassword))
    assert(sampleOut.subarray(0, 2).toString() === "PK", "real Word sample should decrypt to a zip")
    console.log("real Word sample decrypted", sampleOut.length, "bytes")
  }
}

console.log("docx encryption tests passed")

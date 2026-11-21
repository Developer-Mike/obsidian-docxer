import { build } from "esbuild"
import { mkdtempSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { spawnSync } from "child_process"
import officeCrypto from "officecrypto-tool"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const bundleDir = join(root, "tests/.bundle")

await build({
  entryPoints: [
    join(root, "src/utils/docx-encryption.ts"),
    join(root, "src/utils/docx-unlock-cache.ts"),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: bundleDir,
})

const {
  decryptDocx,
  isEncryptedDocx,
  IncorrectPasswordError,
} = await import(pathToFileURL(join(bundleDir, "docx-encryption.js")).href)
const {
  default: DocxUnlockCache,
  versionsEqual,
  zeroArrayBuffer,
} = await import(pathToFileURL(join(bundleDir, "docx-unlock-cache.js")).href)

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

const decrypted = decryptDocx(agile, password)

const cache = new DocxUnlockCache()
const version = { path: "sample.docx", mtime: 1, size: agile.length }
cache.set(1, version, decrypted)
const cached = cache.get(1, version)
assert(cached && Buffer.from(cached).equals(plain), "session cache should return the decrypted document")
assert(!cache.get(2, version), "a new session must not reuse the previous unlock grant")
assert(!cache.hasGrant(2, version), "a new session must not report a grant from the previous session")
assert(!cache.hasGrant(1, { ...version, mtime: 2 }), "a changed mtime must not reuse the previous unlock grant")
assert(!cache.hasGrant(1, { ...version, size: version.size + 1 }), "a changed size must not reuse the previous unlock grant")
assert(cached !== decrypted, "cached bytes should be a copy, not the original buffer")
zeroArrayBuffer(cached)
const cachedAgain = cache.get(1, version)
assert(cachedAgain && Buffer.from(cachedAgain).equals(plain), "mutating a returned copy must not alter the cached buffer")
const storedBeforeDelete = cache.records.get(version.path).decrypted
assert(new Uint8Array(storedBeforeDelete).some((b) => b !== 0), "stored cache buffer should contain non-zero decrypted bytes")
assert(cache.delete(version.path), "an existing grant should be removable on rename/delete")
assert(new Uint8Array(storedBeforeDelete).every((b) => b === 0), "delete must zero the cached ArrayBuffer")
assert(!cache.hasGrant(1, version), "removed grants must not authorize a later preview")

const version2 = { path: "sample.docx", mtime: 2, size: agile.length }
cache.set(1, version, decrypted)
const storedBeforeOverwrite = cache.records.get(version.path).decrypted
cache.set(1, version2, decrypted)
assert(new Uint8Array(storedBeforeOverwrite).every((b) => b === 0), "overwriting a cache entry must zero the previous ArrayBuffer")
const storedBeforeClear = cache.records.get(version2.path).decrypted
cache.clear()
assert(new Uint8Array(storedBeforeClear).every((b) => b === 0), "clear must zero all cached ArrayBuffers")
assert(!cache.hasGrant(1, version2), "cleared grants must not authorize a later preview")

const scratch = new Uint8Array([1, 2, 3, 4]).buffer
zeroArrayBuffer(scratch)
assert(new Uint8Array(scratch).every((b) => b === 0), "zeroArrayBuffer must overwrite all bytes with zero")
assert(versionsEqual(version, { ...version }), "versionsEqual should match identical versions")
assert(!versionsEqual(version, version2), "versionsEqual should reject changed mtime")
assert(!versionsEqual(version, { ...version, size: version.size + 1 }), "versionsEqual should reject changed size")

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

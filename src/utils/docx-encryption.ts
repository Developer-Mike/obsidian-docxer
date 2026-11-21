import * as CFB from "cfb"
import { cbc, ecb } from "@noble/ciphers/aes.js"
import { sha1 } from "@noble/hashes/legacy.js"
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js"

const OLE_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const PACKAGE_CHUNK_SIZE = 4096
const STANDARD_SPIN_COUNT = 50000

const AGILE_BLOCK_KEYS = {
  key: Uint8Array.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]),
  verifierHashInput: Uint8Array.from([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]),
  verifierHashValue: Uint8Array.from([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]),
}

type HashName = "SHA1" | "SHA256" | "SHA384" | "SHA512"

export class IncorrectPasswordError extends Error {
  constructor() {
    super("The password is incorrect")
    this.name = "IncorrectPasswordError"
  }
}

export class UnsupportedEncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedEncryptionError"
  }
}

export function isEncryptedDocx(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = toBytes(data)
  if (!hasPrefix(bytes, OLE_MAGIC)) return false

  try {
    return findStream(bytes, "/EncryptionInfo") !== null
  } catch {
    return false
  }
}

export function decryptDocx(data: ArrayBuffer | Uint8Array, password: string): ArrayBuffer {
  const bytes = toBytes(data)
  if (!isEncryptedDocx(bytes)) {
    return copyToArrayBuffer(bytes)
  }

  const encryptionInfo = findStream(bytes, "/EncryptionInfo")
  const encryptedPackage = findStream(bytes, "/EncryptedPackage")
  if (!encryptionInfo || !encryptedPackage) {
    throw new UnsupportedEncryptionError("Encrypted document is missing required streams")
  }

  const minor = readU16LE(encryptionInfo, 2)
  if (minor === 0x04) return copyToArrayBuffer(decryptAgile(encryptionInfo, encryptedPackage, password))
  if (minor === 0x02) return copyToArrayBuffer(decryptStandard(encryptionInfo, encryptedPackage, password))

  throw new UnsupportedEncryptionError("Unsupported Office encryption algorithm")
}

function decryptAgile(encryptionInfo: Uint8Array, encryptedPackage: Uint8Array, password: string): Uint8Array {
  const xml = new TextDecoder("utf-8").decode(encryptionInfo.subarray(8))
  const keyData = getTagAttributes(xml, "keyData")
  const encryptedKey = getTagAttributes(xml, "encryptedKey")

  const packageCipher = requireAesCbc(keyData.cipherAlgorithm, keyData.cipherChaining)
  const keyCipher = requireAesCbc(encryptedKey.cipherAlgorithm, encryptedKey.cipherChaining)
  const packageHash = parseHash(keyData.hashAlgorithm)
  const keyHash = parseHash(encryptedKey.hashAlgorithm)
  const packageBlockSize = parseInt(keyData.blockSize, 10)
  const keyBits = parseInt(encryptedKey.keyBits, 10)
  const spinCount = parseInt(encryptedKey.spinCount, 10)
  const packageSalt = fromBase64(keyData.saltValue)
  const keySalt = fromBase64(encryptedKey.saltValue)

  const spun = spinPassword(password, keyHash, keySalt, spinCount)
  if (!verifyAgilePassword(spun, encryptedKey, keyHash, keyCipher, keySalt, keyBits)) {
    throw new IncorrectPasswordError()
  }

  const packageKey = aesDecrypt(
    keyCipher,
    finalizeKey(spun, keyHash, AGILE_BLOCK_KEYS.key, keyBits),
    keySalt,
    fromBase64(encryptedKey.encryptedKeyValue),
  )

  const decrypted = decryptPackageChunks(
    packageCipher,
    packageHash,
    packageBlockSize,
    packageSalt,
    packageKey,
    encryptedPackage,
  )

  if (!isZip(decrypted)) throw new IncorrectPasswordError()
  return decrypted
}

function verifyAgilePassword(
  spun: Uint8Array,
  encryptedKey: Record<string, string>,
  hash: HashName,
  cipher: "cbc",
  salt: Uint8Array,
  keyBits: number,
): boolean {
  const verifierInput = aesDecrypt(
    cipher,
    finalizeKey(spun, hash, AGILE_BLOCK_KEYS.verifierHashInput, keyBits),
    salt,
    fromBase64(encryptedKey.encryptedVerifierHashInput),
  )
  const verifierHash = aesDecrypt(
    cipher,
    finalizeKey(spun, hash, AGILE_BLOCK_KEYS.verifierHashValue, keyBits),
    salt,
    fromBase64(encryptedKey.encryptedVerifierHashValue),
  )
  const actualHash = digest(hash, verifierInput)
  return equalPrefix(actualHash, verifierHash, actualHash.length)
}

function decryptStandard(encryptionInfo: Uint8Array, encryptedPackage: Uint8Array, password: string): Uint8Array {
  const header = parseStandardHeader(encryptionInfo)
  const key = standardPasswordToKey(password, header.salt, header.keySize)
  if (!verifyStandardPassword(key, header.verifier, header.verifierHash)) {
    throw new IncorrectPasswordError()
  }

  const decrypted = decryptStandardPackage(key, encryptedPackage)
  if (!isZip(decrypted)) throw new IncorrectPasswordError()
  return decrypted
}

function parseStandardHeader(blob: Uint8Array) {
  let offset = 0
  offset += 2 // major
  offset += 2 // minor
  const flags = readU32LE(blob, offset); offset += 4
  if ((flags & 0x3f) !== 0x24) throw new UnsupportedEncryptionError("Unsupported standard encryption flags")
  const headerSize = readU32LE(blob, offset); offset += 4
  const headerEnd = offset + headerSize

  offset += 4 // header flags
  offset += 4 // sizeExtra
  const algId = readU32LE(blob, offset); offset += 4
  offset += 4 // algIdHash
  const keySize = readU32LE(blob, offset); offset += 4
  offset += 4 // providerType
  offset += 8 // reserved
  offset = headerEnd

  const saltSize = readU32LE(blob, offset); offset += 4
  if (saltSize !== 16) throw new UnsupportedEncryptionError("Unexpected salt size")
  const salt = blob.subarray(offset, offset + 16); offset += 16
  const verifier = blob.subarray(offset, offset + 16); offset += 16
  const verifierHashSize = readU32LE(blob, offset); offset += 4
  const verifierHash = blob.subarray(offset, offset + Math.max(verifierHashSize, 32))

  if (![0x660e, 0x660f, 0x6610].includes(algId)) {
    throw new UnsupportedEncryptionError("Unsupported standard encryption algorithm")
  }

  return { keySize, salt: new Uint8Array(salt), verifier: new Uint8Array(verifier), verifierHash: new Uint8Array(verifierHash) }
}

function standardPasswordToKey(password: string, salt: Uint8Array, keySizeBits: number): Uint8Array {
  const passwordBytes = utf16le(password)
  let hash = sha1(concat(salt, passwordBytes))
  for (let i = 0; i < STANDARD_SPIN_COUNT; i++) {
    hash = sha1(concat(uint32le(i), hash))
  }
  const hfinal = sha1(concat(hash, uint32le(0)))
  const buf1 = new Uint8Array(64).fill(0x36)
  xorInto(buf1, hfinal)
  const buf2 = new Uint8Array(64).fill(0x5c)
  xorInto(buf2, hfinal)
  return concat(sha1(buf1), sha1(buf2)).subarray(0, keySizeBits / 8)
}

function verifyStandardPassword(key: Uint8Array, encryptedVerifier: Uint8Array, encryptedVerifierHash: Uint8Array): boolean {
  const verifier = aesEcbDecrypt(key, padBlock(encryptedVerifier, 16))
  const verifierHash = aesEcbDecrypt(key, padBlock(encryptedVerifierHash, 16)).subarray(0, 20)
  return equalBytes(sha1(verifier), verifierHash)
}

function decryptStandardPackage(key: Uint8Array, input: Uint8Array): Uint8Array {
  const totalSize = readU32LE(input, 0)
  const encrypted = input.subarray(8)
  const chunks: Uint8Array[] = []
  for (let start = 0; start < encrypted.length; start += PACKAGE_CHUNK_SIZE) {
    const chunk = padBlock(encrypted.subarray(start, start + PACKAGE_CHUNK_SIZE), 16)
    chunks.push(aesEcbDecrypt(key, chunk))
  }
  return concat(...chunks).subarray(0, totalSize)
}

function spinPassword(password: string, hash: HashName, salt: Uint8Array, spinCount: number): Uint8Array {
  let key = digest(hash, concat(salt, utf16le(password)))
  for (let i = 0; i < spinCount; i++) {
    key = digest(hash, concat(uint32le(i), key))
  }
  return key
}

function finalizeKey(spun: Uint8Array, hash: HashName, blockKey: Uint8Array, keyBits: number): Uint8Array {
  return resizeKey(digest(hash, concat(spun, blockKey)), keyBits / 8)
}

function decryptPackageChunks(
  cipher: "cbc",
  hash: HashName,
  blockSize: number,
  salt: Uint8Array,
  key: Uint8Array,
  input: Uint8Array,
): Uint8Array {
  const totalSize = readU32LE(input, 0)
  const encrypted = input.subarray(8)
  const chunks: Uint8Array[] = []
  for (let i = 0, start = 0; start < encrypted.length; i++, start += PACKAGE_CHUNK_SIZE) {
    const chunk = padBlock(encrypted.subarray(start, start + PACKAGE_CHUNK_SIZE), blockSize)
    const iv = resizeKey(digest(hash, concat(salt, uint32le(i))), blockSize)
    chunks.push(aesDecrypt(cipher, key, iv, chunk))
  }
  return concat(...chunks).subarray(0, totalSize)
}

function requireAesCbc(algorithm: string | undefined, chaining: string | undefined): "cbc" {
  if ((algorithm ?? "AES").toUpperCase() !== "AES") {
    throw new UnsupportedEncryptionError(`Unsupported cipher: ${algorithm}`)
  }
  if ((chaining ?? "ChainingModeCBC") !== "ChainingModeCBC") {
    throw new UnsupportedEncryptionError(`Unsupported chaining mode: ${chaining}`)
  }
  return "cbc"
}

function parseHash(name: string | undefined): HashName {
  const normalized = (name ?? "SHA512").toUpperCase().replace("-", "")
  if (normalized === "SHA1" || normalized === "SHA256" || normalized === "SHA384" || normalized === "SHA512") {
    return normalized
  }
  throw new UnsupportedEncryptionError(`Unsupported hash algorithm: ${name}`)
}

function digest(name: HashName, data: Uint8Array): Uint8Array {
  if (name === "SHA1") return sha1(data)
  if (name === "SHA256") return sha256(data)
  if (name === "SHA384") return sha384(data)
  return sha512(data)
}

function aesDecrypt(mode: "cbc", key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  return cbc(key, iv, { disablePadding: true }).decrypt(data)
}

function aesEcbDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  return ecb(key, { disablePadding: true }).decrypt(data)
}

function findStream(data: Uint8Array, path: string): Uint8Array | null {
  const cfb = CFB.read(data, { type: "array" })
  const entry = CFB.find(cfb, path)
  if (!entry || entry.content == null) return null
  return toBytes(entry.content as Uint8Array | number[])
}

function getTagAttributes(xml: string, tagName: string): Record<string, string> {
  const match = xml.match(new RegExp(`<(?:[\\w]+:)?${tagName}\\s+([^>]+)`))
  if (!match) throw new UnsupportedEncryptionError(`Missing ${tagName} in encryption info`)
  const attrs: Record<string, string> = {}
  const attrRe = /([\w:]+)="([^"]*)"/g
  let attr: RegExpExecArray | null
  while ((attr = attrRe.exec(match[1]))) attrs[attr[1]] = attr[2]
  return attrs
}

function toBytes(data: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) return Uint8Array.from(data)
  return new Uint8Array(data)
}

function copyToArrayBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer as ArrayBuffer
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function uint32le(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8)
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function utf16le(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    out[i * 2] = code & 0xff
    out[i * 2 + 1] = code >> 8
  }
  return out
}

function fromBase64(value: string | undefined): Uint8Array {
  if (!value) throw new UnsupportedEncryptionError("Missing encryption field")
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function resizeKey(key: Uint8Array, size: number): Uint8Array {
  if (key.length === size) return key
  if (key.length > size) return key.subarray(0, size)
  const padded = new Uint8Array(size).fill(0x36)
  padded.set(key)
  return padded
}

function padBlock(data: Uint8Array, blockSize: number): Uint8Array {
  const remainder = data.length % blockSize
  if (remainder === 0) return data.length ? data : new Uint8Array(blockSize)
  return concat(data, new Uint8Array(blockSize - remainder))
}

function hasPrefix(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false
  return true
}

function isZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  return equalPrefix(a, b, a.length)
}

function equalPrefix(a: Uint8Array, b: Uint8Array, length: number): boolean {
  if (a.length < length || b.length < length) return false
  let diff = 0
  for (let i = 0; i < length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function xorInto(target: Uint8Array, other: Uint8Array) {
  const n = Math.min(target.length, other.length)
  for (let i = 0; i < n; i++) target[i] ^= other[i]
}

// The runtime has these, but the ES2023 library the engine types mods with
// does not.
interface Uint8Array {
  toBase64(): string
}
interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array<ArrayBuffer>
}

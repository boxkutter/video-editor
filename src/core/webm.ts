/**
 * MediaRecorder writes a WebM file without a duration, so players show an unknown length and
 * cannot seek well. This adds the Duration element to the file's Info section (ADR 0068). It
 * reads the EBML structure only as far as the Info element and returns the original bytes
 * unchanged when the file is not a WebM of the shape MediaRecorder writes (a segment of unknown
 * size, or a known size that can be grown in place), so it can never make a file worse.
 * Pure: unit-tested in tests/videoWebm.test.ts.
 */

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}

function readId(bytes: Uint8Array, at: number): { id: number; length: number } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 4 || at + length > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + bytes[at + i]!;
  return { id, length };
}

function readSize(bytes: Uint8Array, at: number): Vint | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length += 1;
  if (at + length > bytes.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + bytes[at + i]!;
    if (bytes[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

function writeSize(value: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7; i >= 1; i -= 1) {
    out[i] = value % 256;
    value = Math.floor(value / 256);
  }
  return out;
}

/** The file with a Duration (milliseconds) written into its Info section, or the same bytes if that cannot be done safely. */
export function withDuration(bytes: Uint8Array, durationMs: number): Uint8Array {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return bytes;
  const head = readId(bytes, 0);
  if (!head || head.id !== EBML) return bytes;
  const headSize = readSize(bytes, head.length);
  if (!headSize || headSize.unknown) return bytes;
  const segmentAt = head.length + headSize.length + headSize.value;
  const segment = readId(bytes, segmentAt);
  if (!segment || segment.id !== SEGMENT) return bytes;
  const segmentSizeAt = segmentAt + segment.length;
  const segmentSize = readSize(bytes, segmentSizeAt);
  if (!segmentSize) return bytes;
  let at = segmentSizeAt + segmentSize.length;
  // walk the segment's children to the Info element
  for (let guard = 0; guard < 64 && at < bytes.length; guard += 1) {
    const id = readId(bytes, at);
    if (!id) return bytes;
    const size = readSize(bytes, at + id.length);
    if (!size || size.unknown) return bytes;
    const bodyAt = at + id.length + size.length;
    if (id.id === INFO) {
      let scale = 1_000_000;
      let child = bodyAt;
      while (child < bodyAt + size.value) {
        const cid = readId(bytes, child);
        const csize = cid ? readSize(bytes, child + cid.length) : null;
        if (!cid || !csize || csize.unknown) return bytes;
        const cbody = child + cid.length + csize.length;
        if (cid.id === DURATION) return bytes; // already has one
        if (cid.id === TIMECODE_SCALE) {
          let v = 0;
          for (let i = 0; i < csize.value; i += 1) v = v * 256 + bytes[cbody + i]!;
          scale = v || scale;
        }
        child = cbody + csize.value;
      }
      const units = (durationMs * 1_000_000) / scale;
      const duration = new Uint8Array(11);
      duration[0] = 0x44;
      duration[1] = 0x89;
      duration[2] = 0x88;
      new DataView(duration.buffer).setFloat64(3, units, false);
      const newInfoSize = writeSize(size.value + duration.length);
      const grown = newInfoSize.length - size.length + duration.length;
      const out = new Uint8Array(bytes.length + grown);
      const infoBodyEnd = bodyAt + size.value;
      out.set(bytes.subarray(0, at + id.length), 0);
      out.set(newInfoSize, at + id.length);
      let w = at + id.length + newInfoSize.length;
      out.set(bytes.subarray(bodyAt, infoBodyEnd), w);
      w += size.value;
      out.set(duration, w);
      w += duration.length;
      out.set(bytes.subarray(infoBodyEnd), w);
      if (!segmentSize.unknown) {
        const grownSize = segmentSize.value + grown;
        if (grownSize >= 2 ** (7 * segmentSize.length) - 1) return bytes;
        let rest = grownSize;
        for (let i = segmentSize.length - 1; i >= 0; i -= 1) {
          out[segmentSizeAt + i] = i === 0 ? (rest % 256) | (0x80 >> (segmentSize.length - 1)) : rest % 256;
          rest = Math.floor(rest / 256);
        }
      }
      return out;
    }
    at = bodyAt + size.value;
  }
  return bytes;
}

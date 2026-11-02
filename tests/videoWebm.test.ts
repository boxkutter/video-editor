import { describe, expect, it } from "vitest";
import { withDuration } from "../src/core/webm";

/** A minimal WebM: EBML header, a segment of unknown size holding Info (timecode scale 1 ms) and a Cluster. */
function webm(opts: { unknownSize?: boolean; duration?: boolean } = {}): Uint8Array {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x00]; // header with one child (DocType size 1)
  const scale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]; // 1,000,000
  const dur = opts.duration ? [0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0] : [];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | (scale.length + dur.length), ...scale, ...dur];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x82, 0xe7, 0x81];
  const body = [...info, ...cluster];
  const size = opts.unknownSize === false ? [0x80 | body.length] : [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  return new Uint8Array([...ebml, 0x18, 0x53, 0x80, 0x67, ...size, ...body]);
}

function find(bytes: Uint8Array, pattern: number[]): number {
  outer: for (let i = 0; i <= bytes.length - pattern.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

describe("withDuration", () => {
  it("writes the duration into Info and keeps everything else", () => {
    const input = webm();
    const out = withDuration(input, 12_500);
    expect(out.length).toBe(input.length + 11 + 7); // the duration, and Info's size grown to eight bytes
    const at = find(out, [0x44, 0x89, 0x88]);
    expect(at).toBeGreaterThan(0);
    expect(new DataView(out.buffer, out.byteOffset + at + 3, 8).getFloat64(0, false)).toBe(12_500);
    expect(find(out, [0x1f, 0x43, 0xb6, 0x75])).toBeGreaterThan(at); // the cluster follows intact
  });

  it("grows a known segment size", () => {
    const out = withDuration(webm({ unknownSize: false }), 1000);
    expect(out.length).toBeGreaterThan(webm({ unknownSize: false }).length);
  });

  it("leaves a file alone when it has a duration, is not WebM, or the length is unusable", () => {
    const withIt = webm({ duration: true });
    expect(withDuration(withIt, 1000)).toBe(withIt);
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(withDuration(junk, 1000)).toBe(junk);
    const plain = webm();
    expect(withDuration(plain, 0)).toBe(plain);
    expect(withDuration(plain, Number.NaN)).toBe(plain);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BinaryBitmap } from "./png-bitmap";

const { decodePngBinaryFromBufferMock, decodePngBinaryFromBase64Mock } = vi.hoisted(() => ({
  decodePngBinaryFromBufferMock: vi.fn(),
  decodePngBinaryFromBase64Mock: vi.fn()
}));

vi.mock("./png-bitmap", () => ({
  decodePngBinaryFromBuffer: decodePngBinaryFromBufferMock,
  decodePngBinaryFromBase64: decodePngBinaryFromBase64Mock
}));

import {
  getNextTemplateVariantName,
  matchAgainstTemplates,
  matchAgainstTemplatesBatchBase64,
  saveTemplateFromSample
} from "./template-match";

function createTempPath(name: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function createFakeSample(samplePath: string, content: string): void {
  fs.writeFileSync(samplePath, content, "utf8");
}

function bitmapFromRows(rows: string[]): BinaryBitmap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = rows[y]?.[x] === "1" ? 1 : 0;
    }
  }
  return { width, height, pixels };
}

const bitmaps = {
  sampleA: bitmapFromRows(["010", "111", "010"]),
  sampleB: bitmapFromRows(["111", "001", "111"]),
  digit5: bitmapFromRows(["010", "111", "010"]),
  digit4: bitmapFromRows(["111", "001", "111"]),
  digit1a: bitmapFromRows(["100", "100", "100"]),
  digit1b: bitmapFromRows(["110", "110", "110"]),
  digit3a: bitmapFromRows(["011", "001", "011"]),
  digit8: bitmapFromRows(["111", "111", "111"])
};

function resolveBitmapFromContent(content: string): BinaryBitmap {
  switch (content) {
    case "same-content":
    case "sample-a":
      return bitmaps.sampleA;
    case "sample-b":
      return bitmaps.sampleB;
    case "tpl-5":
      return bitmaps.digit5;
    case "tpl-4":
      return bitmaps.digit4;
    case "tpl-1a":
      return bitmaps.digit1a;
    case "tpl-1b":
      return bitmaps.digit1b;
    case "tpl-3a":
      return bitmaps.digit3a;
    case "tpl-8":
      return bitmaps.digit8;
    default:
      return bitmapFromRows(["000", "000", "000"]);
  }
}

describe("template-match cache", () => {
  beforeEach(() => {
    decodePngBinaryFromBufferMock.mockImplementation((buffer: Buffer) => resolveBitmapFromContent(buffer.toString("utf8")));
    decodePngBinaryFromBase64Mock.mockImplementation((base64: string) =>
      resolveBitmapFromContent(Buffer.from(base64, "base64").toString("utf8"))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses cached result for identical processed sample", async () => {
    const tempDir = createTempPath("sbe-template-match-");
    const samplePath = path.join(tempDir, "sample.proc.png");
    const templatesDir = path.join(tempDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    createFakeSample(samplePath, "same-content");
    createFakeSample(path.join(templatesDir, "5.png"), "tpl-5");

    const first = await matchAgainstTemplates({ samplePath, templatesDir });
    const second = await matchAgainstTemplates({ samplePath, templatesDir });

    expect(first).toEqual(second);
    expect(decodePngBinaryFromBase64Mock).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached directory entries after saving a template", async () => {
    const tempDir = createTempPath("sbe-template-match-");
    const samplePath = path.join(tempDir, "sample.proc.png");
    const templatesDir = path.join(tempDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    createFakeSample(samplePath, "same-content");
    createFakeSample(path.join(templatesDir, "3.png"), "tpl-3a");

    const beforeUpdate = await matchAgainstTemplates({ samplePath, templatesDir });
    createFakeSample(samplePath, "tpl-8");
    saveTemplateFromSample({ samplePath, templatesDir, digit: "8" });
    const afterUpdate = await matchAgainstTemplates({ samplePath, templatesDir });

    expect(beforeUpdate.digit).toBe("3");
    expect(afterUpdate.digit).toBe("8");
  });

  it("matches two samples in one in-memory batch call", async () => {
    const tempDir = createTempPath("sbe-template-match-");
    const templatesDir = path.join(tempDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    createFakeSample(path.join(templatesDir, "5.png"), "tpl-5");
    createFakeSample(path.join(templatesDir, "4.png"), "tpl-4");

    const results = await matchAgainstTemplatesBatchBase64({
      inputs: [
        { samplePngBase64: Buffer.from("sample-a").toString("base64"), templatesDir },
        { samplePngBase64: Buffer.from("sample-b").toString("base64"), templatesDir }
      ]
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.digit).toBe("5");
    expect(results[1]?.digit).toBe("4");
  });

  it("groups template variants by leading digit name", async () => {
    const tempDir = createTempPath("sbe-template-match-");
    const templatesDir = path.join(tempDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    createFakeSample(path.join(templatesDir, "1a.png"), "tpl-1a");
    createFakeSample(path.join(templatesDir, "1b.png"), "tpl-1b");
    createFakeSample(path.join(templatesDir, "3a.png"), "tpl-3a");

    const [result] = await matchAgainstTemplatesBatchBase64({
      inputs: [{ samplePngBase64: Buffer.from("tpl-1b").toString("base64"), templatesDir }]
    });

    expect(result?.digit).toBe("1");
    expect(result?.scores[0]?.digit).toBe("1");
    expect(result?.scores[1]?.digit).toBe("3");
  });

  it("allocates the next shared template variant name for a digit", () => {
    const tempDir = createTempPath("sbe-template-match-");
    const templatesDir = path.join(tempDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });
    createFakeSample(path.join(templatesDir, "1a.png"), "a");
    createFakeSample(path.join(templatesDir, "1b.png"), "b");
    createFakeSample(path.join(templatesDir, "3a.png"), "c");

    expect(getNextTemplateVariantName({ templatesDir, digit: "1" })).toBe("1c");
    expect(getNextTemplateVariantName({ templatesDir, digit: "3" })).toBe("3b");
    expect(getNextTemplateVariantName({ templatesDir, digit: "5" })).toBe("5a");
  });
});

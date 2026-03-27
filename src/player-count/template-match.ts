import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { decodePngBinaryFromBase64, decodePngBinaryFromBuffer, type BinaryBitmap } from "./png-bitmap";

const TEMPLATE_MATCH_CACHE_LIMIT = 512;
const templateMatchCache = new Map<string, TemplateMatchResult>();
const templatesBitmapCache = new Map<string, TemplateBitmap[]>();

type TemplateScore = {
  digit: string;
  score: number;
};

type TemplateBitmap = {
  name: string;
  bitmap: BinaryBitmap;
};

export type TemplateMatchResult = {
  digit: string | null;
  score: number;
  scores: TemplateScore[];
};

type BatchTemplateInput = {
  samplePngBase64: string;
  templatesDir: string;
};

function normalizeTemplateDigit(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = /^(\d)/.exec(trimmed);
  if (match?.[1]) {
    return match[1];
  }
  return trimmed;
}

function getSampleHash(sampleBuffer: Buffer): string {
  return createHash("sha1").update(sampleBuffer).digest("hex");
}

function getTemplatesDirVersion(templatesDir: string): string {
  return String(fs.statSync(templatesDir).mtimeMs);
}

function rememberTemplateMatch(cacheKey: string, value: TemplateMatchResult): void {
  if (templateMatchCache.has(cacheKey)) {
    templateMatchCache.delete(cacheKey);
  }
  templateMatchCache.set(cacheKey, value);

  if (templateMatchCache.size <= TEMPLATE_MATCH_CACHE_LIMIT) {
    return;
  }

  const oldestKey = templateMatchCache.keys().next().value;
  if (oldestKey !== undefined) {
    templateMatchCache.delete(oldestKey);
  }
}

function invalidateTemplateDirCache(templatesDir: string): void {
  const cacheKeyPrefix = `${templatesDir}|`;
  for (const cacheKey of templateMatchCache.keys()) {
    if (cacheKey.startsWith(cacheKeyPrefix)) {
      templateMatchCache.delete(cacheKey);
    }
  }
  for (const cacheKey of templatesBitmapCache.keys()) {
    if (cacheKey.startsWith(cacheKeyPrefix)) {
      templatesBitmapCache.delete(cacheKey);
    }
  }
}

function getPixel(bitmap: BinaryBitmap, x: number, y: number): number {
  return bitmap.pixels[y * bitmap.width + x] ?? 0;
}

function scoreBitmapAgainstTemplate(sample: BinaryBitmap, template: BinaryBitmap): number {
  if (sample.width !== template.width || sample.height !== template.height) {
    return -1;
  }

  let bestScore = -1;
  for (let shiftY = -1; shiftY <= 1; shiftY += 1) {
    for (let shiftX = -1; shiftX <= 1; shiftX += 1) {
      let diff = 0;
      const rowSample = new Array<number>(template.height).fill(0);
      const rowTemplate = new Array<number>(template.height).fill(0);
      const colSample = new Array<number>(template.width).fill(0);
      const colTemplate = new Array<number>(template.width).fill(0);

      for (let y = 0; y < template.height; y += 1) {
        for (let x = 0; x < template.width; x += 1) {
          const sx = x + shiftX;
          const sy = y + shiftY;
          const sampleBit =
            sx >= 0 && sx < sample.width && sy >= 0 && sy < sample.height ? getPixel(sample, sx, sy) : 0;
          const templateBit = getPixel(template, x, y);

          if (sampleBit !== templateBit) {
            diff += 1;
          }

          rowSample[y] += sampleBit;
          rowTemplate[y] += templateBit;
          colSample[x] += sampleBit;
          colTemplate[x] += templateBit;
        }
      }

      let rowDiff = 0;
      for (let index = 0; index < template.height; index += 1) {
        rowDiff += Math.abs(rowSample[index] - rowTemplate[index]);
      }

      let colDiff = 0;
      for (let index = 0; index < template.width; index += 1) {
        colDiff += Math.abs(colSample[index] - colTemplate[index]);
      }

      const total = template.width * template.height;
      const projectionPenalty = (rowDiff + colDiff) / (2 * Math.max(1, total));
      const projectionScore = Math.max(0, 1 - projectionPenalty);
      const xorScore = total > 0 ? 1 - diff / total : 0;
      const score = 0.65 * xorScore + 0.35 * projectionScore;
      if (score > bestScore) {
        bestScore = score;
      }
    }
  }

  return bestScore;
}

function toScores(raw: unknown): TemplateScore[] {
  if (!Array.isArray(raw)) {
    if (raw && typeof raw === "object") {
      return [raw as TemplateScore];
    }
    return [];
  }
  return raw as TemplateScore[];
}

function parseMatchResult(rawScores: unknown): TemplateMatchResult {
  const grouped = new Map<string, number>();
  for (const item of toScores(rawScores)) {
    const digit = normalizeTemplateDigit(item.digit);
    if (!digit) {
      continue;
    }
    const previous = grouped.get(digit);
    if (previous === undefined || item.score > previous) {
      grouped.set(digit, item.score);
    }
  }

  const scores = [...grouped.entries()].map(([digit, score]) => ({ digit, score }));
  if (scores.length === 0) {
    return { digit: null, score: 0, scores: [] };
  }
  scores.sort((a, b) => b.score - a.score);
  return {
    digit: scores[0]?.digit ?? null,
    score: scores[0]?.score ?? 0,
    scores
  };
}

function loadTemplatesBitmaps(templatesDir: string): TemplateBitmap[] {
  const resolvedDir = path.resolve(templatesDir);
  if (!fs.existsSync(resolvedDir)) {
    return [];
  }

  const version = getTemplatesDirVersion(resolvedDir);
  const cacheKey = `${resolvedDir}|${version}`;
  const cached = templatesBitmapCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const templates = fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".png")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const fullPath = path.join(resolvedDir, entry.name);
      return {
        name: path.parse(entry.name).name,
        bitmap: decodePngBinaryFromBuffer(fs.readFileSync(fullPath))
      };
    });

  templatesBitmapCache.set(cacheKey, templates);
  return templates;
}

function matchSampleBitmap(sample: BinaryBitmap, templatesDir: string): TemplateMatchResult {
  const templates = loadTemplatesBitmaps(templatesDir);
  if (templates.length === 0) {
    return { digit: null, score: 0, scores: [] };
  }

  const rawScores: TemplateScore[] = [];
  for (const template of templates) {
    if (template.bitmap.width !== sample.width || template.bitmap.height !== sample.height) {
      continue;
    }
    rawScores.push({
      digit: template.name,
      score: scoreBitmapAgainstTemplate(sample, template.bitmap)
    });
  }

  return parseMatchResult(rawScores);
}

export async function matchAgainstTemplatesBatchBase64(params: {
  inputs: BatchTemplateInput[];
}): Promise<TemplateMatchResult[]> {
  const results = params.inputs.map<TemplateMatchResult>(() => ({ digit: null, score: 0, scores: [] }));
  if (params.inputs.length === 0) {
    return results;
  }

  for (let index = 0; index < params.inputs.length; index += 1) {
    const input = params.inputs[index];
    const templatesDir = path.resolve(input.templatesDir);
    if (!input.samplePngBase64 || !fs.existsSync(templatesDir)) {
      continue;
    }

    const sampleBuffer = Buffer.from(input.samplePngBase64, "base64");
    const sampleHash = getSampleHash(sampleBuffer);
    const templatesVersion = getTemplatesDirVersion(templatesDir);
    const cacheKey = `${templatesDir}|${templatesVersion}|${sampleHash}`;
    const cached = templateMatchCache.get(cacheKey);
    if (cached) {
      results[index] = cached;
      continue;
    }

    const sample = decodePngBinaryFromBase64(input.samplePngBase64);
    const matched = matchSampleBitmap(sample, templatesDir);
    results[index] = matched;
    rememberTemplateMatch(cacheKey, matched);
  }

  return results;
}

export function matchAgainstTemplatesBase64(params: {
  samplePngBase64: string;
  templatesDir: string;
}): Promise<TemplateMatchResult> {
  return matchAgainstTemplatesBatchBase64({
    inputs: [{ samplePngBase64: params.samplePngBase64, templatesDir: params.templatesDir }]
  }).then((results) => {
    return results[0] ?? { digit: null, score: 0, scores: [] };
  });
}

export function matchAgainstTemplates(params: {
  samplePath: string;
  templatesDir: string;
}): Promise<TemplateMatchResult> {
  const samplePath = path.resolve(params.samplePath);
  if (!fs.existsSync(samplePath)) {
    return Promise.resolve({ digit: null, score: 0, scores: [] });
  }

  const samplePngBase64 = fs.readFileSync(samplePath).toString("base64");
  return matchAgainstTemplatesBase64({
    samplePngBase64,
    templatesDir: params.templatesDir
  });
}

export function saveTemplateFromSample(params: {
  samplePath: string;
  templatesDir: string;
  digit: string;
}): string {
  const samplePath = path.resolve(params.samplePath);
  const templatesDir = path.resolve(params.templatesDir);
  fs.mkdirSync(templatesDir, { recursive: true });
  const targetPath = path.join(templatesDir, `${params.digit}.png`);
  fs.copyFileSync(samplePath, targetPath);
  invalidateTemplateDirCache(templatesDir);
  return targetPath;
}

function getTemplateVariantSuffix(index: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let current = index;
  let result = "";

  do {
    result = alphabet[current % alphabet.length] + result;
    current = Math.floor(current / alphabet.length) - 1;
  } while (current >= 0);

  return result;
}

export function getNextTemplateVariantName(params: {
  templatesDir: string;
  digit: string;
}): string {
  const templatesDir = path.resolve(params.templatesDir);
  const digit = params.digit.trim();
  fs.mkdirSync(templatesDir, { recursive: true });

  const existingNames = new Set(
    fs
      .readdirSync(templatesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".png")
      .map((entry) => path.parse(entry.name).name.toLowerCase())
  );

  let suffixIndex = 0;
  while (true) {
    const candidate = `${digit}${getTemplateVariantSuffix(suffixIndex)}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffixIndex += 1;
  }
}

export function saveNextTemplateVariantFromSample(params: {
  samplePath: string;
  templatesDir: string;
  digit: string;
}): string {
  const samplePath = path.resolve(params.samplePath);
  const templatesDir = path.resolve(params.templatesDir);
  const variantName = getNextTemplateVariantName({
    templatesDir,
    digit: params.digit
  });
  const targetPath = path.join(templatesDir, `${variantName}.png`);
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.copyFileSync(samplePath, targetPath);
  invalidateTemplateDirCache(templatesDir);
  return targetPath;
}

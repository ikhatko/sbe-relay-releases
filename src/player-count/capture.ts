import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";

import type { RoiRect } from "./roi";

const execFileAsync = promisify(execFile);
const POWERSHELL_SENTINEL_PREFIX = "__SBE_CAPTURE__";

type PendingPowerShellRequest = {
  id: number;
  stdout: string[];
  stderr: string;
  failed: boolean;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

class PersistentPowerShellSession {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeRequest: PendingPowerShellRequest | null = null;
  private readonly queue: Array<{
    script: string;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }> = [];
  private stdoutBuffer = "";
  private nextRequestId = 1;

  async runJson(script: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ script, resolve, reject });
      this.startNextRequest();
    });
  }

  dispose(): void {
    this.process?.kill();
    this.process = null;
    this.activeRequest = null;
    this.queue.length = 0;
    this.stdoutBuffer = "";
  }

  private startNextRequest(): void {
    if (this.activeRequest || this.queue.length === 0) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    const child = this.ensureProcess();
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.activeRequest = {
      id: requestId,
      stdout: [],
      stderr: "",
      failed: false,
      resolve: next.resolve,
      reject: next.reject
    };

    const wrappedScript = [
      "$ErrorActionPreference = 'Stop'",
      `try { ${next.script} } catch {`,
      "  [Console]::Error.WriteLine(($_ | Out-String).Trim())",
      `  [Console]::Out.WriteLine('${POWERSHELL_SENTINEL_PREFIX}:ERROR:${requestId}')`,
      "}",
      `[Console]::Out.WriteLine('${POWERSHELL_SENTINEL_PREFIX}:END:${requestId}')`
    ].join("; ");

    child.stdin.write(`${wrappedScript}\n`);
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process) {
      return this.process;
    }

    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-NoLogo", "-Command", "-"], {
      stdio: "pipe",
      windowsHide: true
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.handleStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      if (this.activeRequest) {
        this.activeRequest.stderr += chunk;
      }
    });
    child.once("error", (error) => {
      this.failActiveAndQueued(error instanceof Error ? error : new Error(String(error)));
    });
    child.once("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${String(code ?? "unknown")}`;
      this.failActiveAndQueued(new Error(`Persistent PowerShell capture session exited with ${reason}.`));
    });

    this.process = child;
    return child;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const rawLine = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const activeRequest = this.activeRequest;
      if (!activeRequest) {
        continue;
      }

      const errorMarker = `${POWERSHELL_SENTINEL_PREFIX}:ERROR:${activeRequest.id}`;
      const endMarker = `${POWERSHELL_SENTINEL_PREFIX}:END:${activeRequest.id}`;
      if (line === errorMarker) {
        activeRequest.failed = true;
        continue;
      }
      if (line === endMarker) {
        const completedRequest = activeRequest;
        this.activeRequest = null;
        if (completedRequest.failed) {
          completedRequest.reject(
            new Error(completedRequest.stderr.trim() || "Persistent PowerShell capture request failed.")
          );
        } else {
          completedRequest.resolve(completedRequest.stdout.join("\n").trim());
        }
        this.startNextRequest();
        continue;
      }

      activeRequest.stdout.push(line);
    }
  }

  private failActiveAndQueued(error: Error): void {
    if (this.activeRequest) {
      this.activeRequest.reject(error);
      this.activeRequest = null;
    }
    while (this.queue.length > 0) {
      const request = this.queue.shift();
      request?.reject(error);
    }
    this.process = null;
    this.stdoutBuffer = "";
  }
}

let persistentPowerShellSession: PersistentPowerShellSession | null = null;

function escapePowerShellString(value: string): string {
  return value.replaceAll("'", "''");
}

async function runPowerShellScript(script: string): Promise<void> {
  await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
}

async function runPowerShellJson(script: string): Promise<string> {
  persistentPowerShellSession ??= new PersistentPowerShellSession();
  return persistentPowerShellSession.runJson(script);
}

export type CaptureAndPreprocessRoiResult = {
  name: string;
  processedPngBase64: string;
  outputPath: string | null;
  processedOutputPath: string | null;
};

export type CaptureAndPreprocessTimings = {
  captureMs: number;
  preprocessMs: number;
};

export type CaptureAndPreprocessRoisDetailedResult = {
  items: CaptureAndPreprocessRoiResult[];
  timings: CaptureAndPreprocessTimings;
};

export async function captureAndPreprocessRoisDetailed(params: {
  screenWidth: number;
  screenHeight: number;
  rois: Array<{
    name: string;
    roi: RoiRect;
    outputPath?: string;
    processedOutputPath?: string;
  }>;
  threshold: number;
}): Promise<CaptureAndPreprocessRoisDetailedResult> {
  if (process.platform !== "win32") {
    throw new Error("player-count ROI capture currently supports Windows only.");
  }
  if (params.rois.length === 0) {
    return {
      items: [],
      timings: { captureMs: 0, preprocessMs: 0 }
    };
  }

  const threshold = Math.max(0, Math.min(255, Math.round(params.threshold)));
  const specsJson = JSON.stringify(
    params.rois.map((item) => ({
      name: item.name,
      left: item.roi.left,
      top: item.roi.top,
      width: item.roi.width,
      height: item.roi.height,
      outputPath: item.outputPath ?? "",
      processedOutputPath: item.processedOutputPath ?? ""
    }))
  );

  const escapedSpecsJson = escapePowerShellString(specsJson);
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    "$captureWatch = [System.Diagnostics.Stopwatch]::StartNew()",
    `$screen = New-Object System.Drawing.Bitmap(${params.screenWidth}, ${params.screenHeight})`,
    "$graphics = [System.Drawing.Graphics]::FromImage($screen)",
    "$graphics.CopyFromScreen(0, 0, 0, 0, $screen.Size)",
    `$specs = ConvertFrom-Json -InputObject '${escapedSpecsJson}'`,
    "$results = @()",
    "$captureWatch.Stop()",
    "$preprocessWatch = [System.Diagnostics.Stopwatch]::StartNew()",
    "foreach ($spec in $specs) {",
    "  $rect = New-Object System.Drawing.Rectangle([int]$spec.left, [int]$spec.top, [int]$spec.width, [int]$spec.height)",
    "  $crop = $screen.Clone($rect, $screen.PixelFormat)",
    "  if ($spec.outputPath) {",
    "    $crop.Save([string]$spec.outputPath, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  }",
    "  $min = 255",
    "  $max = 0",
    "  for ($y = 0; $y -lt $crop.Height; $y++) {",
    "    for ($x = 0; $x -lt $crop.Width; $x++) {",
    "      $c = $crop.GetPixel($x, $y)",
    "      $l = [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)",
    "      if ($l -lt $min) { $min = $l }",
    "      if ($l -gt $max) { $max = $l }",
    "    }",
    "  }",
    "  $range = [Math]::Max(1, $max - $min)",
    "  $dst = New-Object System.Drawing.Bitmap($crop.Width, $crop.Height)",
    "  for ($y = 0; $y -lt $crop.Height; $y++) {",
    "    for ($x = 0; $x -lt $crop.Width; $x++) {",
    "      $c = $crop.GetPixel($x, $y)",
    "      $l = [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)",
    "      $n = [int](($l - $min) * 255 / $range)",
    `      $bw = if ($n -ge ${threshold}) { 255 } else { 0 }`,
    "      $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $bw, $bw, $bw))",
    "    }",
    "  }",
    "  if ($spec.processedOutputPath) {",
    "    $dst.Save([string]$spec.processedOutputPath, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  }",
    "  $ms = New-Object System.IO.MemoryStream",
    "  $dst.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  $base64 = [Convert]::ToBase64String($ms.ToArray())",
    "  $results += [PSCustomObject]@{ name = [string]$spec.name; processedPngBase64 = $base64; outputPath = if ($spec.outputPath) { [string]$spec.outputPath } else { $null }; processedOutputPath = if ($spec.processedOutputPath) { [string]$spec.processedOutputPath } else { $null } }",
    "  $ms.Dispose()",
    "  $dst.Dispose()",
    "  $crop.Dispose()",
    "}",
    "$graphics.Dispose()",
    "$screen.Dispose()",
    "$preprocessWatch.Stop()",
    "[PSCustomObject]@{ timings = [PSCustomObject]@{ captureMs = [int]$captureWatch.ElapsedMilliseconds; preprocessMs = [int]$preprocessWatch.ElapsedMilliseconds }; items = $results } | ConvertTo-Json -Compress -Depth 8"
  ].join("; ");

  const raw = await runPowerShellJson(script);
  if (!raw) {
    return {
      items: [],
      timings: { captureMs: 0, preprocessMs: 0 }
    };
  }
  const parsed = JSON.parse(raw) as
    | CaptureAndPreprocessRoisDetailedResult
    | { items?: CaptureAndPreprocessRoiResult | CaptureAndPreprocessRoiResult[]; timings?: CaptureAndPreprocessTimings };
  const rawItems = parsed.items;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return {
    items,
    timings: {
      captureMs: Number(parsed.timings?.captureMs ?? 0),
      preprocessMs: Number(parsed.timings?.preprocessMs ?? 0)
    }
  };
}

export async function captureAndPreprocessRois(params: {
  screenWidth: number;
  screenHeight: number;
  rois: Array<{
    name: string;
    roi: RoiRect;
    outputPath?: string;
    processedOutputPath?: string;
  }>;
  threshold: number;
}): Promise<CaptureAndPreprocessRoiResult[]> {
  const result = await captureAndPreprocessRoisDetailed(params);
  return result.items;
}

export function resetPersistentCaptureSessionForTests(): void {
  persistentPowerShellSession?.dispose();
  persistentPowerShellSession = null;
}

export function captureRoiPng(params: {
  screenWidth: number;
  screenHeight: number;
  roi: RoiRect;
  outputPath: string;
}): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("player-count ROI capture currently supports Windows only.");
  }

  const { screenWidth, screenHeight, roi, outputPath } = params;
  const escapedOutput = escapePowerShellString(outputPath);
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$screen = New-Object System.Drawing.Bitmap(${screenWidth}, ${screenHeight})`,
    "$graphics = [System.Drawing.Graphics]::FromImage($screen)",
    "$graphics.CopyFromScreen(0, 0, 0, 0, $screen.Size)",
    `$rect = New-Object System.Drawing.Rectangle(${roi.left}, ${roi.top}, ${roi.width}, ${roi.height})`,
    "$crop = $screen.Clone($rect, $screen.PixelFormat)",
    `$crop.Save('${escapedOutput}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$crop.Dispose()",
    "$graphics.Dispose()",
    "$screen.Dispose()"
  ].join("; ");

  return runPowerShellScript(script);
}

export function preprocessRoiPng(params: {
  inputPath: string;
  outputPath: string;
  threshold: number;
}): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("player-count ROI preprocessing currently supports Windows only.");
  }

  const threshold = Math.max(0, Math.min(255, Math.round(params.threshold)));
  const input = escapePowerShellString(params.inputPath);
  const output = escapePowerShellString(params.outputPath);
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$src = [System.Drawing.Bitmap]::FromFile('${input}')`,
    "$min = 255",
    "$max = 0",
    "for ($y = 0; $y -lt $src.Height; $y++) {",
    "  for ($x = 0; $x -lt $src.Width; $x++) {",
    "    $c = $src.GetPixel($x, $y)",
    "    $l = [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)",
    "    if ($l -lt $min) { $min = $l }",
    "    if ($l -gt $max) { $max = $l }",
    "  }",
    "}",
    "$range = [Math]::Max(1, $max - $min)",
    "$dst = New-Object System.Drawing.Bitmap($src.Width, $src.Height)",
    "for ($y = 0; $y -lt $src.Height; $y++) {",
    "  for ($x = 0; $x -lt $src.Width; $x++) {",
    "    $c = $src.GetPixel($x, $y)",
    "    $l = [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)",
    "    $n = [int](($l - $min) * 255 / $range)",
    `    $bw = if ($n -ge ${threshold}) { 255 } else { 0 }`,
    "    $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $bw, $bw, $bw))",
    "  }",
    "}",
    `$dst.Save('${output}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$dst.Dispose()",
    "$src.Dispose()"
  ].join("; ");

  return runPowerShellScript(script);
}

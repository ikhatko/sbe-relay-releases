import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock, spawnMock, fakeChildren } = vi.hoisted(() => {
  const execFileMock = vi.fn();
  const spawnMock = vi.fn();
  const fakeChildren: FakeChildProcess[] = [];
  return { execFileMock, spawnMock, fakeChildren };
});

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock
}));

import { captureAndPreprocessRoisDetailed, resetPersistentCaptureSessionForTests } from "./capture";

class FakeStream extends EventEmitter {
  setEncoding(): this {
    return this;
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly stdin = {
    write: vi.fn((input: string) => {
      const requestIdMatch = /__SBE_CAPTURE__:END:(\d+)/.exec(input);
      const requestId = requestIdMatch?.[1] ?? "0";
      const payload = JSON.stringify({
        timings: { captureMs: 12, preprocessMs: 34 },
        items: [
          {
            name: "slot-1",
            processedPngBase64: `sample-${requestId}`,
            outputPath: null,
            processedOutputPath: null
          }
        ]
      });
      queueMicrotask(() => {
        this.stdout.emit("data", `${payload}\r\n`);
        this.stdout.emit("data", `__SBE_CAPTURE__:END:${requestId}\r\n`);
      });
      return true;
    })
  };

  kill = vi.fn(() => {
    this.emit("exit", 0, null);
    return true;
  });
}

describe("captureAndPreprocessRoisDetailed", () => {
  afterEach(() => {
    resetPersistentCaptureSessionForTests();
    vi.clearAllMocks();
    fakeChildren.length = 0;
  });

  it("reuses one persistent PowerShell process across calls", async () => {
    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      fakeChildren.push(child);
      return child;
    });

    const params = {
      screenWidth: 1920,
      screenHeight: 1080,
      threshold: 180,
      rois: [
        {
          name: "slot-1",
          roi: { left: 1, top: 2, width: 3, height: 4 }
        }
      ]
    };

    const first = await captureAndPreprocessRoisDetailed(params);
    const second = await captureAndPreprocessRoisDetailed(params);

    expect(first.timings.captureMs).toBe(12);
    expect(second.timings.preprocessMs).toBe(34);
    expect(first.items[0]?.processedPngBase64).toBe("sample-1");
    expect(second.items[0]?.processedPngBase64).toBe("sample-2");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(fakeChildren[0]?.stdin.write).toHaveBeenCalledTimes(2);
  });
});

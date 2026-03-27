import type { PlayerCountRoiConfig } from "../config";

export type RoiRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function toRoiRect(roi: PlayerCountRoiConfig): RoiRect {
  const left = Math.min(roi.upperRight.x, roi.lowerLeft.x);
  const right = Math.max(roi.upperRight.x, roi.lowerLeft.x);
  const top = Math.min(roi.upperRight.y, roi.lowerLeft.y);
  const bottom = Math.max(roi.upperRight.y, roi.lowerLeft.y);

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  };
}

export function clampRoiToScreen(roi: RoiRect, screenWidth: number, screenHeight: number): RoiRect {
  const left = Math.max(0, Math.min(roi.left, screenWidth - 1));
  const top = Math.max(0, Math.min(roi.top, screenHeight - 1));
  const right = Math.max(left + 1, Math.min(roi.left + roi.width, screenWidth));
  const bottom = Math.max(top + 1, Math.min(roi.top + roi.height, screenHeight));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

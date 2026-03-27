import type { PlayerCountRoiConfig } from "../config";

const BASE_16_BY_9_WIDTH = 1920;
const BASE_16_BY_9_HEIGHT = 1080;

function scaleAxisFromCenter(value: number, baseSize: number, targetSize: number): number {
  const baseCenter = baseSize / 2;
  const targetCenter = targetSize / 2;
  const ratio = targetSize / baseSize;
  return Math.round(targetCenter + (value - baseCenter) * ratio);
}

export function calibrateRoiFromCenter(
  roi: PlayerCountRoiConfig,
  baseScreenWidth: number,
  baseScreenHeight: number,
  targetScreenWidth: number,
  targetScreenHeight: number
): PlayerCountRoiConfig {
  return {
    name: roi.name,
    upperRight: {
      x: scaleAxisFromCenter(roi.upperRight.x, baseScreenWidth, targetScreenWidth),
      y: scaleAxisFromCenter(roi.upperRight.y, baseScreenHeight, targetScreenHeight)
    },
    lowerLeft: {
      x: scaleAxisFromCenter(roi.lowerLeft.x, baseScreenWidth, targetScreenWidth),
      y: scaleAxisFromCenter(roi.lowerLeft.y, baseScreenHeight, targetScreenHeight)
    }
  };
}

export function calibrateRoisFromCenter(params: {
  rois: [PlayerCountRoiConfig, PlayerCountRoiConfig];
  baseScreenWidth: number;
  baseScreenHeight: number;
  targetScreenWidth: number;
  targetScreenHeight: number;
}): [PlayerCountRoiConfig, PlayerCountRoiConfig] {
  const { rois, baseScreenWidth, baseScreenHeight, targetScreenWidth, targetScreenHeight } = params;

  return [
    calibrateRoiFromCenter(rois[0], baseScreenWidth, baseScreenHeight, targetScreenWidth, targetScreenHeight),
    calibrateRoiFromCenter(rois[1], baseScreenWidth, baseScreenHeight, targetScreenWidth, targetScreenHeight)
  ];
}

function mapAxisBetweenSpaces(value: number, sourceSize: number, targetSize: number): number {
  return Math.round((value * targetSize) / sourceSize);
}

export function mapRoiBetweenSpaces(
  roi: PlayerCountRoiConfig,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): PlayerCountRoiConfig {
  return {
    name: roi.name,
    upperRight: {
      x: mapAxisBetweenSpaces(roi.upperRight.x, sourceWidth, targetWidth),
      y: mapAxisBetweenSpaces(roi.upperRight.y, sourceHeight, targetHeight)
    },
    lowerLeft: {
      x: mapAxisBetweenSpaces(roi.lowerLeft.x, sourceWidth, targetWidth),
      y: mapAxisBetweenSpaces(roi.lowerLeft.y, sourceHeight, targetHeight)
    }
  };
}

function projectPointFromReference(params: {
  valueX: number;
  valueY: number;
  referenceScreenWidth: number;
  referenceScreenHeight: number;
  referenceGameWidth: number;
  referenceGameHeight: number;
  targetGameWidth: number;
  targetGameHeight: number;
  targetScreenWidth: number;
  targetScreenHeight: number;
}): { x: number; y: number } {
  const {
    valueX,
    valueY,
    referenceScreenWidth,
    referenceScreenHeight,
    referenceGameWidth,
    referenceGameHeight,
    targetGameWidth,
    targetGameHeight,
    targetScreenWidth,
    targetScreenHeight
  } = params;

  const referenceGameX = (valueX * referenceGameWidth) / referenceScreenWidth;
  const referenceGameY = (valueY * referenceGameHeight) / referenceScreenHeight;

  const normalizedX = (referenceGameX - referenceGameWidth / 2) / referenceGameWidth;
  const normalizedY = (referenceGameY - referenceGameHeight / 2) / referenceGameHeight;

  const gameX = targetGameWidth / 2 + normalizedX * targetGameWidth;
  const gameY = targetGameHeight / 2 + normalizedY * targetGameHeight;

  const screenX = (gameX * targetScreenWidth) / targetGameWidth;
  const screenY = (gameY * targetScreenHeight) / targetGameHeight;

  return {
    x: Math.round(screenX),
    y: Math.round(screenY)
  };
}

export function projectRoiFromReference(params: {
  roi: PlayerCountRoiConfig;
  referenceScreenWidth: number;
  referenceScreenHeight: number;
  referenceGameWidth: number;
  referenceGameHeight: number;
  targetGameWidth: number;
  targetGameHeight: number;
  targetScreenWidth: number;
  targetScreenHeight: number;
}): PlayerCountRoiConfig {
  const {
    roi,
    referenceScreenWidth,
    referenceScreenHeight,
    referenceGameWidth,
    referenceGameHeight,
    targetGameWidth,
    targetGameHeight,
    targetScreenWidth,
    targetScreenHeight
  } = params;

  const upperRight = projectPointFromReference({
    valueX: roi.upperRight.x,
    valueY: roi.upperRight.y,
    referenceScreenWidth,
    referenceScreenHeight,
    referenceGameWidth,
    referenceGameHeight,
    targetGameWidth,
    targetGameHeight,
    targetScreenWidth,
    targetScreenHeight
  });
  const lowerLeft = projectPointFromReference({
    valueX: roi.lowerLeft.x,
    valueY: roi.lowerLeft.y,
    referenceScreenWidth,
    referenceScreenHeight,
    referenceGameWidth,
    referenceGameHeight,
    targetGameWidth,
    targetGameHeight,
    targetScreenWidth,
    targetScreenHeight
  });

  return {
    name: roi.name,
    upperRight,
    lowerLeft
  };
}

export function scaleRoiFor16By9(
  roi: PlayerCountRoiConfig,
  targetWidth: number,
  targetHeight: number
): PlayerCountRoiConfig {
  return {
    name: roi.name,
    upperRight: {
      x: Math.round((roi.upperRight.x * targetWidth) / BASE_16_BY_9_WIDTH),
      y: Math.round((roi.upperRight.y * targetHeight) / BASE_16_BY_9_HEIGHT)
    },
    lowerLeft: {
      x: Math.round((roi.lowerLeft.x * targetWidth) / BASE_16_BY_9_WIDTH),
      y: Math.round((roi.lowerLeft.y * targetHeight) / BASE_16_BY_9_HEIGHT)
    }
  };
}

export function scaleRoisFor16By9(params: {
  rois: [PlayerCountRoiConfig, PlayerCountRoiConfig];
  targetWidth: number;
  targetHeight: number;
}): [PlayerCountRoiConfig, PlayerCountRoiConfig] {
  const { rois, targetWidth, targetHeight } = params;
  return [scaleRoiFor16By9(rois[0], targetWidth, targetHeight), scaleRoiFor16By9(rois[1], targetWidth, targetHeight)];
}

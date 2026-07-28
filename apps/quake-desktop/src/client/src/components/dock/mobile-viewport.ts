export type ViewportMetrics = {
  surfaceWidth: number;
  surfaceHeight: number;
  deviceWidth: number;
  deviceHeight: number;
  rotation?: 0 | 90 | 180 | 270;
};

export function viewportToDevice(metrics: ViewportMetrics, x: number, y: number): { x: number; y: number } {
  const surfaceRatio = metrics.surfaceWidth / metrics.surfaceHeight;
  const deviceRatio = metrics.deviceWidth / metrics.deviceHeight;
  const contentWidth = surfaceRatio > deviceRatio ? metrics.surfaceHeight * deviceRatio : metrics.surfaceWidth;
  const contentHeight = surfaceRatio > deviceRatio ? metrics.surfaceHeight : metrics.surfaceWidth / deviceRatio;
  const localX = Math.min(contentWidth, Math.max(0, x - (metrics.surfaceWidth - contentWidth) / 2)) / contentWidth;
  const localY = Math.min(contentHeight, Math.max(0, y - (metrics.surfaceHeight - contentHeight) / 2)) / contentHeight;
  const rotation = metrics.rotation || 0;
  if (rotation === 90) return { x: localY * metrics.deviceWidth, y: (1 - localX) * metrics.deviceHeight };
  if (rotation === 180) return { x: (1 - localX) * metrics.deviceWidth, y: (1 - localY) * metrics.deviceHeight };
  if (rotation === 270) return { x: (1 - localY) * metrics.deviceWidth, y: localX * metrics.deviceHeight };
  return { x: localX * metrics.deviceWidth, y: localY * metrics.deviceHeight };
}

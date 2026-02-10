/** Grid size for the game board (10x10) */
export const BOARD_SIZE = 10;

/** Pixel size per tile */
export const TILE_SIZE = 64;

/** Convert pixel coordinates to grid (x, y). Clamps to valid range. */
export function pixelToGrid(px: number, py: number): { x: number; y: number } {
  const x = Math.floor(px / TILE_SIZE);
  const y = Math.floor(py / TILE_SIZE);
  return {
    x: Math.max(0, Math.min(BOARD_SIZE - 1, x)),
    y: Math.max(0, Math.min(BOARD_SIZE - 1, y)),
  };
}

/** Convert grid (x, y) to pixel center of tile */
export function gridToPixel(x: number, y: number): { x: number; y: number } {
  return {
    x: x * TILE_SIZE + TILE_SIZE / 2,
    y: y * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** World width/height for the island (pixels) */
export const WORLD_WIDTH = BOARD_SIZE * TILE_SIZE;
export const WORLD_HEIGHT = BOARD_SIZE * TILE_SIZE;

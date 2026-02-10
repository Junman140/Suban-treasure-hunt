import Phaser from 'phaser';
import { BOARD_SIZE, TILE_SIZE, gridToPixel } from '../utils/coords';
import {
  createDigParticles,
  createTreasureBurst,
  createMissDust,
} from '../utils/particles';

export interface TreasurePlacement {
  x: number;
  y: number;
}

export interface IslandSceneData {
  onTileClick?: (x: number, y: number) => void;
  phase?: 'commit' | 'battle';
  treasures?: TreasurePlacement[];
}

export class IslandScene extends Phaser.Scene {
  private tiles!: Phaser.GameObjects.Group;
  private character!: Phaser.GameObjects.Rectangle;
  private onTileClick?: (x: number, y: number) => void;
  private treasures: TreasurePlacement[] = [];
  private placementInProgress = false;
  private trees: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super({ key: 'IslandScene' });
  }

  init(data: IslandSceneData) {
    this.onTileClick = data.onTileClick;
    this.treasures = data.treasures ?? [];
  }

  create() {
    this.tiles = this.add.group();

    // Procedural island: grass interior, sand/beach at edges
    for (let gy = 0; gy < BOARD_SIZE; gy++) {
      for (let gx = 0; gx < BOARD_SIZE; gx++) {
        const { x, y } = gridToPixel(gx, gy);
        const isEdge =
          gx === 0 ||
          gx === BOARD_SIZE - 1 ||
          gy === 0 ||
          gy === BOARD_SIZE - 1;
        const color = isEdge ? 0xf4d35e : 0x7cb342; // sand : grass
        const tile = this.add
          .rectangle(x, y, TILE_SIZE - 2, TILE_SIZE - 2, color)
          .setOrigin(0.5, 0.5)
          .setInteractive({ useHandCursor: true });
        tile.setData('gridX', gx);
        tile.setData('gridY', gy);
        this.tiles.add(tile);
      }
    }

    // Palm trees (decorative)
    const treePositions = [[2, 2], [7, 3], [3, 7], [8, 8]];
    treePositions.forEach(([gx, gy]) => {
      const { x, y } = gridToPixel(gx, gy);
      const trunk = this.add.rectangle(x - 4, y, 6, 20, 0x5d4037).setOrigin(0.5, 0.5);
      const foliage = this.add.rectangle(x, y - 12, 24, 20, 0x2e7d32).setOrigin(0.5, 0.5);
      this.trees.push(trunk, foliage);
    });

    // Character placeholder (colored rectangle)
    const spawn = gridToPixel(Math.floor(BOARD_SIZE / 2), Math.floor(BOARD_SIZE / 2));
    this.character = this.add
      .rectangle(spawn.x, spawn.y, 24, 36, 0x4a90d9)
      .setOrigin(0.5, 1);

    // Click handling - placement flow with dig animation
    this.tiles.getChildren().forEach((child) => {
      const tile = child as Phaser.GameObjects.Rectangle;
      tile.on('pointerdown', () => this.handleTileClick(tile));
    });
  }

  private hasTreasure(gx: number, gy: number): boolean {
    return this.treasures.some((t) => t.x === gx && t.y === gy);
  }

  private async handleTileClick(tile: Phaser.GameObjects.Rectangle) {
    if (this.placementInProgress) return;
    const gx = tile.getData('gridX') as number;
    const gy = tile.getData('gridY') as number;
    const isRemoving = this.hasTreasure(gx, gy);
    const isAdding = !isRemoving && this.treasures.length < 5;
    if (!isAdding && !isRemoving) return;

    this.placementInProgress = true;

    // 1. Walk to tile
    await this.moveCharacterToAsync(gx, gy);

    if (isAdding) {
      // 2. Dig animation (character bobs)
      await this.playDigAnimation();
      // 3. Chest appears and sinks
      await this.playChestBury(gx, gy);
    } else {
      // 4. Unbury: chest rises briefly and disappears
      await this.playChestUnbury(gx, gy);
    }

    this.onTileClick?.(gx, gy);
    this.placementInProgress = false;
  }

  private moveCharacterToAsync(gx: number, gy: number): Promise<void> {
    const { x, y } = gridToPixel(gx, gy);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: this.character,
        x,
        y,
        duration: 300,
        ease: 'Power2',
        onComplete: () => resolve(),
      });
    });
  }

  private playDigAnimation(): Promise<void> {
    const startY = this.character.y;
    const digParticles = createDigParticles(this, this.character.x, this.character.y);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: this.character,
        y: startY - 4,
        duration: 150,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          digParticles.destroy();
          resolve();
        },
      });
    });
  }

  private playChestBury(gx: number, gy: number): Promise<void> {
    const { x, y } = gridToPixel(gx, gy);
    createTreasureBurst(this, x, y);
    const chest = this.add
      .rectangle(x, y, 20, 16, 0xd4a84b)
      .setOrigin(0.5, 0.5);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: chest,
        scaleY: 0.1,
        alpha: 0,
        duration: 400,
        ease: 'Power2.In',
        onComplete: () => {
          chest.destroy();
          resolve();
        },
      });
    });
  }

  private playChestUnbury(gx: number, gy: number): Promise<void> {
    const { x, y } = gridToPixel(gx, gy);
    createMissDust(this, x, y);
    const chest = this.add
      .rectangle(x, y, 20, 16, 0xd4a84b)
      .setOrigin(0.5, 0.5)
      .setScale(0.1)
      .setAlpha(0);
    return new Promise((resolve) => {
      this.tweens.add({
        targets: chest,
        scaleY: 1,
        alpha: 1,
        duration: 150,
        ease: 'Power2.Out',
      });
      this.tweens.add({
        targets: chest,
        scaleY: 0.1,
        alpha: 0,
        duration: 200,
        delay: 150,
        ease: 'Power2.In',
        onComplete: () => {
          chest.destroy();
          resolve();
        },
      });
    });
  }

  moveCharacterTo(gx: number, gy: number) {
    const { x, y } = gridToPixel(gx, gy);
    this.tweens.add({
      targets: this.character,
      x,
      y,
      duration: 300,
      ease: 'Power2',
    });
  }

  update(_time: number, delta: number) {
    const t = (Date.now() / 1000) * 0.8;
    this.trees.forEach((tree, i) => {
      const sway = Math.sin(t + i * 0.5) * 1.5;
      tree.setAngle(sway);
    });
  }

  setOnTileClick(cb: ((x: number, y: number) => void) | undefined) {
    this.onTileClick = cb;
  }

  setTreasures(treasures: TreasurePlacement[]) {
    this.treasures = treasures;
  }
}

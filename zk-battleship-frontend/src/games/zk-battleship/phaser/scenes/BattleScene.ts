import Phaser from 'phaser';
import {
  BOARD_SIZE,
  TILE_SIZE,
  WORLD_WIDTH,
  gridToPixel,
} from '../utils/coords';
import {
  createDigParticles,
  createTreasureBurst,
  createMissDust,
} from '../utils/particles';

const GAP = 24;
const RIGHT_OFFSET_X = WORLD_WIDTH + GAP;

export interface ShotInfo {
  x: number;
  y: number;
  hit: boolean;
}

export interface BattleSceneData {
  onAttackTile?: (x: number, y: number) => void;
  myShots?: ShotInfo[];
  opponentShots?: ShotInfo[];
  isMyTurn?: boolean;
  loading?: boolean;
  showMiniMap?: boolean;
}

export class BattleScene extends Phaser.Scene {
  private leftTiles!: Phaser.GameObjects.Group;
  private rightTiles!: Phaser.GameObjects.Group;
  private character!: Phaser.GameObjects.Rectangle;
  private onAttackTile?: (x: number, y: number) => void;
  private myShots: ShotInfo[] = [];
  private opponentShots: ShotInfo[] = [];
  private isMyTurn = false;
  private loading = false;
  private attackInProgress = false;
  private shotMarkers: Phaser.GameObjects.GameObject[] = [];
  private pendingAttack: { x: number; y: number } | null = null;
  private prevMyShots: ShotInfo[] = [];
  private showMiniMap = false;
  private miniMapOverlay: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: 'BattleScene' });
  }

  init(data: BattleSceneData) {
    this.onAttackTile = data.onAttackTile;
    this.myShots = data.myShots ?? [];
    this.opponentShots = data.opponentShots ?? [];
    this.isMyTurn = data.isMyTurn ?? false;
    this.loading = data.loading ?? false;
    this.showMiniMap = data.showMiniMap ?? false;
  }

  create() {
    this.shotMarkers = [];

    // Left island - YOUR island (defensive)
    this.leftTiles = this.createIsland(0, 0);
    this.drawShotsOnIsland(0, 0, this.opponentShots, false);

    // Right island - ENEMY island (offensive)
    this.rightTiles = this.createIsland(RIGHT_OFFSET_X, 0);

    // Character on right island (enemy island - where we attack)
    const spawn = gridToPixel(4, 4);
    this.character = this.add
      .rectangle(RIGHT_OFFSET_X + spawn.x, spawn.y, 24, 36, 0x4a90d9)
      .setOrigin(0.5, 1);

    // Right island tiles - click to attack
    this.rightTiles.getChildren().forEach((child) => {
      const tile = child as Phaser.GameObjects.Rectangle;
      tile.on('pointerdown', () => this.handleAttackClick(tile));
    });
    this.refreshMiniMap();
  }

  private createIsland(offsetX: number, offsetY: number): Phaser.GameObjects.Group {
    const group = this.add.group();
    for (let gy = 0; gy < BOARD_SIZE; gy++) {
      for (let gx = 0; gx < BOARD_SIZE; gx++) {
        const { x, y } = gridToPixel(gx, gy);
        const isEdge =
          gx === 0 ||
          gx === BOARD_SIZE - 1 ||
          gy === 0 ||
          gy === BOARD_SIZE - 1;
        const color = isEdge ? 0xf4d35e : 0x7cb342;
        const tile = this.add
          .rectangle(offsetX + x, offsetY + y, TILE_SIZE - 2, TILE_SIZE - 2, color)
          .setOrigin(0.5, 0.5)
          .setInteractive({ useHandCursor: true });
        tile.setData('gridX', gx);
        tile.setData('gridY', gy);
        tile.setData('offsetX', offsetX);
        tile.setData('offsetY', offsetY);
        group.add(tile);
      }
    }
    const treePositions: [number, number][] = [[2, 2], [7, 3], [3, 7], [8, 8]];
    treePositions.forEach(([gx, gy]) => {
      const { x, y } = gridToPixel(gx, gy);
      this.add.rectangle(offsetX + x - 4, offsetY + y, 6, 20, 0x5d4037).setOrigin(0.5, 0.5);
      this.add.rectangle(offsetX + x, offsetY + y - 12, 24, 20, 0x2e7d32).setOrigin(0.5, 0.5);
    });
    return group;
  }

  private drawShotsOnIsland(
    offsetX: number,
    offsetY: number,
    shots: ShotInfo[],
    isRightIsland: boolean
  ) {
    shots.forEach((s) => {
      const { x, y } = gridToPixel(s.x, s.y);
      const cx = offsetX + x;
      const cy = offsetY + y;
      const prevShot = isRightIsland ? this.prevMyShots.find((p) => p.x === s.x && p.y === s.y) : undefined;
      const isNew = isRightIsland && this.prevMyShots.length > 0 && !prevShot;
      if (isNew && isRightIsland) {
        if (s.hit) createTreasureBurst(this, cx, cy);
        else createMissDust(this, cx, cy);
      }
      const color = s.hit ? 0xd4a84b : 0x8b7355;
      const marker = this.add
        .rectangle(cx, cy, TILE_SIZE - 8, TILE_SIZE - 8, color)
        .setOrigin(0.5, 0.5)
        .setAlpha(s.hit ? 1 : 0.8);
      this.shotMarkers.push(marker);
      if (s.hit) {
        const chest = this.add
          .rectangle(cx, cy, 16, 12, 0xd4a84b)
          .setOrigin(0.5, 0.5);
        this.shotMarkers.push(chest);
      }
    });
  }

  private async handleAttackClick(tile: Phaser.GameObjects.Rectangle) {
    if (!this.isMyTurn || this.loading || this.attackInProgress) return;
    const gx = tile.getData('gridX') as number;
    const gy = tile.getData('gridY') as number;
    const alreadyShot = this.myShots.some((s) => s.x === gx && s.y === gy);
    if (alreadyShot) return;

    this.attackInProgress = true;

    const offsetX = tile.getData('offsetX') as number;
    const { x, y } = gridToPixel(gx, gy);
    const targetX = offsetX + x;
    const targetY = y;

    // 1. Walk to tile
    await this.moveCharacterToAsync(targetX, targetY);
    // 2. Dig animation with particles
    await this.playDigAnimation(targetX, targetY);
    this.pendingAttack = { x: gx, y: gy };
    this.onAttackTile?.(gx, gy);
    this.refreshShotMarkers();
    this.attackInProgress = false;
  }

  private moveCharacterToAsync(tx: number, ty: number): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({
        targets: this.character,
        x: tx,
        y: ty,
        duration: 300,
        ease: 'Power2',
        onComplete: () => resolve(),
      });
    });
  }

  private playDigAnimation(cx: number, cy: number): Promise<void> {
    const startY = this.character.y;
    const digParticles = createDigParticles(this, cx, cy);
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

  setBattleData(data: {
    onAttackTile?: (x: number, y: number) => void;
    myShots?: ShotInfo[];
    opponentShots?: ShotInfo[];
    isMyTurn?: boolean;
    loading?: boolean;
    showMiniMap?: boolean;
  }) {
    if (data.onAttackTile !== undefined) this.onAttackTile = data.onAttackTile;
    if (data.myShots !== undefined) {
      this.prevMyShots = [...this.myShots];
      this.myShots = data.myShots;
      if (this.pendingAttack && data.myShots.some((s) => s.x === this.pendingAttack!.x && s.y === this.pendingAttack!.y)) {
        this.pendingAttack = null;
      }
    }
    if (data.opponentShots !== undefined) this.opponentShots = data.opponentShots;
    if (data.isMyTurn !== undefined) this.isMyTurn = data.isMyTurn;
    if (data.loading !== undefined) this.loading = data.loading;
    if (data.showMiniMap !== undefined) this.showMiniMap = data.showMiniMap;
    this.refreshShotMarkers();
    this.refreshMiniMap();
  }

  private refreshMiniMap() {
    this.miniMapOverlay.forEach((o) => o.destroy());
    this.miniMapOverlay = [];
    if (!this.showMiniMap) return;
    const addGridLabels = (offsetX: number) => {
      for (let gy = 0; gy < BOARD_SIZE; gy++) {
        for (let gx = 0; gx < BOARD_SIZE; gx++) {
          const { x, y } = gridToPixel(gx, gy);
          const txt = this.add
            .text(offsetX + x, y, `${gx},${gy}`, { fontSize: 10, color: '#000' })
            .setOrigin(0.5, 0.5)
            .setAlpha(0.6);
          this.miniMapOverlay.push(txt);
        }
      }
    };
    addGridLabels(0);
    addGridLabels(RIGHT_OFFSET_X);
  }

  private refreshShotMarkers() {
    this.shotMarkers.forEach((m) => m.destroy());
    this.shotMarkers = [];
    this.drawShotsOnIsland(0, 0, this.opponentShots, false);
    this.drawShotsOnIsland(RIGHT_OFFSET_X, 0, this.myShots, true);
    if (this.pendingAttack && !this.myShots.some((s) => s.x === this.pendingAttack!.x && s.y === this.pendingAttack!.y)) {
      const { x, y } = gridToPixel(this.pendingAttack.x, this.pendingAttack.y);
      const hole = this.add
        .rectangle(RIGHT_OFFSET_X + x, y, TILE_SIZE - 8, TILE_SIZE - 8, 0x6b5344)
        .setOrigin(0.5, 0.5)
        .setAlpha(0.7);
      this.shotMarkers.push(hole);
    }
  }
}

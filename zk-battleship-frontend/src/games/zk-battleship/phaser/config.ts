import Phaser from 'phaser';
import { IslandScene } from './scenes/IslandScene';
import { WORLD_WIDTH, WORLD_HEIGHT } from './utils/coords';

export const PHASER_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  backgroundColor: '#87ceeb',
  parent: 'phaser-game',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
  },
  scene: [IslandScene],
};

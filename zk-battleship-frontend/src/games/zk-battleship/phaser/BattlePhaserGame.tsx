import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { WORLD_WIDTH, WORLD_HEIGHT } from './utils/coords';

const GAP = 24;
const BATTLE_WIDTH = WORLD_WIDTH * 2 + GAP;
const BATTLE_HEIGHT = WORLD_HEIGHT;

const BATTLE_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: BATTLE_WIDTH,
  height: BATTLE_HEIGHT,
  backgroundColor: '#87ceeb',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BattleScene],
};

export interface ShotInfo {
  x: number;
  y: number;
  hit: boolean;
}

export interface BattlePhaserGameProps {
  onAttackTile?: (x: number, y: number) => void;
  myShots?: ShotInfo[];
  opponentShots?: ShotInfo[];
  isMyTurn?: boolean;
  loading?: boolean;
  showMiniMap?: boolean;
  className?: string;
}

export function BattlePhaserGame({
  onAttackTile,
  myShots = [],
  opponentShots = [],
  isMyTurn = false,
  loading = false,
  showMiniMap = false,
  className,
}: BattlePhaserGameProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      ...BATTLE_CONFIG,
      parent: parentRef.current,
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    const scene = game.scene.getScene('BattleScene') as BattleScene | undefined;
    if (scene) {
      scene.setBattleData({
        onAttackTile,
        myShots,
        opponentShots,
        isMyTurn,
        loading,
        showMiniMap,
      });
    }
  }, [onAttackTile, myShots, opponentShots, isMyTurn, loading, showMiniMap]);

  return (
    <div
      ref={parentRef}
      className={className}
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        borderRadius: 8,
        maxWidth: '100%',
        aspectRatio: `${BATTLE_WIDTH / BATTLE_HEIGHT}`,
      }}
    />
  );
}

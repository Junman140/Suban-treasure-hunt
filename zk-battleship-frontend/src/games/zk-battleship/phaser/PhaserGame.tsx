import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { PHASER_CONFIG } from './config';
import { IslandScene } from './scenes/IslandScene';
import type { TreasurePlacement } from './scenes/IslandScene';

export interface PhaserGameProps {
  onTileClick?: (x: number, y: number) => void;
  phase?: 'commit' | 'battle';
  treasures?: TreasurePlacement[];
  className?: string;
}

export function PhaserGame({
  onTileClick,
  phase = 'commit',
  treasures = [],
  className,
}: PhaserGameProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      ...PHASER_CONFIG,
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
    const scene = game.scene.getScene('IslandScene') as IslandScene | undefined;
    if (scene) {
      scene.setOnTileClick(onTileClick ?? undefined);
      scene.setTreasures(treasures);
    }
  }, [onTileClick, treasures]);

  return (
    <div
      id="phaser-game"
      ref={parentRef}
      className={className}
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        borderRadius: 8,
        maxWidth: '100%',
        aspectRatio: '1',
      }}
    />
  );
}

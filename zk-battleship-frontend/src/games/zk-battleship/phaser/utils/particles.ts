import Phaser from 'phaser';

const PARTICLE_TEXTURE = '__WHITE';

/** Create dirt particles for digging animation. Returns emitter - call .destroy() when done. */
export function createDigParticles(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Particles.ParticleEmitter {
  const emitter = scene.add.particles(x, y, PARTICLE_TEXTURE, {
    speed: { min: 30, max: 80 },
    angle: { min: 240, max: 300 },
    scale: { start: 0.4, end: 0 },
    lifespan: 400,
    frequency: 30,
    maxParticles: 12,
    tint: [0x8b7355, 0x6b5344, 0xa08060],
  });
  return emitter;
}

/** Create gold sparkle burst for treasure found */
export function createTreasureBurst(
  scene: Phaser.Scene,
  x: number,
  y: number
): void {
  const emitter = scene.add.particles(x, y, PARTICLE_TEXTURE, {
    speed: { min: 60, max: 150 },
    angle: { min: 0, max: 360 },
    scale: { start: 0.6, end: 0 },
    lifespan: 600,
    frequency: -1,
    quantity: 16,
    tint: [0xffd700, 0xd4a84b, 0xffec8b],
  });
  emitter.explode(16);
  scene.time.delayedCall(700, () => emitter.destroy());
}

/** Create dust cloud for miss */
export function createMissDust(
  scene: Phaser.Scene,
  x: number,
  y: number
): void {
  const emitter = scene.add.particles(x, y, PARTICLE_TEXTURE, {
    speed: { min: 10, max: 40 },
    angle: { min: 0, max: 360 },
    scale: { start: 0.3, end: 0 },
    lifespan: 500,
    frequency: -1,
    quantity: 8,
    tint: [0x9e9e9e, 0x757575],
  });
  emitter.explode(8);
  scene.time.delayedCall(600, () => emitter.destroy());
}

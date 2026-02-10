# ZK Treasure Hunt

A two-player Treasure Hunt game on Stellar using zero-knowledge proofs. Players hide 5 treasures each and take turns digging to find the opponent's—without revealing positions.

## Game Flow

1. **start_game** - Both players sign to create a session (Game Hub integration)
2. **commit_board** - Each player submits a 32-byte commitment (hash of 5 treasure placements)
3. **fire_shot** - Current player digs at (x, y)
4. **respond_shot** - Defender responds with treasure found or empty
5. First to find all 5 opponent treasures wins; **end_game** called on Game Hub

## ZK Proofs (Noir Circuits)

- **circuits/placement** - Proves valid 5-treasure placement (no overlaps, in bounds)
- **circuits/hit_miss** - Proves hit/miss response matches committed board

Contract accepts commitments; full BN254/Poseidon verification via Stellar Protocol 25 when available.

## Build

```bash
bun run build zk-battleship
```

## Test

```bash
cargo test -p zk-battleship
```

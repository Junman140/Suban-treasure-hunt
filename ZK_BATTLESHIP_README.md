# ZK Treasure Hunt on Stellar

A zero-knowledge Treasure Hunt game built on [Stellar Game Studio](https://github.com/jamesbachini/Stellar-Game-Studio).

## What Makes This ZK-Native

- **Placement Proof**: Players prove they placed exactly 5 treasures on valid grid positions with no overlaps—without revealing locations.
- **Hit/Miss Proof**: When responding to a dig, the defender proves the result is correct (treasure or empty) without revealing treasure positions.
- **Commitment Scheme**: Board state is hashed and committed on-chain; proofs verify consistency.

## How It Works

1. **Game Creation**: Both players sign `start_game` (multi-sig with Game Hub)
2. **Board Commit**: Each player submits `commit_board(commitment)` where commitment = hash(5 treasure placements)
3. **Hunt Phase**: Turn-based: attacker calls `fire_shot(x, y)` (dig), defender calls `respond_shot(hit)`
4. **Win Condition**: First to find all 5 opponent treasures wins; contract calls Game Hub `end_game`

## Technical Stack

- **Noir** - ZK circuits (placement, hit/miss)
- **Soroban** - Smart contracts on Stellar
- **Stellar Protocol 25** - BN254, Poseidon (for future on-chain proof verification)
- **Game Studio** - Frontend, wallet, deployment

## Setup & Installation

```bash
# Clone and install
git clone https://github.com/jamesbachini/Stellar-Game-Studio
cd Stellar-Game-Studio
bun install

# Build contracts and deploy to testnet
bun run setup

# Create zk-battleship game (if not already present)
bun run create zk-battleship --skip-setup

# Build zk-battleship contract
bun run build zk-battleship

# Generate bindings from WASM
stellar contract bindings typescript --wasm target/wasm32v1-none/release/zk_battleship.wasm --output-dir bindings/zk_battleship --overwrite --network testnet

# Run frontend
bun run dev:game zk-battleship
```

## Game Hub Integration

Hub contract (testnet): `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`

- `start_game()` called when both players sign
- `end_game()` called when a player wins

## Project Structure

```
Stellar-Game-Studio/
├── contracts/zk-battleship/   # Soroban contract
├── circuits/
│   ├── placement/             # Noir placement proof (5 treasures)
│   └── hit_miss/              # Noir hit/miss proof
├── zk-battleship-frontend/    # React frontend
└── bindings/zk_battleship/    # Generated TypeScript bindings
```

## Demo Video

(Link to 2-3 min demo: gameplay, ZK mechanics, contract interaction)

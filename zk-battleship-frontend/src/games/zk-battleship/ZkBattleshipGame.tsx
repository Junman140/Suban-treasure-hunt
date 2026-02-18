import { useState, useEffect, useRef } from 'react';
import {
  ZkBattleshipService,
  generateCommitment,
  type TreasurePlacement,
} from './zkBattleshipService';
import { useWallet } from '@/hooks/useWallet';
import { ZK_BATTLESHIP_CONTRACT, RPC_URL } from '@/utils/constants';
import { getLatestLedgerSequence } from '@/utils/ledgerUtils';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import type { Game } from './bindings';
import { PhaserGame } from './phaser/PhaserGame';
import { BattlePhaserGame } from './phaser/BattlePhaserGame';

const BOARD_SIZE = 10;
const DEFAULT_POINTS = '0.1';

const LEVELS = [
  { value: 1 as const, label: 'Quick Hunt', desc: '3 treasures, 20 shots max, sudden death on tie' },
  { value: 2 as const, label: 'Classic Timed', desc: '5 treasures, turn timeout ~2 min' },
];

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    let v = 0;
    while (!v) {
      crypto.getRandomValues(buf);
      v = buf[0];
    }
    return v;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

const zkBattleshipService = new ZkBattleshipService(ZK_BATTLESHIP_CONTRACT);

interface ZkBattleshipGameProps {
  userAddress: string;
  availablePoints: bigint;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

export function ZkBattleshipGame({
  userAddress,
  availablePoints,
  onStandingsRefresh,
  onGameComplete,
}: ZkBattleshipGameProps) {
  const { getContractSigner, walletType } = useWallet();
  const [sessionId, setSessionId] = useState(() => createRandomSessionId());
  const [gameState, setGameState] = useState<Game | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [phase, setPhase] = useState<'create' | 'commit' | 'battle' | 'complete'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import'>('create');
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [treasures, setTreasures] = useState<TreasurePlacement[]>([]);
  const [pendingShotCoord, setPendingShotCoord] = useState<{ x: number; y: number } | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<1 | 2>(1);
  const [currentLedgerSeq, setCurrentLedgerSeq] = useState<number | null>(null);
  const actionLock = useRef(false);
  const quickstartAvailable =
    walletType === 'dev' &&
    DevWalletService.isDevModeAvailable() &&
    DevWalletService.isPlayerAvailable(1) &&
    DevWalletService.isPlayerAvailable(2);

  const prevUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevUserRef.current !== null && prevUserRef.current !== userAddress && phase === 'commit') {
      setTreasures([]);
    }
    prevUserRef.current = userAddress;
  }, [userAddress, phase]);

  const runAction = async (fn: () => Promise<void>) => {
    if (actionLock.current || loading) return;
    actionLock.current = true;
    try {
      await fn();
    } finally {
      actionLock.current = false;
    }
  };

  const loadGameState = async () => {
    try {
      const game = await zkBattleshipService.getGame(sessionId);
      setGameState(game);
      if (game) {
        if (game.winner !== null && game.winner !== undefined) {
          setPhase('complete');
        } else if ((game.phase as unknown as number) === 0) {
          setPhase('commit');
        } else if ((game.phase as unknown as number) === 1) {
          setPhase('battle');
        }
        const ps = game.pending_shot;
        if (ps && Array.isArray(ps) && ps.length >= 2) {
          setPendingShotCoord({ x: Number(ps[0]), y: Number(ps[1]) });
        } else {
          setPendingShotCoord(null);
        }
      }
    } catch {
      setGameState(null);
    }
  };

  useEffect(() => {
    if (phase !== 'create' || exportedAuthEntryXDR) {
      loadGameState();
      const iv = setInterval(loadGameState, 3000);
      return () => clearInterval(iv);
    }
  }, [sessionId, phase, exportedAuthEntryXDR]);

  // Poll current ledger for timeout countdown (Level 2)
  useEffect(() => {
    if (phase !== 'battle' || !gameState?.turn_deadline_ledger || !gameState?.turn_timeout_ledgers) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const seq = await getLatestLedgerSequence(RPC_URL);
        if (!cancelled) setCurrentLedgerSeq(seq);
      } catch {
        if (!cancelled) setCurrentLedgerSeq(null);
      }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [phase, gameState?.turn_deadline_ledger, gameState?.turn_timeout_ledgers]);

  const parsePoints = (v: string): bigint | null => {
    const c = v.replace(/[^\d.]/g, '');
    if (!c || c === '.') return null;
    const [w = '0', f = ''] = c.split('.');
    const pad = f.padEnd(7, '0').slice(0, 7);
    return BigInt(w + pad);
  };

  const handleStartNewGame = () => {
    setPhase('create');
    setSessionId(createRandomSessionId());
    setGameState(null);
    setTreasures([]);
    setExportedAuthEntryXDR(null);
    setImportAuthEntryXDR('');
    setError(null);
    setSuccess(null);
    setPendingShotCoord(null);
    setShowMiniMap(false);
  };

  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        const p1Points = parsePoints(DEFAULT_POINTS) || 1000000n;
        const placeholderP2 = await getFundedSimulationSourceAddress([userAddress]);
        const authXDR =
          selectedLevel === 1 || selectedLevel === 2
            ? await zkBattleshipService.prepareStartGameV2(
                sessionId,
                userAddress,
                placeholderP2,
                p1Points,
                p1Points,
                selectedLevel,
                getContractSigner()
              )
            : await zkBattleshipService.prepareStartGame(
                sessionId,
                userAddress,
                placeholderP2,
                p1Points,
                p1Points,
                getContractSigner()
              );
        setExportedAuthEntryXDR(authXDR);
        setSuccess('Auth entry signed! Share with Player 2.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        if (!importAuthEntryXDR.trim()) throw new Error('Paste auth entry');
        const p2Points = parsePoints(DEFAULT_POINTS) || 1000000n;
        const params = zkBattleshipService.parseAuthEntry(importAuthEntryXDR.trim());
        if (params.player1 === userAddress) throw new Error('Cannot play yourself');
        const fullTx = await zkBattleshipService.importAndSignAuthEntry(
          importAuthEntryXDR.trim(),
          userAddress,
          p2Points,
          getContractSigner()
        );
        await zkBattleshipService.finalizeStartGame(fullTx, userAddress, getContractSigner());
        setSessionId(params.sessionId);
        setPhase('commit');
        setSuccess('Game created! Hide your treasures.');
        onStandingsRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Import failed');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        if (!quickstartAvailable) throw new Error('Need dev wallets');
        const p = parsePoints(DEFAULT_POINTS) || 1000000n;
        let p1Addr = '';
        let p2Addr = '';
        let p1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        let p2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        const orig = devWalletService.getCurrentPlayer();
        try {
          await devWalletService.initPlayer(1);
          p1Addr = devWalletService.getPublicKey();
          p1Signer = devWalletService.getSigner();
          await devWalletService.initPlayer(2);
          p2Addr = devWalletService.getPublicKey();
          p2Signer = devWalletService.getSigner();
        } finally {
          if (orig) await devWalletService.initPlayer(orig);
        }
        if (!p1Signer || !p2Signer || p1Addr === p2Addr) throw new Error('Dev wallets');
        const sid = createRandomSessionId();
        setSessionId(sid);
        const ph = await getFundedSimulationSourceAddress([p1Addr, p2Addr]);
        const auth =
          selectedLevel === 1 || selectedLevel === 2
            ? await zkBattleshipService.prepareStartGameV2(
                sid,
                p1Addr,
                ph,
                p,
                p,
                selectedLevel,
                p1Signer
              )
            : await zkBattleshipService.prepareStartGame(sid, p1Addr, ph, p, p, p1Signer);
        const full = await zkBattleshipService.importAndSignAuthEntry(
          auth,
          p2Addr,
          p,
          p2Signer
        );
        await zkBattleshipService.finalizeStartGame(full, p2Addr, p2Signer);
        setPhase('commit');
        setSuccess('Quickstart! Hide treasures for both players.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Quickstart failed');
      } finally {
        setLoading(false);
      }
    });
  };

  const toggleTreasure = (x: number, y: number) => {
    const idx = treasures.findIndex((t) => t.x === x && t.y === y);
    if (idx >= 0) {
      setTreasures(treasures.filter((_, i) => i !== idx));
    } else if (treasures.length < 5) {
      setTreasures([...treasures, { x, y }]);
    }
  };

  const handleCommitBoard = async () => {
    if (treasures.length !== 5) {
      setError('Select exactly 5 cells to hide treasures');
      return;
    }
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        const commitment = generateCommitment(treasures);
        await zkBattleshipService.commitBoard(
          sessionId,
          userAddress,
          commitment,
          getContractSigner()
        );
        setSuccess('Treasures hidden!');
        const updated = await zkBattleshipService.getGame(sessionId);
        setGameState(updated);
        if (updated && (updated.phase as unknown as number) === 1) setPhase('battle');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Commit failed');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleFireShot = async (x: number, y: number) => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        await zkBattleshipService.fireShot(sessionId, userAddress, x, y, getContractSigner());
        setSuccess('Digging...');
        await loadGameState();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Dig failed');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleRespondShot = async (hit: boolean) => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        await zkBattleshipService.respondShot(
          sessionId,
          userAddress,
          hit,
          getContractSigner()
        );
        setSuccess(hit ? 'Treasure!' : 'Empty');
        setPendingShotCoord(null);
        await loadGameState();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Respond failed');
      } finally {
        setLoading(false);
      }
    });
  };

  const handleClaimTimeoutWin = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        await zkBattleshipService.claimTimeoutWin(
          sessionId,
          userAddress,
          getContractSigner()
        );
        setSuccess('Timeout win claimed!');
        await loadGameState();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Claim failed');
      } finally {
        setLoading(false);
      }
    });
  };

  const isPlayer1 = gameState && gameState.player1 === userAddress;
  const isPlayer2 = gameState && gameState.player2 === userAddress;
  const haveICommitted =
    !!(isPlayer1 && gameState?.commitment1 != null) || !!(isPlayer2 && gameState?.commitment2 != null);

  const myShots: Array<{ x: number; y: number; hit: boolean }> =
    isPlayer1 && gameState
      ? (gameState.shots_by_player1 || []).map((s) => ({
          x: Number(s.x),
          y: Number(s.y),
          hit: s.hit,
        }))
      : isPlayer2 && gameState
        ? (gameState.shots_by_player2 || []).map((s) => ({
            x: Number(s.x),
            y: Number(s.y),
            hit: s.hit,
          }))
        : [];
  const opponentShots: Array<{ x: number; y: number; hit: boolean }> =
    isPlayer1 && gameState
      ? (gameState.shots_by_player2 || []).map((s) => ({
          x: Number(s.x),
          y: Number(s.y),
          hit: s.hit,
        }))
      : isPlayer2 && gameState
        ? (gameState.shots_by_player1 || []).map((s) => ({
            x: Number(s.x),
            y: Number(s.y),
            hit: s.hit,
          }))
        : [];
  const targetHits = gameState?.target_hits != null ? Number(gameState.target_hits) : 5;
  const myTreasuresFound = myShots.filter((s) => s.hit).length;
  const opponentTreasuresFound = opponentShots.filter((s) => s.hit).length;
  const currentTurn = gameState ? Number(gameState.current_turn) : 0;
  const isMyTurn =
    pendingShotCoord === null &&
    ((currentTurn === 1 && isPlayer1) || (currentTurn === 2 && isPlayer2));
  const isDefender = pendingShotCoord !== null;
  const amITheDefender = pendingShotCoord !== null && ((currentTurn === 1 && isPlayer2) || (currentTurn === 2 && isPlayer1));
  const turnDeadlineLedger = gameState?.turn_deadline_ledger != null ? Number(gameState.turn_deadline_ledger) : null;
  const timeoutLedgers = gameState?.turn_timeout_ledgers != null ? Number(gameState.turn_timeout_ledgers) : 0;
  const canClaimTimeout =
    phase === 'battle' &&
    timeoutLedgers > 0 &&
    turnDeadlineLedger != null &&
    currentLedgerSeq != null &&
    currentLedgerSeq > turnDeadlineLedger &&
    ((pendingShotCoord && !amITheDefender) || (!pendingShotCoord && !isMyTurn));

  return (
    <div className="bg-amber-50/90 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-amber-300">
      <h2 className="text-2xl font-black bg-gradient-to-r from-amber-700 to-yellow-600 bg-clip-text text-transparent mb-2">
        ZK Treasure Hunt
      </h2>
      <p className="text-sm text-amber-800/80 mb-1">
        Hide 5 treasures. Dig to find your opponent&apos;s. First to reach target hits wins.
      </p>
      <p className="text-xs text-amber-700/60 mb-4">
        Session ID: {sessionId}
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {phase === 'create' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => setCreateMode('create')}
              className={`px-4 py-2 rounded-lg font-bold ${createMode === 'create' ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-800'}`}
            >
              Create Game
            </button>
            <button
              onClick={() => setCreateMode('import')}
              className={`px-4 py-2 rounded-lg font-bold ${createMode === 'import' ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-800'}`}
            >
              Join Game
            </button>
          </div>
          {createMode === 'create' && (
            <div className="p-3 bg-amber-100/70 rounded-xl border border-amber-200">
              <p className="text-sm font-semibold text-amber-800 mb-2">Choose Level</p>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map((lev) => (
                  <button
                    key={lev.value}
                    onClick={() => setSelectedLevel(lev.value)}
                    className={`px-4 py-2 rounded-lg text-left font-medium text-sm ${
                      selectedLevel === lev.value
                        ? 'bg-amber-600 text-white ring-2 ring-amber-400'
                        : 'bg-amber-200/80 text-amber-800 hover:bg-amber-300'
                    }`}
                  >
                    <span className="block font-bold">{lev.label}</span>
                    <span className="block text-xs opacity-90">{lev.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {quickstartAvailable && (
            <button
              onClick={handleQuickStart}
              disabled={loading}
              className="px-4 py-2 rounded-lg font-bold bg-amber-500 text-white hover:bg-amber-600"
            >
              Quickstart (Dev)
            </button>
          )}
          {createMode === 'create' && (
            <>
              {!exportedAuthEntryXDR ? (
                <button
                  onClick={handlePrepareTransaction}
                  disabled={loading}
                  className="px-6 py-3 rounded-xl font-bold bg-amber-600 text-white hover:bg-amber-700"
                >
                  {loading ? 'Preparing...' : 'Prepare & Export Auth Entry'}
                </button>
              ) : (
                <div className="p-4 bg-amber-100/50 rounded-lg border border-amber-200 space-y-2">
                  <p className="text-sm font-semibold text-amber-800">Share with Player 2. Waiting for them to join...</p>
                  <p className="text-xs text-amber-700">Session ID: {sessionId} (share this too if they need to find the game)</p>
                  <p className="text-xs font-mono break-all mb-2">{exportedAuthEntryXDR}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(exportedAuthEntryXDR!)}
                    className="text-sm text-amber-700 font-semibold"
                  >
                    Copy Auth Entry
                  </button>
                </div>
              )}
            </>
          )}
          {createMode === 'import' && (
            <div className="space-y-2">
              <textarea
                value={importAuthEntryXDR}
                onChange={(e) => setImportAuthEntryXDR(e.target.value)}
                placeholder="Paste Player 1 auth entry..."
                rows={4}
                className="w-full p-3 rounded-lg border border-amber-200 text-sm font-mono bg-white"
              />
              <button
                onClick={handleImportTransaction}
                disabled={loading || !importAuthEntryXDR.trim()}
                className="px-6 py-3 rounded-xl font-bold bg-amber-600 text-white disabled:opacity-50 hover:bg-amber-700"
              >
                {loading ? 'Importing...' : 'Import & Start Game'}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'commit' && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-amber-800">
            Click 5 spots on the island to hide your treasures ({treasures.length}/5 selected)
          </p>
          <div className="flex flex-col items-center gap-2 w-full max-w-[min(100%,40rem)]">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-amber-700">
                <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                <span>Generating commitment...</span>
              </div>
            )}
            <div className="flex gap-1" aria-label="Treasure progress">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`text-lg ${i < treasures.length ? 'opacity-100' : 'opacity-30'}`}
                  title={i < treasures.length ? 'Treasure placed' : 'Empty'}
                >
                  💰
                </span>
              ))}
            </div>
            <PhaserGame
              phase="commit"
              treasures={treasures}
              onTileClick={toggleTreasure}
              className="border-2 border-amber-400 rounded-lg shadow-lg"
            />
          </div>
          <button
            onClick={handleCommitBoard}
            disabled={loading || treasures.length !== 5 || haveICommitted}
            className="px-6 py-3 rounded-xl font-bold bg-amber-600 text-white disabled:opacity-50 hover:bg-amber-700"
          >
            {loading ? 'Hiding...' : haveICommitted ? 'Treasures Hidden' : 'Hide Treasures'}
          </button>
        </div>
      )}

      {phase === 'battle' && gameState && (
        <div className="space-y-4">
          {/* Rules summary when level is set */}
          {(gameState.target_hits != null || gameState.max_shots_per_player != null || gameState.turn_timeout_ledgers != null) && (
            <div className="text-xs text-amber-700/90 mb-1 flex flex-wrap gap-x-3 gap-y-0">
              <span>First to {targetHits} hits wins</span>
              {gameState.max_shots_per_player != null && Number(gameState.max_shots_per_player) > 0 && (
                <span>Max {gameState.max_shots_per_player} shots/player</span>
              )}
              {timeoutLedgers > 0 && (
                <span>
                  Turn timeout: {timeoutLedgers} ledgers
                  {turnDeadlineLedger != null && currentLedgerSeq != null && (
                    <span className="ml-1">
                      (deadline ledger {turnDeadlineLedger}, current {currentLedgerSeq}
                      {currentLedgerSeq > turnDeadlineLedger ? ' — expired' : ` — ~${Math.max(0, Math.ceil((turnDeadlineLedger - currentLedgerSeq) * 5 / 60))} min left`})
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
          {canClaimTimeout && (
            <div className="p-3 bg-amber-200 border-2 border-amber-500 rounded-xl mb-2">
              <p className="text-amber-800 font-semibold text-sm">Opponent timed out. You can claim the win.</p>
              <button
                onClick={handleClaimTimeoutWin}
                disabled={loading}
                className="mt-2 px-4 py-2 rounded-lg font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {loading ? 'Claiming...' : 'Claim win (timeout)'}
              </button>
            </div>
          )}
          {/* HUD: Turn indicator + Treasure counters */}
          <div
            className={`flex justify-between items-center p-4 rounded-xl border-2 ${
              isMyTurn ? 'border-amber-500 bg-amber-50' : 'border-amber-200 bg-amber-50/50'
            }`}
          >
            <div className="flex flex-col">
              <span className="text-xs text-amber-700">Your Island</span>
              <span className="font-bold text-amber-800">
                Opponent found: {opponentTreasuresFound}/{targetHits}
              </span>
            </div>
            <div
              className={`px-4 py-2 rounded-lg font-black text-sm ${
                isMyTurn ? 'bg-amber-500 text-white animate-pulse' : 'bg-amber-200 text-amber-800'
              }`}
            >
              {isMyTurn ? 'YOUR TURN!' : 'Waiting for opponent...'}
            </div>
            <div className="flex flex-col text-right">
              <span className="text-xs text-amber-700">Enemy Island</span>
              <span className="font-bold text-amber-800">You found: {myTreasuresFound}/{targetHits}</span>
            </div>
          </div>
          {isDefender && pendingShotCoord && amITheDefender && (
            <div className="p-4 bg-amber-100 border-2 border-amber-400 rounded-xl">
              <p className="text-amber-800 font-semibold">
                Opponent dug at ({pendingShotCoord.x}, {pendingShotCoord.y}) — respond:
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => handleRespondShot(true)}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg font-bold bg-amber-500 text-white hover:bg-amber-600"
                >
                  Treasure!
                </button>
                <button
                  onClick={() => handleRespondShot(false)}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg font-bold bg-stone-400 text-white hover:bg-stone-500"
                >
                  Empty
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-center">
            <div className="relative max-w-full">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-amber-50/80 rounded-lg z-10">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-semibold text-amber-800">Verifying proof...</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 mb-2 text-sm">
                <div className="flex gap-2">
                  <span className="text-amber-800 font-semibold">Your Island</span>
                  <span className="text-amber-600">|</span>
                  <span className="text-amber-800 font-semibold">Enemy Island</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMiniMap((v) => !v)}
                  className="px-2 py-1 rounded text-xs font-medium bg-amber-200 text-amber-800 hover:bg-amber-300"
                >
                  {showMiniMap ? 'Hide' : 'Show'} Grid
                </button>
              </div>
              <BattlePhaserGame
                myShots={myShots}
                opponentShots={opponentShots}
                isMyTurn={!!isMyTurn}
                loading={loading}
                showMiniMap={showMiniMap}
                onAttackTile={handleFireShot}
                className="border-2 border-amber-400 rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}

      {phase === 'complete' && gameState?.winner && (
        <div className="p-8 text-center animate-[fadeIn_0.5s_ease-out]">
          <div
            className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 ${
              gameState.winner === userAddress ? 'bg-amber-400' : 'bg-stone-300'
            }`}
            role="img"
            aria-hidden
          >
            <span className="text-4xl">
              {gameState.winner === userAddress ? '🏆' : '💔'}
            </span>
          </div>
          <p className="text-2xl font-black text-amber-800 mb-1">
            {gameState.winner === userAddress ? 'Victory!' : 'Defeat'}
          </p>
          <p className="text-amber-700 mb-6">
            {gameState.winner === userAddress
              ? 'You found all the treasures!'
              : 'Your opponent found them first!'}
          </p>
          <button
            onClick={handleStartNewGame}
            className="px-6 py-3 rounded-xl font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
          >
            New Game
          </button>
        </div>
      )}
    </div>
  );
}

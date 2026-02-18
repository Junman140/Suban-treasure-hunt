import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { NETWORK } from '../utils/constants';
import { isTestnetAccountFunded, fundTestnetAccount } from '../utils/simulationUtils';
import './WalletSwitcher.css';

export function WalletSwitcher() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    walletType,
    error,
    connectDev,
    connectWallet,
    connectEmbeddedCreate,
    connectEmbedded,
    restoreLocalWallet,
    clearLocalWallet,
    hasStoredLocalWallet,
    disconnect,
    switchPlayer,
    getCurrentDevPlayer,
  } = useWallet();

  const currentPlayer = getCurrentDevPlayer();
  const hasAttemptedConnection = useRef(false);
  const [accountFunded, setAccountFunded] = useState<boolean | null>(null);
  const [fundingInProgress, setFundingInProgress] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [showEmbeddedForm, setShowEmbeddedForm] = useState(false);
  const [embeddedSecret, setEmbeddedSecret] = useState('');

  const showFundBlock = NETWORK === 'testnet' && (walletType === 'wallet' || walletType === 'embedded') && publicKey;
  useEffect(() => {
    if (!showFundBlock) {
      setAccountFunded(null);
      return;
    }
    let cancelled = false;
    isTestnetAccountFunded(publicKey!)
      .then((funded) => { if (!cancelled) setAccountFunded(funded); })
      .catch(() => { if (!cancelled) setAccountFunded(true); });
    return () => { cancelled = true; };
  }, [showFundBlock, publicKey]);

  const handleFundWallet = async () => {
    if (!publicKey || fundingInProgress) return;
    setFundError(null);
    setFundingInProgress(true);
    try {
      await fundTestnetAccount(publicKey);
      const funded = await isTestnetAccountFunded(publicKey);
      setAccountFunded(funded);
    } catch (err) {
      setFundError(err instanceof Error ? err.message : 'Funding failed');
    } finally {
      setFundingInProgress(false);
    }
  };

  // Auto-connect to Player 1 on mount (only try once)
  useEffect(() => {
    if (!isConnected && !isConnecting && !hasAttemptedConnection.current) {
      hasAttemptedConnection.current = true;
      connectDev(1).catch(console.error);
    }
  }, [isConnected, isConnecting, connectDev]);

  const handleSwitch = async () => {
    if (walletType !== 'dev') return;

    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    try {
      await switchPlayer(nextPlayer);
    } catch (err) {
      console.error('Failed to switch player:', err);
    }
  };

  if (!isConnected) {
    return (
      <div className="wallet-switcher">
        {error ? (
          <div className="wallet-error">
            <div className="error-title">Connection Failed</div>
            <div className="error-message">{error}</div>
          </div>
        ) : (
          <div className="wallet-status connecting">
            <span className="status-indicator"></span>
            <span className="status-text">Connecting...</span>
          </div>
        )}
        <button
          type="button"
          className="switch-button"
          onClick={() => connectWallet().catch(console.error)}
          disabled={isConnecting}
          style={{ marginTop: '0.5rem' }}
        >
          Connect wallet (Freighter, etc.)
        </button>
        <div style={{ marginTop: '0.25rem' }}>
          <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>Or use a local game wallet (no confirmations):</span>
          <button
            type="button"
            className="switch-button"
            onClick={() => connectEmbeddedCreate().catch(console.error)}
            disabled={isConnecting}
            style={{ marginTop: '0.25rem', marginRight: '0.25rem' }}
          >
            Create game wallet
          </button>
          {hasStoredLocalWallet() && (
            <button
              type="button"
              className="switch-button"
              onClick={() => restoreLocalWallet().catch(console.error)}
              disabled={isConnecting}
              style={{ marginTop: '0.25rem' }}
            >
              Restore game wallet
            </button>
          )}
          {!showEmbeddedForm ? (
            <button
              type="button"
              className="switch-button"
              onClick={() => setShowEmbeddedForm(true)}
              disabled={isConnecting}
              style={{ marginTop: '0.25rem' }}
            >
              Import secret
            </button>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              <input
                type="password"
                placeholder="Secret key (stored in browser)"
                value={embeddedSecret}
                onChange={(e) => setEmbeddedSecret(e.target.value)}
                style={{ width: '100%', marginBottom: '0.25rem', padding: '0.25rem' }}
                autoComplete="off"
              />
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  type="button"
                  className="switch-button"
                  onClick={() => connectEmbedded(embeddedSecret).catch(console.error)}
                  disabled={isConnecting || !embeddedSecret.trim()}
                >
                  Import
                </button>
                <button
                  type="button"
                  className="switch-button"
                  onClick={() => { setShowEmbeddedForm(false); setEmbeddedSecret(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-switcher">
      {error && (
        <div className="wallet-error">
          {error}
        </div>
      )}

      {showFundBlock && accountFunded === false && (
        <div className="wallet-fund-block" style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--color-surface-muted, #333)', borderRadius: '6px' }}>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
            Your testnet account needs XLM to play. Fund it with test XLM (free).
          </p>
          <button
            type="button"
            className="switch-button"
            onClick={handleFundWallet}
            disabled={fundingInProgress}
          >
            {fundingInProgress ? 'Funding...' : 'Fund with Friendbot'}
          </button>
          {fundError && <div className="wallet-error" style={{ marginTop: '0.5rem' }}>{fundError}</div>}
        </div>
      )}

      <div className="wallet-info">
        <div className="wallet-status connected">
          <span className="status-indicator"></span>
          <div className="wallet-details">
            <div className="wallet-label">
              {walletType === 'dev' && `Connected Player ${currentPlayer}`}
              {walletType === 'wallet' && 'Connected wallet'}
              {walletType === 'embedded' && 'Game wallet (local)'}
            </div>
            <div className="wallet-address">
              {publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` : ''}
            </div>
          </div>
          {walletType === 'dev' && (
            <button
              onClick={handleSwitch}
              className="switch-button"
              disabled={isConnecting}
            >
              Switch to Player {currentPlayer === 1 ? 2 : 1}
            </button>
          )}
          {walletType === 'wallet' && (
            <button
              type="button"
              className="switch-button"
              onClick={() => disconnect()}
              disabled={isConnecting}
            >
              Disconnect
            </button>
          )}
          {walletType === 'embedded' && (
            <>
              <button
                type="button"
                className="switch-button"
                onClick={() => disconnect()}
                disabled={isConnecting}
              >
                Disconnect
              </button>
              <button
                type="button"
                className="switch-button"
                onClick={() => clearLocalWallet()}
                disabled={isConnecting}
                title="Remove saved wallet from this browser"
              >
                Clear saved wallet
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

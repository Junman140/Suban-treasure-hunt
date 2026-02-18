import { useEffect, useState } from 'react';
import { useWalletStandalone } from '../hooks/useWalletStandalone';
import { NETWORK } from '../utils/constants';
import { isTestnetAccountFunded, fundTestnetAccount } from '../utils/simulationUtils';
import './WalletStandalone.css';

export function WalletStandalone() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    error,
    isWalletAvailable,
    network,
    connect,
    disconnect,
  } = useWalletStandalone();

  const address = typeof publicKey === 'string' ? publicKey : '';
  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  const [accountFunded, setAccountFunded] = useState<boolean | null>(null);
  const [fundingInProgress, setFundingInProgress] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);

  const showFundBlock = NETWORK === 'testnet' && isConnected && address;
  useEffect(() => {
    if (!showFundBlock) {
      setAccountFunded(null);
      return;
    }
    let cancelled = false;
    isTestnetAccountFunded(address)
      .then((funded) => { if (!cancelled) setAccountFunded(funded); })
      .catch(() => { if (!cancelled) setAccountFunded(true); });
    return () => { cancelled = true; };
  }, [showFundBlock, address]);

  const handleFundWallet = async () => {
    if (!address || fundingInProgress) return;
    setFundError(null);
    setFundingInProgress(true);
    try {
      await fundTestnetAccount(address);
      const funded = await isTestnetAccountFunded(address);
      setAccountFunded(funded);
    } catch (err) {
      setFundError(err instanceof Error ? err.message : 'Funding failed');
    } finally {
      setFundingInProgress(false);
    }
  };

  return (
    <div className="wallet-standalone">
      {!isConnected ? (
        <button
          className="wallet-standalone-button"
          onClick={() => connect().catch(() => undefined)}
          disabled={!isWalletAvailable || isConnecting}
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      ) : (
        <button className="wallet-standalone-button" onClick={disconnect}>
          {shortAddress}
        </button>
      )}

      {showFundBlock && accountFunded === false && (
        <div className="wallet-standalone-fund" style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'var(--color-surface-muted, #333)', borderRadius: '6px' }}>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
            Your testnet account needs XLM to play. Fund it with test XLM (free).
          </p>
          <button
            type="button"
            className="wallet-standalone-button"
            onClick={handleFundWallet}
            disabled={fundingInProgress}
          >
            {fundingInProgress ? 'Funding...' : 'Fund with Friendbot'}
          </button>
          {fundError && <div className="wallet-standalone-error" style={{ marginTop: '0.5rem' }}>{fundError}</div>}
        </div>
      )}

      {network && <div className="wallet-standalone-network">{network}</div>}

      {!isWalletAvailable && (
        <div className="wallet-standalone-error">Wallet connection is only available in the browser.</div>
      )}
      {error && <div className="wallet-standalone-error">{error}</div>}
    </div>
  );
}

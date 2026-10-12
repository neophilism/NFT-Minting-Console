import { useCallback, useEffect, useRef, useState } from 'react';
import { getAddress } from 'ethers/address';
import { api, ApiError } from './api';
import { assertChallenge, session as readSession } from './model';
import type { Configuration, Session } from './model';

export interface WalletProvider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
export interface WalletChoice { id: string; name: string; provider: WalletProvider }
declare global { interface Window { ethereum?: WalletProvider } }
export function useWallets() {
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  useEffect(() => {
    const add = (choice: WalletChoice) => setWallets(current => {
      if (current.some(x => x.provider === choice.provider || x.id === choice.id) || current.length >= 10) return current;
      return [...current, choice];
    });
    const announce = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      if (!value || typeof value !== 'object') return;
      const { info, provider } = value as { info?: { uuid?: unknown; name?: unknown }; provider?: WalletProvider };
      if (typeof info?.uuid !== 'string' || info.uuid.length > 100 || typeof info.name !== 'string' ||
          !info.name.trim() || info.name.length > 100 || !provider || typeof provider.request !== 'function') return;
      // Extension-supplied icons/HTML/URLs are deliberately not rendered.
      add({ id: info.uuid, name: info.name.slice(0, 50), provider });
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (window.ethereum && typeof window.ethereum.request === 'function') add({ id: 'injected', name: 'Browser wallet', provider: window.ethereum });
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);
  return wallets;
}
function walletError(error: unknown): string {
  const e = error as { code?: unknown };
  if (e?.code === 4001 || e?.code === 'ACTION_REJECTED') return 'You declined the wallet request. No transaction was sent.';
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && (error.message.startsWith('Switch ') || error.message.startsWith('The sign-in') ||
      error.message.startsWith('This sign-in') || error.message.startsWith('Wallet changed'))) return error.message;
  return 'Wallet sign-in did not complete. Check your wallet and network, then try again. No transaction was sent.';
}
export function useAuthentication(config: Configuration | null) {
  const [current, setCurrent] = useState<Session | null>(null);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false), [retryLogout, setRetryLogout] = useState(false);
  const active = useRef<Session | null>(null), epoch = useRef(0), running = useRef(false);
  const cleanupProvider = useRef<() => void>(() => {}), pendingLogout = useRef<string | null>(null);
  const setSession = (value: Session | null) => { active.current = value; setCurrent(value); };
  const removeProvider = () => { const clean = cleanupProvider.current; cleanupProvider.current = () => {}; try { clean(); } catch { /* A provider cleanup error must never prevent server revocation. */ } };
  const logout = useCallback(async () => {
    epoch.current++;
    const token = active.current?.csrf || pendingLogout.current;
    setSession(null); removeProvider();
    setError('');
    if (!token) return;
    pendingLogout.current = token; setRetryLogout(true);
    try { await api('/api/auth/logout', { method: 'POST', body: {}, csrf: token }); pendingLogout.current = null; setRetryLogout(false); }
    catch { setError('Server sign-out could not be confirmed. Retry sign-out to revoke this session.'); }
  }, []);
  const attachProvider = useCallback((provider: WalletProvider) => {
    removeProvider();
    if (typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') throw new Error('Wallet change notifications are required.');
    const invalidate = () => { void logout(); setError('Wallet or network changed. Sign in again before continuing.'); };
    cleanupProvider.current = () => { for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.removeListener?.(event, invalidate); };
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) provider.on(event, invalidate);
  }, [logout]);
  useEffect(() => {
    if (!config) return;
    const controller = new AbortController(), snapshot = epoch.current;
    setRestoring(true);
    api('/api/auth/session', { signal: controller.signal }).then(async value => {
      if (epoch.current !== snapshot || controller.signal.aborted) return;
      const restored = readSession(value, config.chainId), provider = window.ethereum;
      pendingLogout.current = restored.csrf;
      let matches = false;
      try {
        if (provider) {
          attachProvider(provider);
          const accounts = await provider.request({ method: 'eth_accounts' });
          const chain = await provider.request({ method: 'eth_chainId' });
          matches = Array.isArray(accounts) && typeof accounts[0] === 'string' && getAddress(accounts[0]) === restored.wallet &&
            typeof chain === 'string' && BigInt(chain) === BigInt(config.chainId);
        }
      } catch { matches = false; }
      if (controller.signal.aborted || epoch.current !== snapshot) return;
      if (!matches) { await logout(); setError('Reconnect the matching wallet and network to restore access.'); return; }
      pendingLogout.current = null; setSession(restored);
    }).catch(error => {
      if (!controller.signal.aborted && epoch.current === snapshot && !(error instanceof ApiError && error.status === 401)) setError('Session restore is unavailable. Connect your wallet to sign in again.');
    }).finally(() => { if (!controller.signal.aborted) setRestoring(false); });
    return () => controller.abort();
  }, [config, logout, attachProvider]);
  useEffect(() => () => removeProvider(), []);
  const expire = useCallback(() => { void logout(); }, [logout]);
  useEffect(() => {
    if (!current) return;
    const remaining = Math.min(Date.parse(current.expiresAt), Date.parse(current.idleExpiresAt)) - Date.now();
    const timer = window.setTimeout(expire, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [current, expire]);
  async function connect(choice: WalletChoice) {
    if (!config || running.current || restoring || retryLogout) return;
    running.current = true;
    const snapshot = ++epoch.current;
    setError(''); setPhase('Opening your wallet');
    try {
      attachProvider(choice.provider);
      const { BrowserProvider } = await import('ethers/providers');
      const provider = new BrowserProvider(choice.provider);
      await provider.send('eth_requestAccounts', []);
      if (epoch.current !== snapshot) throw new Error('Wallet changed during sign-in.');
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(config.chainId)) throw new Error(`Switch your wallet to ${config.chainName} (${config.chainId}) before signing.`);
      const signer = await provider.getSigner(), wallet = await signer.getAddress();
      const challenge = assertChallenge(await api('/api/auth/challenge', { method: 'POST', body: { wallet, chainId: config.chainId } }),
        wallet, window.location.origin, config.chainId);
      if (epoch.current !== snapshot) throw new Error('Wallet changed during sign-in.');
      setPhase('Review the sign-in message in your wallet');
      const signature = await signer.signMessage(challenge.message);
      if (epoch.current !== snapshot) throw new Error('Wallet changed during sign-in.');
      const accounts = await provider.send('eth_accounts', []);
      if (!Array.isArray(accounts) || !accounts[0] || getAddress(accounts[0]) !== getAddress(wallet) ||
          BigInt(await provider.send('eth_chainId', [])) !== BigInt(config.chainId)) throw new Error('Wallet changed during sign-in.');
      setPhase('Verifying your wallet');
      const value = readSession(await api('/api/auth/verify', { method: 'POST', body: { wallet, ...challenge, signature } }), config.chainId);
      if (epoch.current !== snapshot) {
        pendingLogout.current = value.csrf;
        await logout(); throw new Error('Wallet changed during sign-in.');
      }
      if (getAddress(value.wallet) !== getAddress(wallet)) { pendingLogout.current = value.csrf; await logout(); throw new Error('The sign-in response changed the wallet identity.'); }
      setSession(value);
    } catch (error) { setError(walletError(error)); }
    finally { setPhase(''); running.current = false; }
  }
  function cancel() { epoch.current++; setError('Sign-in cancelled. Dismiss the request in your wallet.'); }
  return { current, phase, error, restoring, connect, logout, expire, cancel,
    retryLogout, clearError: () => setError('') };
}

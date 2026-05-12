// Dashboard cluster — main account view, accounts picker, connected-sites
// management, AddToken modal, and the network/balance hook (useNetworkState)
// shared with Settings. Extracted from popup.tsx during the modularisation
// pass; no behaviour change.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { encodeFunctionData, type Address } from 'viem';
import { formatCurrency, truncateAddr } from '../../lib/format';
import { IPFS_GATEWAYS, ipfsTailFromUrl } from '../../core/erc721';
import { useCopyToClipboard, useEscapeKey } from '../hooks/use-clipboard';
import { getCurrentNetwork, listAllNetworks, type NftRecord } from '../../core/storage';
import type { Network } from '../../shared/config';
import { Header } from '../components/header';
import {
  AccountGlyph,
  send,
  useToast,
  type TokenMeta,
  type TokenRow,
} from '../shared';

export function AccountsScreen({
  address, onBack, onChange,
}: { address: Address; onBack: () => void; onChange: () => void }) {
  const showToast = useToast();
  const [accounts, setAccounts] = useState<AccountWithAddress[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  useEffect(() => { void load(); }, [address]);
  async function load() {
    try {
      setAccounts(await send<AccountWithAddress[]>({ kind: 'list-accounts' }));
    } catch { setAccounts([]); }
  }

  async function pick(idx: number) {
    setEditingIndex(null);
    if (accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())?.index === idx) {
      onBack();
      return;
    }
    const switched = await send<AccountWithAddress>({ kind: 'switch-account', index: idx });
    showToast({ tone: 'yellow', icon: '🐕', text: `switched to ${switched.label}.` });
    onChange();
  }
  async function add() {
    setEditingIndex(null);
    const created = await send<AccountWithAddress>({ kind: 'add-account' });
    await load();
    showToast({ tone: 'green', icon: '＋', text: `${created.label} added. much family.` });
  }
  function startRename(a: AccountWithAddress) {
    setEditingIndex(a.index);
    setDraftLabel(a.label);
  }
  async function commitRename() {
    if (editingIndex === null) return;
    const label = draftLabel.trim();
    if (!label) { setEditingIndex(null); return; }
    await send({ kind: 'rename-account', index: editingIndex, label });
    setEditingIndex(null);
    await load();
    showToast({ tone: 'yellow', icon: '✎', text: `renamed to "${label}".` });
  }

  return (
    <>
      <Header status="unlocked" onBack={onBack} />

      <div className="dk-set-card">
        <h4>your accounts</h4>
        {accounts.map((a) => {
          const isCurrent = a.address.toLowerCase() === address.toLowerCase();
          const isEditing = editingIndex === a.index;
          const aShort = truncateAddr(a.address);

          if (isEditing) {
            return (
              <div className="dk-set-row" key={a.index} style={{ gap: 6, background: 'var(--cream)' }}>
                <AccountGlyph address={a.address} size={22} />
                <input
                  autoFocus
                  className="dk-input"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                    if (e.key === 'Escape') setEditingIndex(null);
                  }}
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px', boxShadow: 'none' }}
                />
                <button
                  type="button"
                  className="dk-btn dk-btn-sm"
                  onClick={() => void commitRename()}
                  style={{ padding: '4px 8px', fontSize: 11 }}
                >
                  save
                </button>
              </div>
            );
          }

          const balDisplay =
            a.nativeBalance != null
              ? `${Number(a.nativeBalance).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${a.nativeSymbol ?? ''}`
              : '—';
          return (
            <div
              key={a.index}
              className="dk-set-row is-clickable"
              onClick={() => pick(a.index)}
              style={{ background: isCurrent ? 'var(--cream)' : undefined }}
            >
              <AccountGlyph address={a.address} size={22} />
              <span className="label" style={{ minWidth: 0 }}>
                <span style={{ display: 'block' }}>
                  {a.label}
                  {isCurrent && (
                    <span style={{ marginLeft: 6, color: 'var(--chunky-green)', fontFamily: 'var(--font-mono)' }}>✓</span>
                  )}
                </span>
                <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6, fontWeight: 600, marginTop: 2 }}>
                  {aShort} · {balDisplay}
                </span>
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startRename(a); }}
                title="rename"
                aria-label={`rename ${a.label}`}
                style={{
                  border: '2px solid var(--ink)',
                  background: 'var(--white)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  fontSize: 11,
                  marginLeft: 4,
                }}
              >
                ✎
              </button>
            </div>
          );
        })}
        <div
          className="dk-set-row is-clickable"
          onClick={() => void add()}
          style={{ background: 'var(--chunky-green)' }}
        >
          <span className="ico">＋</span>
          <span className="label" style={{ fontWeight: 800 }}>add account</span>
          <span className="car">›</span>
        </div>
      </div>
    </>
  );
}

// ─── Connected sites screen — every authorised origin + its pinned account
//      + revoke button. Per-origin account memory means each dapp shows
//      exactly which HD account it sees. ─────────────────────────────────

type ConnectedSite = {
  origin: string;
  accountIndex: number;
  accountLabel: string;
  address: Address;
};

export function ConnectedSitesScreen({ onBack }: { onBack: () => void }) {
  const showToast = useToast();
  const [sites, setSites] = useState<ConnectedSite[] | null>(null);

  useEffect(() => { void load(); }, []);
  async function load() {
    try {
      setSites(await send<ConnectedSite[]>({ kind: 'list-connected-sites' }));
    } catch {
      setSites([]);
    }
  }
  async function revoke(origin: string) {
    await send({ kind: 'revoke-origin', origin });
    setSites((cur) => cur?.filter((s) => s.origin !== origin) ?? null);
    showToast({ tone: 'yellow', icon: '🔗', text: `revoked ${origin.replace(/^https?:\/\//, '')}` });
  }

  return (
    <>
      <Header status="unlocked" onBack={onBack} />

      <div className="dk-set-card">
        <h4>connected dapps · {sites?.length ?? 0}</h4>
        {sites === null ? (
          <p className="dk-mono" style={{ padding: 14, opacity: 0.55, textAlign: 'center' }}>loading…</p>
        ) : sites.length === 0 ? (
          <div className="dk-empty" style={{ marginTop: 14, marginBottom: 6 }}>
            <span className="doge-stamp">such empty</span>
            <h3>no dapps yet</h3>
            <p>connect a site, it'll show up here.</p>
          </div>
        ) : (
          sites.map((s) => {
            const host = s.origin.replace(/^https?:\/\//, '');
            return (
              <div className="dk-set-row" key={s.origin} style={{ alignItems: 'flex-start', paddingTop: 10, paddingBottom: 10 }}>
                <AccountGlyph address={s.address} size={26} />
                <span
                  className="label"
                  style={{ minWidth: 0, paddingLeft: 6, textTransform: 'none' }}
                >
                  <span
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={host}
                  >
                    {host}
                  </span>
                </span>
                <button
                  onClick={() => revoke(s.origin)}
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--doge-yellow)',
                    border: '2px solid var(--ink)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '4px 8px',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  revoke
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}


/** Shape of the network state shared across every popup screen. */
type NetworkState = {
  chainId: number | null;
  rpcUrl: string | null;
  networks: Network[];
  current: Network | undefined;
  switchTo: (n: Network) => Promise<void>;
};

const DEFAULT_NETWORK_STATE: NetworkState = {
  chainId: null,
  rpcUrl: null,
  networks: [],
  current: undefined,
  switchTo: async () => {},
};

// Context that hoists `useNetworkState`'s storage reads into a single
// fetch shared across every screen. Without this, each consumer
// (Dashboard, Send, Activity, Settings, Receive) would run its own
// useEffect → 5 separate chrome.storage.local.get calls on every
// navigation. NetworkProvider centralises the fetch so the popup pays
// it once per chain switch.
const NetworkContext = createContext<NetworkState>(DEFAULT_NETWORK_STATE);

export function NetworkProvider({ children }: { children: import('react').ReactNode }) {
  const showToast = useToast();
  const [chainId, setChainId] = useState<number | null>(null);
  const [rpcUrl, setRpcUrl] = useState<string | null>(null);
  const [networks, setNetworks] = useState<Network[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [net, list] = await Promise.all([
        getCurrentNetwork(),
        listAllNetworks(),
      ]);
      if (cancelled) return;
      setChainId(net.chain.id);
      setRpcUrl(net.rpcUrl);
      setNetworks(list);
    })();
    return () => { cancelled = true; };
  }, []);

  const switchTo = async (n: Network) => {
    await send({ kind: 'switch-chain', chainId: n.chain.id, rpcUrl: n.rpcUrl });
    setChainId(n.chain.id);
    setRpcUrl(n.rpcUrl);
    showToast({ tone: 'yellow', icon: '🌐', text: `on ${n.chain.name}.` });
  };

  // Pick THE active entry by (chainId, rpcUrl) tuple — chainId alone
  // matches multiple rows when a custom RPC for a builtin chain was
  // added. Memoized so consumer-side comparisons are stable across
  // unrelated renders.
  const value = useMemo<NetworkState>(() => {
    const current = chainId !== null
      ? networks.find((n) => n.chain.id === chainId && (!rpcUrl || n.rpcUrl === rpcUrl))
        ?? networks.find((n) => n.chain.id === chainId)
      : undefined;
    return { chainId, rpcUrl, networks, current, switchTo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, rpcUrl, networks]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetworkState(): NetworkState {
  return useContext(NetworkContext);
}

type AccountWithAddress = {
  index: number;
  label: string;
  address: Address;
  /** Active-chain native balance (formatted decimal string), or null if RPC failed. */
  nativeBalance?: string | null;
  /** Active chain's native symbol (ETH / BNB / MATIC / …). */
  nativeSymbol?: string;
};

/** Pick the visual class for the token icon block based on symbol. Falls
 *  back to a generic cream square so unknown tokens still look styled. */
function tokenIconClass(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s === 'USDC') return 'usdc';
  if (s === 'USDT') return 'usdt';
  if (s === 'DAI')  return 'dai';
  if (s === 'WETH') return 'weth';
  if (s === 'ETH')  return 'eth';
  return 'gen';
}

// ─── Easter egg: clickable 🐕 in the Ð0 hero adds $SHIT ──────────────────
// $SHIT is the brand token (0xaF1E5…742069 on Ethereum mainnet). Fresh
// wallets / wallets with no DOGE-denominated value show "Ð 0" in the
// hero. When that's the case AND the user is on mainnet AND $SHIT isn't
// already in their list, render the "0" as a clickable doge. Click →
// fall animation → add-token RPC → token list refetches and the new
// SHIT row lands in the dashboard.
//
// Only mainnet — the contract isn't deployed elsewhere; on Sepolia or
// any custom chain this stays as a literal "0".

const SHIT_TOKEN_ADDRESS: Address = '0xaF1E52927d724Fd34773Bd53adA57f4C2B742069';
const MAINNET_CHAIN_ID = 1;

/** Inline SVG of the brand pile (matching the shape committed to
 *  public/icons/*.png), but stripped of the yellow rounded-square
 *  chrome — pure pile + face on a transparent background. Used as
 *  the "poop" sprite that drops out from under the doge in the easter
 *  egg. SVG (not PNG) so it scales sharply at any display size and
 *  stays consistent with AccountGlyph in shared.tsx, which uses the
 *  same path. */
/** Race-load an NFT image across every IPFS_GATEWAYS entry in parallel.
 *  ipfs.io alone is unreliable (504s in the wild); nftstorage / w3s
 *  serve nft.storage uploads but 30x-redirect Pinata-pinned content;
 *  pinata serves its own pins but is slow elsewhere. Single-gateway
 *  defaults always pick wrong some fraction of the time, so we
 *  literally fire one hidden `<img>` per gateway and let the first
 *  to fire `onLoad` become the visible source — guaranteed fastest
 *  working gateway with zero JS-side polling/probing. When `src`
 *  isn't an IPFS path (data: URLs, https://example.com/...), short-
 *  circuit to a single img — no race needed. */
function NftImage({ src, alt = '' }: { src: string; alt?: string }) {
  const tail = ipfsTailFromUrl(src);
  const [winner, setWinner] = useState<string | null>(null);

  if (!tail) {
    return <img src={src} alt={alt} loading="lazy" />;
  }

  const candidates = IPFS_GATEWAYS.map((gw) => gw + tail);

  return (
    <>
      {winner ? (
        <img src={winner} alt={alt} loading="lazy" />
      ) : (
        <span className="placeholder" aria-hidden>🖼</span>
      )}
      {/* Hidden probes — once any fires onLoad we record it and React
          unmounts the rest (their pending requests get cancelled by
          the browser). 1×1 invisible so layout doesn't shift. */}
      {!winner && candidates.map((url) => (
        <img
          key={url}
          src={url}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            width: 1, height: 1,
            opacity: 0, pointerEvents: 'none',
          }}
          onLoad={() => setWinner((cur) => cur ?? url)}
        />
      ))}
    </>
  );
}

function ShitPileGlyph() {
  return (
    <svg
      className="dk-doge-poop"
      viewBox="0 0 128 128"
      aria-hidden
      // The pile path is pinned at translate(4, 9) inside the original
      // icon's 128×128 frame; preserving that placement means the
      // visual proportions match every other rendering of the brand.
    >
      <g transform="translate(4 9)">
        <path
          d="M 18 100 Q 18 88, 30 86 Q 28 72, 44 68 Q 42 54, 60 50 Q 58 36, 76 34 Q 74 22, 88 22 Q 92 22, 90 28 Q 96 26, 96 36 Q 102 40, 96 48 Q 102 56, 92 60 Q 100 68, 86 72 Q 94 82, 78 84 Q 84 96, 66 96 Q 70 104, 54 102 L 22 102 Z"
          fill="#8B6B3A"
          stroke="#000"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        {/* Eyes + smile — same coords as the brand icon. */}
        <circle cx="78"   cy="44"   r="3.5" fill="#000" />
        <circle cx="90"   cy="44"   r="3.5" fill="#000" />
        <circle cx="78.7" cy="43.1" r="1.2" fill="#fff" />
        <circle cx="90.7" cy="43.1" r="1.2" fill="#fff" />
        <path
          d="M 76 56 Q 84 62, 92 56"
          fill="none"
          stroke="#000"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

function ShitDogeEgg({
  interactive, onAdded,
}: {
  /** When true (mainnet + $SHIT not yet added), hover wiggles + click
   *  triggers the doge-squats + poop-drops animation + add-token RPC.
   *  When false (other chains, or $SHIT already in list), the 🐕 just
   *  sits there as brand decoration — no cursor, no click, no hover
   *  effect. */
  interactive: boolean;
  onAdded: () => void;
}) {
  // 'pooping' covers the whole 1100 ms motion: doge squats briefly, a
  // 💩 emerges from under it and falls down off the hero. The doge does
  // NOT vanish — it stays anchored on the left of Ð throughout, per
  // brand: dogeshit meme = the doge produces the shit, both are present.
  const [phase, setPhase] = useState<'idle' | 'pooping'>('idle');
  const showToast = useToast();

  const click = async () => {
    if (!interactive || phase !== 'idle') return;
    setPhase('pooping');
    try {
      await send({ kind: 'add-token', address: SHIT_TOKEN_ADDRESS });
    } catch (e) {
      setPhase('idle');
      showToast({ tone: 'red', icon: '💥', text: e instanceof Error ? e.message : String(e) });
      return;
    }
    // Let the 💩 reach the token-list area (~900 ms — about 80% into
    // the 1100 ms poopDrop animation) before reloading. The new $SHIT
    // row pops in just as the 💩 is fading out over the "my tokens"
    // section — visually the dog drops the token in.
    window.setTimeout(() => {
      setPhase('idle');
      onAdded();
      showToast({ tone: 'green', icon: '🐕', text: 'added $SHIT. much wallet, very meme.' });
    }, 900);
  };

  return (
    <span
      className={`dk-doge-egg phase-${phase} ${interactive ? 'is-interactive' : 'is-static'}`}
      onClick={interactive ? click : undefined}
      role={interactive ? 'button' : undefined}
      // No `title` attribute — user explicitly didn't want a hover
      // tooltip floating over the doge. The `aria-label` stays so
      // screen readers still announce the action; that's
      // a11y-only and never paints on screen.
      aria-label={interactive ? 'add $SHIT to wallet' : undefined}
    >
      <span className="dk-doge-egg-body">🐕</span>
      {phase === 'pooping' && <ShitPileGlyph />}
    </span>
  );
}

export function Dashboard({
  address, onSettings, onAddToken, onSend, onReceive, onAddNft, onActivity,
}: {
  address: Address;
  onSettings: () => void;
  onAddToken: () => void;
  /** `tokenAddress` pre-selects which token the Send screen opens
   *  with. Pass 'native' for ETH/BNB/etc.; pass a 0x-prefixed ERC-20
   *  contract address for a custom token. Defaults to native when
   *  omitted (existing top-bar Send button keeps that behavior). */
  onSend: (tokenAddress?: string) => void;
  onReceive: () => void;
  onAddNft: () => void;
  onActivity: () => void;
}) {
  const { chainId, rpcUrl: currentRpcUrl, networks, switchTo } = useNetworkState();
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [hideZero, setHideZero] = useState(false);
  const [tabOrigin, setTabOrigin] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  // Display-currency preference + DOGE/USD rate. Currency is loaded once on
  // mount; rate arrives with each read-token-balances response so it stays
  // fresh (DefiLlama 60s TTL behind it). Defaulting both to safe fallbacks
  // means the very first render is `$0.00` not blank.
  const [currency, setCurrency] = useState<'doge' | 'usd'>('doge');
  const [dogeUsdRate, setDogeUsdRate] = useState<number | null>(null);
  // Bump this to force a token-list refetch (used by the $SHIT egg after
  // a successful add-token, so the new row appears in the list).
  const [reloadKey, setReloadKey] = useState(0);
  // Listen for SW-broadcast "balance-changed" — fires after a popup-
  // initiated send's tx receipt lands. Bumps reloadKey so the
  // dashboard refetches and shows the post-tx amounts WITHOUT the
  // user needing to manually close + reopen the popup or wait for
  // the stale-while-revalidate TTL.
  useEffect(() => {
    const onMessage = (msg: unknown): void => {
      if ((msg as { kind?: string })?.kind === 'balance-changed') {
        setReloadKey((k) => k + 1);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);
  // Right-click context menu — which token row's "🗑 remove" pill is
  // currently open (null when none). Replaces the always-visible ✕ on
  // each row; right-click is more deliberate than a misclick on a
  // permanent button. Builtin + native rows never set this (they're
  // not removable; their onContextMenu handler is omitted so the
  // browser's native menu shows on right-click — useful for "copy
  // contract address" etc.).
  const [removeCtxAddr, setRemoveCtxAddr] = useState<string | null>(null);
  // NFT right-click context menu — keyed by `${address}::${tokenId}`
  // so the same contract's multiple tokens each get their own toggle
  // state. Mirrors the token-row pattern below.
  const [removeCtxNftKey, setRemoveCtxNftKey] = useState<string | null>(null);
  // NFT detail/send modal: which NFT (if any) is showing the big card,
  // and which view it opens to. Click a grid card → 'detail'; click
  // the send button → 'send' directly. Backdrop / Esc / ✕ closes.
  const [previewNft, setPreviewNft] = useState<{ nft: NftRecord; view: 'detail' | 'send' } | null>(null);
  // Token detail modal — same overlay pattern as NFT. Click a token
  // row in the list → opens. Modal has its own Send CTA that closes
  // the modal and routes to SendScreen with that token pre-selected.
  const [previewToken, setPreviewToken] = useState<TokenRow | null>(null);
  // Tokens / NFTs tab switch — the section between the action row and
  // the "+ add" strip swaps the rendered list. Both are loaded on
  // mount so switching is instant (no re-fetch on toggle).
  const [activeTab, setActiveTab] = useState<'tokens' | 'nfts'>('tokens');
  const [nfts, setNfts] = useState<NftRecord[] | null>(null);
  // Folding-screen tab strip — measure THREE things at runtime so
  // the overlap covers exactly the inactive tab's "MY " prefix +
  // its left padding/border, no more, no less:
  //   tokensWidth — full intrinsic width of "MY TOKENS" button
  //   nftsWidth   — full intrinsic width of "MY NFTS" button
  //   myPrefixPx  — rendered width of the "MY " glyph in the
  //                 display font + the inactive tab's left padding
  //                 + border (i.e. the exact overlap we want)
  // Inactive's `left` = activeWidth − myPrefixPx so the active
  // tab's right border lands at the END of the inactive's "MY ".
  // No hard-coded pixel guesses — every value is observed.
  const tokensTabRef = useRef<HTMLButtonElement>(null);
  const nftsTabRef = useRef<HTMLButtonElement>(null);
  const myProbeRef = useRef<HTMLSpanElement>(null);
  const [tabWidths, setTabWidths] = useState<{ tokens: number; nfts: number }>({ tokens: 0, nfts: 0 });
  const [myPrefixPx, setMyPrefixPx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await send<'doge' | 'usd'>({ kind: 'get-currency' });
        if (!cancelled) setCurrency(c);
      } catch { /* keep default */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Detect whether the currently-active browser tab is an origin we've
  // authorized. Updates the connection strip at the bottom of the dashboard.
  useEffect(() => {
    void (async () => {
      let origin: string | null = null;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) origin = new URL(tab.url).origin;
      } catch { /* tab access denied — skip */ }
      setTabOrigin(origin);
      if (!origin) { setIsConnected(false); return; }
      try {
        const list = await send<string[]>({ kind: 'list-connected-origins' });
        setIsConnected(list.includes(origin));
      } catch { setIsConnected(false); }
    })();
  }, [address]);

  async function disconnectTab() {
    if (!tabOrigin) return;
    try {
      await send({ kind: 'revoke-origin', origin: tabOrigin });
      setIsConnected(false);
      showToast({ tone: 'yellow', icon: '🔗', text: 'disconnected. so long, fren.' });
    } catch { /* keep state */ }
  }

  // Close the right-click "remove" context menu on outside left-click
  // or Escape. Right-clicks (button !== 0) are NOT handled here —
  // they're forwarded to the row's own onContextMenu, which toggles
  // the menu state directly. Without this filter, a right-click on
  // the same row would (a) fire mousedown (closes the menu) then
  // (b) fire contextmenu (toggles back to open) — net effect: menu
  // never actually toggles closed via right-click.
  useEffect(() => {
    if (!removeCtxAddr && !removeCtxNftKey) return;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      // Click anywhere outside the open context menu (.dk-trow-ctx
      // for tokens, .dk-nft-ctx for NFTs) closes it.
      if (!t.closest('.dk-trow-ctx')) setRemoveCtxAddr(null);
      if (!t.closest('.dk-nft-ctx')) setRemoveCtxNftKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRemoveCtxAddr(null);
        setRemoveCtxNftKey(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [removeCtxAddr, removeCtxNftKey]);

  // Measure tab widths + "MY " prefix width (font-rendered) so the
  // overlap can be derived rather than guessed. useLayoutEffect runs
  // before paint — no flash of wrong-position. Re-runs on every
  // render (intrinsic widths are stable; the state guard prevents
  // setState→re-render loop).
  useLayoutEffect(() => {
    const tw = tokensTabRef.current?.offsetWidth ?? 0;
    const nw = nftsTabRef.current?.offsetWidth ?? 0;
    // myProbeRef is a visibility:hidden absolute-positioned span
    // mounted next to the tabs (see JSX below). Its computed width
    // includes the inactive tab's left border + padding (we style
    // the probe identically). Result: setting inactive.left =
    // activeWidth − this value puts active's right border exactly
    // at the seam after the inactive's "MY " glyph.
    const mw = myProbeRef.current?.offsetWidth ?? 0;
    if (tw !== tabWidths.tokens || nw !== tabWidths.nfts) {
      setTabWidths({ tokens: tw, nfts: nw });
    }
    if (mw !== myPrefixPx) setMyPrefixPx(mw);
  });

  // Pull the hide-zero pref on mount.
  useEffect(() => {
    void (async () => {
      try { setHideZero(await send<boolean>({ kind: 'get-hide-zero' })); } catch {}
    })();
  }, []);

  async function toggleHideZero() {
    const next = !hideZero;
    setHideZero(next);
    try {
      await send({ kind: 'set-hide-zero', value: next });
    } catch {
      // Persisting failed — revert UI so it doesn't lie about state.
      setHideZero(!next);
    }
  }

  // Three-phase load (stale-while-revalidate):
  //   1. metadata (instant, no RPC) — list of tokens with placeholder balances
  //   2. stale cache (chrome.storage.local read, microseconds) — last-known
  //      balances + USD prices from a previous session. Renders immediately
  //      so the user sees real numbers on first frame, even if they haven't
  //      opened the wallet in days.
  //   3. fresh fetch (RPC + DefiLlama, can be slow) — overrides phase 2
  //      values as data arrives.
  // Race-safe: phase 2 only writes if no fresh data has arrived yet
  // (cancelled-by-phase-3 guard via `freshDone` flag).
  useEffect(() => {
    if (chainId === null) return;
    let cancelled = false;
    let freshDone = false;
    (async () => {
      setTokens(null);
      let metaList: TokenMeta[];
      try {
        metaList = await send<TokenMeta[]>({ kind: 'list-tokens' });
        if (cancelled) return;
        setTokens(metaList.map((m) => ({ ...m, balance: '0', loaded: false, priceUsd: null })));
      } catch {
        if (!cancelled) setTokens([]);
        return;
      }

      // Phase 2 — stale cache paint. Fire-and-forget; the fresh call
      // races against it but is virtually always slower (microseconds
      // vs. RPC round-trip), so this paints first in practice.
      void (async () => {
        try {
          const stale = await send<{
            tokens: (TokenMeta & { balance: string; priceUsd: number | null })[];
            dogeUsdRate: number | null;
            fetchedAt: number;
          } | null>({ kind: 'read-token-balances-stale' });
          if (cancelled || freshDone || !stale) return;
          setDogeUsdRate(stale.dogeUsdRate);
          const byAddr = new Map(stale.tokens.map((t) => [t.address.toLowerCase(), t]));
          setTokens((cur) =>
            cur?.map((t) => {
              const next = byAddr.get(t.address.toLowerCase());
              return next ? { ...t, balance: next.balance, priceUsd: next.priceUsd, loaded: true } : t;
            }) ?? cur,
          );
        } catch {
          // No cache yet (first-ever open) or storage glitch — phase 3
          // will fill in shortly. Nothing to surface to the user.
        }
      })();

      // Phase 3 — fresh fetch. Always runs, even if phase 2 painted.
      try {
        const reply = await send<{
          tokens: (TokenMeta & { balance: string; priceUsd: number | null })[];
          dogeUsdRate: number | null;
        }>({
          kind: 'read-token-balances',
        });
        if (cancelled) return;
        freshDone = true;
        const filled = reply.tokens;
        setDogeUsdRate(reply.dogeUsdRate);
        const byAddr = new Map(filled.map((t) => [t.address.toLowerCase(), t]));
        setTokens((cur) =>
          cur?.map((t) => {
            const next = byAddr.get(t.address.toLowerCase());
            return next ? { ...t, balance: next.balance, priceUsd: next.priceUsd, loaded: true } : t;
          }) ?? cur,
        );
      } catch {
        // RPC failed wholesale — phase 2's stale data stays on screen
        // if it landed. Otherwise the "0" placeholder remains. Either
        // way the user sees the token list, not a stuck spinner.
      }
    })();
    return () => { cancelled = true; };
  }, [chainId, reloadKey]);

  // NFT list — same lifecycle (per-chain, re-fetch on reload bump).
  // Loaded independently of tokens so a slow NFT fetch never blocks
  // the dashboard's hero/token render. Empty/null states are handled
  // by the NFTs tab's render branch.
  useEffect(() => {
    if (chainId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await send<NftRecord[]>({ kind: 'list-nfts' });
        if (!cancelled) setNfts(list);
      } catch {
        if (!cancelled) setNfts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [chainId, reloadKey]);

  async function removeNft(addr: string, tokenId: string) {
    try {
      await send({ kind: 'remove-nft', address: addr, tokenId });
      setNfts((cur) => cur?.filter(
        (n) => !(n.address === addr.toLowerCase() && n.tokenId === tokenId),
      ) ?? null);
      showToast({ tone: 'yellow', icon: '🗑', text: 'NFT removed.' });
    } catch (e) {
      showToast({
        tone: 'red', icon: '⚠',
        text: (e instanceof Error ? e.message : String(e)).slice(0, 90),
      });
    }
  }

  async function removeToken(addr: string) {
    if (addr === 'native') return; // safety: native row is non-removable
    await send({ kind: 'remove-token', address: addr });
    setTokens((cur) => cur?.filter((t) => t.address !== addr.toLowerCase()) ?? null);
    showToast({ tone: 'yellow', icon: '🗑', text: 'token removed.' });
  }

  /** Format a token row's value in the user's chosen currency. Returns '—' if
   *  no price feed for this token (testnets, unsupported chains). */
  function rowUsd(t: TokenRow): string {
    const bal = parseFloat(t.balance);
    if (!Number.isFinite(bal) || t.priceUsd == null) return '—';
    return formatCurrency(bal * t.priceUsd, currency, dogeUsdRate);
  }

  const showToast = useToast();
  // Hero address pill — copies the active account address to clipboard,
  // flashes a "copied" state for 1.5s + fires a yellow toast.
  const [copied, setCopied] = useState(false);
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      showToast({ tone: 'green', icon: '🐕', text: 'address copied! much share' });
    } catch {
      showToast({ tone: 'red', icon: '⚠', text: 'clipboard blocked, copy manually fren' });
    }
  }
  const shortAddr = truncateAddr(address);

  // Aggregate USD across all rows (always, even hidden ones — total is the
  // wallet's full worth, not "what's visible"). Rows without a price feed
  // contribute 0 — testnets etc. don't poison the total.
  const totalUsd = (tokens ?? []).reduce((acc, t) => {
    const bal = parseFloat(t.balance);
    if (!Number.isFinite(bal) || t.priceUsd == null) return acc;
    return acc + bal * t.priceUsd;
  }, 0);
  // Single-currency hero: the active currency's full string. The pre-split
  // form (whole + cents) was specific to "$X.XX" two-decimal USD, so we keep
  // a USD whole/cents path for the existing big-number layout but compute
  // the Ð form as one block when active.
  const totalUsdStr = totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [usdWhole, usdCents] = totalUsdStr.split('.');
  const totalDogeStr = formatCurrency(totalUsd, 'doge', dogeUsdRate);
  const allLoaded = tokens !== null && tokens.every((t) => t.loaded);

  // 🐕 visibility: any time the user is in DOGE-mode display, on any
  // chain, regardless of balance. The dog is permanent brand
  // decoration — sits left of Ð whether the value is 0 or 1,000,000.
  // (Earlier this also gated on totalUsd === 0, which broke the
  // intended UX: on mainnet with any real balance the dog vanished.)
  // 🐕 *interactivity*: only on mainnet AND when $SHIT isn't already
  // in the user's list — those are the conditions where the click→add
  // flow makes sense. On other chains / after SHIT is added the dog
  // renders but doesn't react.
  const hasShit = (tokens ?? []).some(
    (t) => t.address.toLowerCase() === SHIT_TOKEN_ADDRESS.toLowerCase(),
  );
  const showDogeEgg = currency === 'doge';
  const eggInteractive = chainId === MAINNET_CHAIN_ID && !hasShit;

  // List filter: hide zero balances if the user opted in. Native row is
  // exempt — it's the chain's gas asset and hiding it leaves a weird gap.
  const visibleTokens = (tokens ?? []).filter((t) => {
    if (!hideZero) return true;
    if (t.isNative) return true;
    const bal = parseFloat(t.balance);
    return Number.isFinite(bal) && bal > 0;
  });

  return (
    <>
      <Header
        status="unlocked"
        chainSwitcher={chainId !== null ? { current: chainId, currentRpcUrl, networks, onSwitch: switchTo } : undefined}
        onSettings={onSettings}
      />

      {/* Yellow tilted hero — total balance in active currency. "much hodl" */}
      <div className="dk-hero">
        <span className="dk-hero-stamp">much hodl</span>
        <div className="dk-hero-eyebrow">total worth, much wow</div>
        <div className="dk-hero-bal" style={{ opacity: allLoaded ? 1 : 0.7 }}>
          {currency === 'doge' ? (
            <>
              {showDogeEgg && (
                <ShitDogeEgg
                  interactive={eggInteractive}
                  onAdded={() => setReloadKey((k) => k + 1)}
                />
              )}
              <span style={{ fontSize: '0.55em', verticalAlign: '0.6em', marginRight: 4 }}>Ð</span>
              {totalDogeStr.replace(/^Ð\s*/, '')}
            </>
          ) : (
            <>
              <span style={{ fontSize: '0.55em', verticalAlign: '0.6em', marginRight: 2 }}>$</span>
              {usdWhole}
              <span className="unit">.{usdCents}</span>
            </>
          )}
        </div>
        <div className="dk-hero-foot">
          <button
            className={'dk-hero-addr' + (copied ? ' is-copied' : '')}
            onClick={copyAddress}
            title="copy address"
          >
            {copied ? 'copied! ✓' : `${shortAddr} ⧉`}
          </button>
        </div>
      </div>

      {/* Action row — send / receive / activity. The third slot used
          to be "explorer" (linked out per-chain); we moved that link
          INSIDE the Activity screen so the dashboard surfaces local
          history first and the explorer is one click further (where
          you'd want it anyway when investigating a specific tx). */}
      <div className="dk-actions" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <button onClick={() => onSend()}>
          <span className="ico">↑</span>
          <span>send</span>
        </button>
        <button onClick={onReceive}>
          <span className="ico">↓</span>
          <span>receive</span>
        </button>
        <button onClick={onActivity}>
          <span className="ico">⌚</span>
          <span>activity</span>
        </button>
      </div>

      {/* Folding-screen tab strip — active tab moves to the front-left,
          extends rightward, and covers the inactive tab's "my " prefix.
          The user reads:
            tokens active → "my tokens" + "NFTs"
            nfts   active → "my NFTs"  + "tokens"
          The hidden "my " on the inactive tab is intentional — implies
          you're switching to "tokens" or "NFTs" specifically, the "my"
          prefix is shared. */}
      <div className="dk-tokens-head">
        <div
          className="dk-assets-tabs"
          role="tablist"
          data-active={activeTab}
          style={{
            width: tabWidths.tokens && tabWidths.nfts && myPrefixPx
              ? (activeTab === 'tokens' ? tabWidths.tokens : tabWidths.nfts) +
                (activeTab === 'tokens' ? tabWidths.nfts : tabWidths.tokens) -
                myPrefixPx
              : undefined,
          }}
        >
          <button
            ref={tokensTabRef}
            role="tab"
            aria-selected={activeTab === 'tokens'}
            className="dk-assets-tab"
            data-tab="tokens"
            onClick={() => setActiveTab('tokens')}
            style={{
              left: tabWidths.tokens && tabWidths.nfts && myPrefixPx
                ? (activeTab === 'tokens' ? 0 : tabWidths.nfts - myPrefixPx)
                : undefined,
            }}
          >
            my tokens
          </button>
          <button
            ref={nftsTabRef}
            role="tab"
            aria-selected={activeTab === 'nfts'}
            className="dk-assets-tab"
            data-tab="nfts"
            onClick={() => setActiveTab('nfts')}
            style={{
              left: tabWidths.tokens && tabWidths.nfts && myPrefixPx
                ? (activeTab === 'nfts' ? 0 : tabWidths.tokens - myPrefixPx)
                : undefined,
            }}
          >
            my NFTs
          </button>
          {/* Hidden width probe — gives offsetWidth = the inactive
              tab's LEFT border (2 px) + left padding (12 px) + font-
              rendered "MY " glyph width. That sum is the exact px
              count we need active to extend INTO the inactive to
              cover its leading "MY " label.
              Styled inline (not via .dk-assets-tab) so right padding
              and right border are explicitly 0 — we only care about
              the left side of the inactive. visibility:hidden +
              pointer-events:none keep it inert; it still occupies
              layout for offsetWidth measurement to work. */}
          <span
            ref={myProbeRef}
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              visibility: 'hidden',
              pointerEvents: 'none',
              fontFamily: 'var(--font-display)',
              textTransform: 'uppercase',
              fontSize: '18px',
              lineHeight: 1,
              paddingLeft: '12px',
              borderLeft: '2px solid #000',
              boxSizing: 'content-box',
              whiteSpace: 'pre',
            }}
          >
            MY{' '}
          </span>
        </div>
        <span className="dk-tokens-meta">
          {activeTab === 'tokens' ? (
            <>
              {visibleTokens.length}{hideZero && tokens && tokens.length > visibleTokens.length ? `/${tokens.length}` : ''} coins
              <button
                className={'dk-tokens-toggle' + (hideZero ? ' is-on' : '')}
                onClick={toggleHideZero}
                title="hide tokens with 0 balance"
                aria-pressed={hideZero}
              >
                {hideZero ? 'hide 0 ✓' : 'hide 0'}
              </button>
            </>
          ) : (
            <>{nfts?.length ?? 0} NFTs</>
          )}
        </span>
      </div>

      {/* Tokens tab — same render as before. */}
      {activeTab === 'tokens' && (tokens === null ? (
        <p className="dk-mono" style={{ fontSize: 12, opacity: 0.55, textAlign: 'center', padding: '12px 0' }}>
          loading…
        </p>
      ) : visibleTokens.length === 0 ? (
        <div className="dk-empty">
          <span className="doge-stamp">such empty</span>
          <h3>no tokens, much sad</h3>
          <p>
            {hideZero
              ? 'all hidden by hide-zero. flip it off in settings, fren.'
              : `no defaults on this chain (id ${chainId ?? '?'}). paste a contract address below to add one, fren.`}
          </p>
        </div>
      ) : (
        <div className="dk-tlist">
          {visibleTokens.map((t) => {
            // Removable rows: user-added ERC-20s. Builtins (USDC/USDT/DAI/WETH
            // on mainnet, USDC on Sepolia) and the synthetic native row are
            // not — their onContextMenu is left undefined so right-clicks
            // are no-ops on those rows. The browser's native context menu
            // is blocked popup-wide by App's `contextmenu` listener, so a
            // right-click on a builtin shows nothing (intentional — these
            // tokens aren't user-managed).
            const removable = !t.builtin && t.address !== 'native';
            return (
              <div
                className="dk-trow"
                key={t.address}
                onClick={(e) => {
                  // Don't open the detail modal when the remove-ctx
                  // pill is the actual click target (mirrors the NFT
                  // card pattern).
                  if ((e.target as HTMLElement).closest('.dk-trow-ctx')) return;
                  setRemoveCtxAddr(null);
                  setPreviewToken(t);
                }}
                onContextMenu={removable ? (e) => {
                  e.preventDefault();
                  // Toggle: same row right-clicked again hides the
                  // pill; different row switches the pill to that row.
                  setRemoveCtxAddr((cur) => (cur === t.address ? null : t.address));
                } : undefined}
              >
                <div className={`dk-tic ${tokenIconClass(t.symbol)}`}>
                  {t.symbol.slice(0, 1)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{t.symbol}</div>
                  <div className="sub">{t.name}</div>
                </div>
                <div className="right">
                  <div className="bal" style={{ opacity: t.loaded ? 1 : 0.5 }}>
                    {Number(t.balance).toLocaleString('en-US', { maximumFractionDigits: 6 })}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      opacity: 0.7,
                      marginTop: 2,
                      textAlign: 'right',
                    }}
                  >
                    {rowUsd(t)}
                  </div>
                </div>
                {removeCtxAddr === t.address && (
                  <div className="dk-trow-ctx">
                    <button
                      type="button"
                      className="dk-trow-ctx-btn"
                      onClick={() => {
                        void removeToken(t.address);
                        setRemoveCtxAddr(null);
                      }}
                    >
                      🗑 remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* NFTs tab — same chain-scoped list, grid layout per card.
          Empty state mirrors the tokens-empty shape. Right-click on a
          card toggles the remove behaviour to be implemented in v2; for
          now the corner ✕ button stays as the only delete affordance
          (NFT cards are visually busy enough that a permanent X is
          fine; reconsider when adding context menus there). */}
      {activeTab === 'nfts' && (nfts === null ? (
        <p className="dk-mono" style={{ fontSize: 12, opacity: 0.55, textAlign: 'center', padding: '12px 0' }}>
          loading…
        </p>
      ) : nfts.length === 0 ? (
        <div className="dk-empty">
          <span className="doge-stamp">such empty</span>
          <h3>no NFTs yet</h3>
          <p>
            paste a contract + tokenId below. metadata is read on-chain.
            no indexer, no tracking.
          </p>
        </div>
      ) : (
        <div className="dk-nft-grid">
          {nfts.map((n) => {
            const key = `${n.address}::${n.tokenId}`;
            return (
              <div
                className="dk-nft-card"
                key={key}
                onClick={(e) => {
                  // Don't fire detail-open when the inner Send button
                  // or remove-ctx pill is the actual click target —
                  // those have their own handlers.
                  if ((e.target as HTMLElement).closest('.dk-nft-send, .dk-nft-ctx')) return;
                  setRemoveCtxNftKey(null);
                  setPreviewNft({ nft: n, view: 'detail' });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Same toggle pattern as token rows — right-click
                  // the same card hides the pill; right-click a
                  // different card switches the pill there.
                  setRemoveCtxNftKey((cur) => (cur === key ? null : key));
                }}
              >
                <div className="thumb">
                  {n.image ? (
                    <NftImage src={n.image} />
                  ) : (
                    <span className="placeholder" aria-hidden>🖼</span>
                  )}
                  <span className="standard">{n.standard === 'ERC721' ? '721' : '1155'}</span>
                </div>
                <div className="meta">
                  <div className="name" title={n.name}>{n.name}</div>
                  <div className="sub dk-mono">
                    #{n.tokenId.length > 10 ? n.tokenId.slice(0, 6) + '…' : n.tokenId}
                    {/* ERC-1155: tack on the owned-count next to the
                        tokenId. ERC-721 is always 1-of-1 so the badge
                        would be noise; null balance means "RPC blip,
                        don't lie to the user". */}
                    {n.standard === 'ERC1155' && n.balance != null && (
                      <span className="dk-nft-count"> · ×{n.balance}</span>
                    )}
                  </div>
                  <button
                    className="dk-nft-send"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemoveCtxNftKey(null);
                      setPreviewNft({ nft: n, view: 'send' });
                    }}
                    aria-label="send NFT"
                  >send ↗</button>
                </div>
                {removeCtxNftKey === key && (
                  <div className="dk-nft-ctx">
                    <button
                      type="button"
                      className="dk-nft-ctx-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeNft(n.address, n.tokenId);
                        setRemoveCtxNftKey(null);
                      }}
                    >
                      🗑 remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {previewNft && (
        <NftDetailModal
          nft={previewNft.nft}
          initialView={previewNft.view}
          address={address}
          onClose={() => setPreviewNft(null)}
          onSent={() => setPreviewNft(null)}
          onBalanceRefreshed={(updated) => {
            setPreviewNft((cur) => cur && { ...cur, nft: updated });
            setNfts((cur) => cur?.map((n) =>
              n.address === updated.address && n.tokenId === updated.tokenId ? updated : n,
            ) ?? cur);
          }}
        />
      )}

      {previewToken && (
        <TokenDetailModal
          token={previewToken}
          currency={currency}
          dogeUsdRate={dogeUsdRate}
          onClose={() => setPreviewToken(null)}
          onSend={(addr) => {
            setPreviewToken(null);
            onSend(addr);
          }}
        />
      )}

      {activeTab === 'tokens' ? (
        <button className="dk-add-strip" onClick={onAddToken}>
          + add token (very custom)
        </button>
      ) : (
        <button className="dk-add-strip" onClick={onAddNft}>
          + add NFT (paste contract + tokenId)
        </button>
      )}

      {/* Floating connection strip — ONLY when the active tab is an
          authorized origin. Surfacing "not connected" for every random page
          is noise; users care that they ARE connected, not that they aren't. */}
      {tabOrigin && isConnected && (
        <>
          <div aria-hidden style={{ height: 50, flexShrink: 0 }} />
          <div className="dk-conn-strip is-on">
            <span className="dot" />
            <span className="host">
              connected · {tabOrigin.replace(/^https?:\/\//, '')}
            </span>
            <button className="disconnect" onClick={disconnectTab}>
              disconnect
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** ERC-721 / ERC-1155 transfer calldata ABIs. `safeTransferFrom` over
 *  the bare `transferFrom` so the recipient contract (if any) gets the
 *  standard onReceived hook — matches what MetaMask / Phantom send. */
const ERC721_TRANSFER_ABI = [{
  type: 'function', name: 'safeTransferFrom', stateMutability: 'nonpayable',
  inputs: [
    { type: 'address', name: 'from' },
    { type: 'address', name: 'to' },
    { type: 'uint256', name: 'tokenId' },
  ],
  outputs: [],
}] as const;
const ERC1155_TRANSFER_ABI = [{
  type: 'function', name: 'safeTransferFrom', stateMutability: 'nonpayable',
  inputs: [
    { type: 'address', name: 'from' },
    { type: 'address', name: 'to' },
    { type: 'uint256', name: 'id' },
    { type: 'uint256', name: 'amount' },
    { type: 'bytes',   name: 'data' },
  ],
  outputs: [],
}] as const;

/** Combined NFT detail + send modal. Two views inside one overlay:
 *    - 'detail': bigger image, name, ERC-1155 balance with refresh,
 *                truncated contract + tokenId (click-to-copy), the
 *                "send …" CTA that flips to 'send' view.
 *    - 'send':   recipient input + amount (1155) + cancel/send buttons.
 *                Cancel returns to 'detail'; successful broadcast fires
 *                onSent which closes the modal.
 *  Esc / backdrop / ✕ close the whole thing regardless of view. */
function NftDetailModal({
  nft,
  initialView,
  address,
  onClose,
  onSent,
  onBalanceRefreshed,
}: {
  nft: NftRecord;
  initialView: 'detail' | 'send';
  address: Address;
  onClose: () => void;
  onSent: () => void;
  onBalanceRefreshed: (updated: NftRecord) => void;
}) {
  const showToast = useToast();
  const [view, setView] = useState<'detail' | 'send'>(initialView);
  const [refreshing, setRefreshing] = useState(false);

  // Send-view state — defaults to "send 1 of <tokenId>". Reset when
  // the modal opens fresh (initialView change = different NFT picked).
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const validRecipient = /^0x[0-9a-fA-F]{40}$/.test(recipient.trim());
  const isErc1155 = nft.standard === 'ERC1155';
  const amountNum = isErc1155 ? Number(amount) : 1;
  const validAmount = isErc1155
    ? Number.isFinite(amountNum) && amountNum > 0 && Number.isInteger(amountNum)
    : true;
  const ok = validRecipient && validAmount && !busy;

  // Esc closes the modal but is suppressed during a broadcast — the
  // user shouldn't be able to abort the modal mid-sign and lose the
  // success toast / status update.
  useEscapeKey(onClose, !busy);

  const shortAddr = truncateAddr;
  const copyText = useCopyToClipboard();

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const updated = await send<NftRecord | null>({
        kind: 'refresh-nft-balance', address: nft.address, tokenId: nft.tokenId,
      });
      if (updated) onBalanceRefreshed(updated);
    } catch (e) {
      showToast({ tone: 'red', icon: '⚠', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRefreshing(false);
    }
  }

  async function broadcast() {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const data = isErc1155
        ? encodeFunctionData({
            abi: ERC1155_TRANSFER_ABI,
            functionName: 'safeTransferFrom',
            args: [
              address,
              recipient.trim() as Address,
              BigInt(nft.tokenId),
              BigInt(amountNum),
              '0x' as `0x${string}`,
            ],
          })
        : encodeFunctionData({
            abi: ERC721_TRANSFER_ABI,
            functionName: 'safeTransferFrom',
            args: [
              address,
              recipient.trim() as Address,
              BigInt(nft.tokenId),
            ],
          });
      const hash = await send<`0x${string}`>({
        kind: 'popup-send',
        tx: { to: nft.address as Address, data, value: '0x0' },
        gasTier: 'normal',
      });
      showToast({ tone: 'green', icon: '🐕', text: `sent! tx ${hash.slice(0, 10)}…` });
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      showToast({ tone: 'red', icon: '⚠', text: msg.slice(0, 100) });
      setBusy(false);
    }
  }

  return (
    <div className="dk-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="dk-modal" onClick={(e) => e.stopPropagation()}>
        {!busy && <button className="dk-modal-close" onClick={onClose} aria-label="close">✕</button>}
        <div className="dk-modal-thumb">
          {nft.image
            ? <NftImage src={nft.image} />
            : <span className="placeholder" aria-hidden>🖼</span>}
        </div>
        <h3 className="dk-modal-title" title={nft.name}>{nft.name}</h3>
        {isErc1155 && (
          <div className="dk-modal-balance">
            <span className="lbl">you own</span>
            <span className="val">× {nft.balance ?? '—'}</span>
            {view === 'detail' && (
              <button
                type="button"
                className="dk-modal-refresh"
                onClick={refresh}
                disabled={refreshing}
                title="re-read balanceOf"
              >{refreshing ? '…' : '↻'}</button>
            )}
          </div>
        )}

        {view === 'detail' ? (
          <>
            <dl className="dk-modal-kv">
              <dt>contract</dt>
              <dd>
                <span
                  className="dk-modal-addr"
                  onClick={() => copyText(nft.address, 'contract')}
                  title="copy full address"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void copyText(nft.address, 'contract');
                    }
                  }}
                >
                  <code className="dk-mono">{shortAddr(nft.address)}</code>
                  <span className="dk-modal-copy-icon" aria-hidden> ⧉</span>
                </span>
              </dd>
              <dt>tokenId</dt>
              <dd>
                <code
                  className="dk-mono"
                  onClick={() => copyText(nft.tokenId, 'tokenId')}
                  title="copy tokenId"
                >{nft.tokenId}</code>
              </dd>
              <dt>standard</dt>
              <dd><code className="dk-mono">{nft.standard}</code></dd>
            </dl>
            <button className="dk-cta-primary" onClick={() => setView('send')}>
              send {isErc1155 ? 'tokens' : 'NFT'} ↗
            </button>
          </>
        ) : (
          <>
            <label className="dk-label">recipient address</label>
            <input
              className="dk-input"
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setErr(null); }}
              placeholder="0x…"
              autoFocus
              disabled={busy}
            />
            {isErc1155 && (
              <>
                <label className="dk-label" style={{ marginTop: 10 }}>amount</label>
                <input
                  className="dk-input"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setErr(null); }}
                  placeholder="1"
                  disabled={busy}
                  inputMode="numeric"
                />
                <p className="dk-mono" style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>
                  ERC-1155 is semi-fungible — pick how many of this id to send.
                </p>
              </>
            )}
            {err && <div className="dk-alert dk-alert-danger" style={{ marginTop: 10 }}>{err}</div>}
            <div className="dk-btn-row" style={{ marginTop: 12 }}>
              <button
                className="dk-btn dk-btn-ghost"
                onClick={() => { setView('detail'); setErr(null); }}
                disabled={busy}
              >cancel</button>
              <button
                className="dk-btn"
                onClick={broadcast}
                disabled={!ok}
                style={{ flex: 1 }}
              >{busy ? 'broadcasting…' : 'send it 🐕'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Token detail overlay. Same modal scheme as NftDetailModal (cream
 *  card, backdrop, ✕ close, Esc handler) but content tailored to ERC-
 *  20 / native rows: big icon glyph, symbol + name, balance prominently
 *  with the active-currency value, contract address truncated +
 *  click-to-copy (native rows skip the contract row entirely),
 *  decimals + standard tags, and a Send CTA that closes the modal and
 *  navigates to SendScreen pre-selected on this token. */
function TokenDetailModal({
  token, currency, dogeUsdRate, onClose, onSend,
}: {
  token: TokenRow;
  currency: 'doge' | 'usd';
  dogeUsdRate: number | null;
  onClose: () => void;
  onSend: (tokenAddress: string) => void;
}) {
  useEscapeKey(onClose);
  const shortAddr = truncateAddr;
  const copyText = useCopyToClipboard();

  const isNative = token.isNative ?? token.address === 'native';
  const balanceNum = Number(token.balance);
  const balanceDisplay = Number.isFinite(balanceNum)
    ? balanceNum.toLocaleString('en-US', { maximumFractionDigits: 8 })
    : token.balance;
  const valueLine = token.priceUsd != null && Number.isFinite(balanceNum)
    ? formatCurrency(balanceNum * token.priceUsd, currency, dogeUsdRate)
    : null;

  return (
    <div className="dk-modal-backdrop" onClick={onClose}>
      <div className="dk-modal" onClick={(e) => e.stopPropagation()}>
        <button className="dk-modal-close" onClick={onClose} aria-label="close">✕</button>
        <div className={`dk-tic dk-modal-token-icon ${tokenIconClass(token.symbol)}`}>
          {token.symbol.slice(0, 1)}
        </div>
        <h3 className="dk-modal-title" title={token.name}>{token.symbol}</h3>
        <div className="dk-mono" style={{ fontSize: 12, opacity: 0.7, marginTop: -6 }}>{token.name}</div>
        <div className="dk-modal-balance">
          <span className="lbl">balance</span>
          <span className="val">{balanceDisplay} {token.symbol}</span>
        </div>
        {valueLine && (
          <div className="dk-mono" style={{ fontSize: 12, opacity: 0.8, marginTop: -4 }}>
            ≈ {valueLine}
          </div>
        )}
        <dl className="dk-modal-kv">
          {!isNative && (
            <>
              <dt>contract</dt>
              <dd>
                <span
                  className="dk-modal-addr"
                  onClick={() => copyText(token.address, 'contract')}
                  title="copy full address"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void copyText(token.address, 'contract');
                    }
                  }}
                >
                  <code className="dk-mono">{shortAddr(token.address)}</code>
                  <span className="dk-modal-copy-icon" aria-hidden> ⧉</span>
                </span>
              </dd>
            </>
          )}
          <dt>decimals</dt>
          <dd><code className="dk-mono">{token.decimals}</code></dd>
          <dt>standard</dt>
          <dd><code className="dk-mono">{isNative ? 'Native' : 'ERC-20'}</code></dd>
        </dl>
        <button className="dk-cta-primary" onClick={() => onSend(token.address)}>
          send {token.symbol} ↗
        </button>
      </div>
    </div>
  );
}

export function AddToken({ onDone }: { onDone: () => void }) {
  const showToast = useToast();
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; symbol: string; decimals: number } | null>(null);

  const valid = /^0x[0-9a-fA-F]{40}$/.test(addr.trim());

  async function importToken() {
    setBusy(true); setErr(null); setPreview(null);
    try {
      const meta = await send<{ name: string; symbol: string; decimals: number }>({
        kind: 'add-token',
        address: addr.trim(),
      });
      setPreview(meta);
      showToast({ tone: 'green', icon: '🐕', text: `${meta.symbol} imported. much wow.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      showToast({ tone: 'red', icon: '⚠', text: msg.slice(0, 90) });
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <>
      <Header status="unlocked" onBack={busy ? undefined : onDone} />
      <div className="dk-card">
        <h2 className="dk-card-title">add token</h2>
        <p className="dk-mono" style={{ fontSize: 11, opacity: 0.6, marginTop: 0, marginBottom: 8 }}>
          paste an ERC-20 contract address. metadata is read straight from the chain.
        </p>
        <label className="dk-label">contract address</label>
        <input
          className="dk-input"
          value={addr}
          onChange={(e) => { setAddr(e.target.value); setPreview(null); setErr(null); }}
          placeholder="0x…"
          autoFocus
          disabled={busy}
        />
        {err && <div className="dk-alert dk-alert-danger" style={{ marginTop: 10 }}>{err}</div>}
        {preview && (
          <div className="dk-alert dk-alert-info" style={{ marginTop: 10 }}>
            ✓ added <b>{preview.symbol}</b> — {preview.name} (decimals {preview.decimals})
          </div>
        )}
        <div className="dk-btn-row" style={{ marginTop: 12 }}>
          <button className="dk-btn dk-btn-ghost" onClick={onDone} disabled={busy}>
            {preview ? 'done' : 'cancel'}
          </button>
          <button
            className="dk-btn"
            onClick={importToken}
            disabled={!valid || busy || !!preview}
            style={{ flex: 1 }}
          >
            {busy ? 'reading chain…' : preview ? 'imported' : 'import'}
          </button>
        </div>
      </div>
    </>
  );
}

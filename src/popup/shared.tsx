// Cross-screen primitives extracted from popup.tsx during the modularisation
// pass. Three things live here, in order of how often they're used:
//
//   send()             — promise-wrapped chrome.runtime.sendMessage with the
//                         project's FromBackground/ToBackground envelope. Used
//                         by every screen that talks to the SW.
//   useToast / Toast   — the shared yellow/green/red toast (App provides the
//                         context; screens consume via useToast).
//   AccountGlyph       — deterministic SVG avatar derived from a 0x address.
//                         Used in the dashboard, account picker, sign confirm.
//
// No behaviour change in this file vs. the inline definitions it replaced.

import { createContext, useContext } from 'react';
import type { FromBackground, ToBackground } from '../shared/protocol';

export type TokenMeta = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** True for builtins (USDC/USDT/DAI on mainnet). UI hides the remove button
   *  on these — they're considered part of the chain's default token set. */
  builtin: boolean;
  /** True only on the synthetic native row (ETH on mainnet, BNB on BSC etc.)
   *  Dashboard puts this row first and uses `getBalance` instead of `balanceOf`. */
  isNative?: boolean;
};

/** Token row with a defaulted balance string. Dashboard pre-fills every row
 *  with `balance: '0'` so users see a concrete number instantly; once the
 *  RPC read lands the real value overwrites. `loaded` tracks whether we've
 *  had at least one successful balance read for this row, used only for a
 *  subtle "not yet confirmed" visual hint. */
export type TokenRow = TokenMeta & {
  balance: string;
  loaded: boolean;
  /** USD price per unit, or null if no price feed for this token/chain. */
  priceUsd: number | null;
};

export async function send<R = unknown>(msg: ToBackground): Promise<R> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp: FromBackground) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp.ok) return reject(new Error(resp.error));
      resolve(resp.data as R);
    });
  });
}

export type ToastTone = 'yellow' | 'green' | 'red';
export type ToastInput = { tone?: ToastTone; icon?: string; text: string };
export type ToastFn = (t: ToastInput) => void;

export const ToastContext = createContext<ToastFn>(() => {});
export function useToast(): ToastFn { return useContext(ToastContext); }

/** Deterministic Doge-pile avatar for an EVM address. Combines a fixed
 *  silhouette path (the brand pile, identical to the shape in
 *  public/icons/*.png) with body color, eye style, and mouth varied
 *  per wallet address.
 *  ~100 unique combos. Always reads as a member of the Dogeshit family
 *  because the silhouette + 5 px ink outline stay constant; only the
 *  face/colour change. */
export function AccountGlyph({ address, size = 32, className }: { address: string; size?: number; className?: string }) {
  const seed = address.toLowerCase();
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;

  // Body colour — cluster of doge-meme browns + DogeKit accents. Always
  // distinct enough from the ink outline to read at 32 px.
  const bodyColors = ['#7A5028', '#A06030', '#FFD93D', '#6BCB77', '#FF4D4D'];
  const body = bodyColors[h % bodyColors.length]!;

  const eyeStyle   = (h >> 5) % 4;  // 0 dots, 1 closed (^^), 2 X, 3 wide
  const mouthStyle = (h >> 11) % 5; // 0 smile, 1 smug, 2 O, 3 tongue, 4 flat

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      {/* Pile silhouette — identical to the brand icon */}
      <path
        d="M 18 100 Q 18 88, 30 86 Q 28 72, 44 68 Q 42 54, 60 50 Q 58 36, 76 34 Q 74 22, 88 22 Q 92 22, 90 28 Q 96 26, 96 36 Q 102 40, 96 48 Q 102 56, 92 60 Q 100 68, 86 72 Q 94 82, 78 84 Q 84 96, 66 96 Q 70 104, 54 102 L 22 102 Z"
        fill={body}
        stroke="#000"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      {/* Swirl ridges */}
      <g fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round">
        <path d="M 34 86 Q 40 78, 52 80" />
        <path d="M 52 68 Q 58 62, 70 64" />
        <path d="M 70 52 Q 76 46, 86 48" />
      </g>

      {/* Eyes */}
      {eyeStyle === 0 && (
        <>
          <circle cx="78" cy="44" r="3.6" fill="#000" />
          <circle cx="90" cy="44" r="3.6" fill="#000" />
          <circle cx="78.7" cy="43.1" r="1.3" fill="#fff" />
          <circle cx="90.7" cy="43.1" r="1.3" fill="#fff" />
        </>
      )}
      {eyeStyle === 1 && (
        <>
          <path d="M 74 44 Q 78 40, 82 44" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 86 44 Q 90 40, 94 44" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {eyeStyle === 2 && (
        <g stroke="#000" strokeWidth="2" strokeLinecap="round">
          <path d="M 75 41 L 81 47 M 81 41 L 75 47" />
          <path d="M 87 41 L 93 47 M 93 41 L 87 47" />
        </g>
      )}
      {eyeStyle === 3 && (
        <>
          <circle cx="78" cy="44" r="4.5" fill="#fff" stroke="#000" strokeWidth="1.5" />
          <circle cx="90" cy="44" r="4.5" fill="#fff" stroke="#000" strokeWidth="1.5" />
          <circle cx="78" cy="44" r="2" fill="#000" />
          <circle cx="90" cy="44" r="2" fill="#000" />
        </>
      )}

      {/* Mouth */}
      {mouthStyle === 0 && (
        <path d="M 76 56 Q 84 62, 92 56" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" />
      )}
      {mouthStyle === 1 && (
        <path d="M 76 58 Q 84 54, 92 58" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" />
      )}
      {mouthStyle === 2 && <ellipse cx="84" cy="58" rx="3.5" ry="4.5" fill="#000" />}
      {mouthStyle === 3 && (
        <>
          <path d="M 76 56 Q 84 62, 92 56" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" />
          <path d="M 82 60 Q 84 66, 87 61" fill="#FF4D4D" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" />
        </>
      )}
      {mouthStyle === 4 && (
        <path d="M 76 58 L 92 58" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" />
      )}
    </svg>
  );
}

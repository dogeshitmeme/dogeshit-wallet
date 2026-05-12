// Security engine — composable rules that examine a sign-confirm
// request and emit Signals. Each rule is a pure function of
// (request, context); the engine runs them all and returns the
// collected output.
//
// Architectural inspiration: Rabby's `@rabby-wallet/rabby-security-
// engine` package. The bundle of small, single-purpose checks plus
// a stable Signal shape makes adding new defenses cheap — a future
// rule (e.g. recursive multicall analysis, fresh-EOA-receiver
// blocking, token-decimal-mismatch) becomes one file in this
// module, not another nested `if` in sign-confirm.tsx.
//
// Backwards compatibility: the legacy `isDangerous` / `inconsistencies`
// exports in `risk.ts` now delegate to this engine — same input
// shape, same output shape, so sign-confirm.tsx and the existing
// risk.test.ts tests need no changes. Future UI work can read the
// engine's full `Signal[]` directly for a richer checks panel.

import type { Address } from 'viem';
import type { PendingRequest } from '../shared/protocol';
import {
  decodeMulticallInner,
  decodeTxData,
  getRawTypes,
  isStandardERC2612Permit,
  isStandardPermit2Single,
  isStandardPermit2Batch,
  MULTICALL_NAMES,
  parseTyped,
  type DecodedTx,
} from './decoders';
import { unpackTypedDataParams } from './validators';

/** Severity ladder. `danger` carries the strongest UI weight (red
 *  banner + ack-checkbox gate); `warning` is a yellow chip; `info`
 *  is neutral; `safe` is the explicit positive ("verified on
 *  Sourcify" etc — future use). */
export type Severity = 'safe' | 'info' | 'warning' | 'danger';

export type Signal = {
  /** Stable identifier — `permit-unlimited`, `signer-mismatch`, etc.
   *  Used by tests + future UI for dismissals / filtering. */
  id: string;
  severity: Severity;
  message: string;
  /** At most one primary signal per request determines the red/yellow
   *  banner at the top of the sign-confirm screen. The engine picks
   *  the highest-severity primary; ties prefer the rule registered
   *  first in `RULES`. Non-primary signals render as inline chips. */
  primary?: boolean;
  /** When true, the user must tick the "I understand the risk"
   *  checkbox before the approve button enables. Currently only set
   *  on `severity: 'danger'` primary signals. */
  requiresAck?: boolean;
  /** Hide this signal from the SecurityChecks panel. Used when the
   *  sign-confirm body already renders a dedicated banner with the
   *  same content (e.g. the dk-big-banner for EIP-7702). The rule
   *  still emits so `requiresAck` / `danger.level` machinery work,
   *  but the message doesn't double-render. */
  silent?: boolean;
};

export type SecurityContext = {
  /** The wallet's currently-active account address. Compared against
   *  signer-mismatch checks. */
  address: Address;
  /** The wallet's currently-active chainId. Compared against the
   *  request's claimed chainId (typed-data domain / 7702 auth). */
  chainId: number;
};

export type SecurityRule = {
  id: string;
  /** Pure function — must not touch chrome.* / DOM / fetch. Returns a
   *  Signal when the rule fires, null otherwise. */
  evaluate(req: PendingRequest, ctx: SecurityContext): Signal | null;
};

// ─── Rules ────────────────────────────────────────────────────────────────

const ruleSeven702Delegation: SecurityRule = {
  id: 'seven702-delegation',
  evaluate(req) {
    if (req.payload.method !== 'wallet_signAuthorization') return null;
    return {
      id: 'seven702-delegation',
      severity: 'danger',
      message:
        'EIP-7702 delegation hands smart-contract code over your EOA. The delegate can move every token in this wallet. Verify you trust the delegate address.',
      primary: true,
      requiresAck: true,
      // Hidden from the SecurityChecks panel — the SevenSevenZeroTwoBody
      // renders a dedicated dk-big-banner with the same content (plus
      // the brand tldr line). Without `silent`, the user saw the
      // warning twice: once as a red SecurityChecks row, once as the
      // yellow big-banner below.
      silent: true,
    };
  },
};

const rulePermit: SecurityRule = {
  id: 'permit',
  evaluate(req) {
    const m = req.payload.method;
    if (
      m !== 'eth_signTypedData_v4' &&
      m !== 'eth_signTypedData' &&
      m !== 'eth_signTypedData_v1'
    ) return null;

    const { data } = unpackTypedDataParams(req.payload.params);
    const td = parseTyped(data);
    const rawTypes = getRawTypes(data);

    // Strict canonical-shape gate — see comments in legacy
    // risk.ts for the reasoning behind the 3 spec matches.
    const isCanonicalPermit =
      (td?.primaryType === 'Permit' && isStandardERC2612Permit(rawTypes)) ||
      (td?.primaryType === 'PermitSingle' && isStandardPermit2Single(rawTypes)) ||
      (td?.primaryType === 'PermitBatch' && isStandardPermit2Batch(rawTypes));

    if (isCanonicalPermit) {
      const v =
        (td!.message as { value?: string; details?: { amount?: string }[] }).value
        ?? (td!.message as { details?: { amount?: string }[] }).details?.[0]?.amount;
      if (v && /^0x[fF]+$/.test(String(v))) {
        return {
          id: 'permit-unlimited',
          severity: 'danger',
          message:
            'Permit grants UNLIMITED token allowance to a third party. Only sign if you trust this site fully.',
          primary: true,
          requiresAck: true,
        };
      }
      return {
        id: 'permit',
        severity: 'warning',
        message: 'Permit grants token allowance off-chain. Verify the spender address.',
        primary: true,
      };
    }

    // Non-canonical struct using Permit/PermitSingle/PermitBatch name —
    // strongest phishing tell. A custom contract might verify it; the
    // standard ones won't.
    if (
      td?.primaryType === 'Permit' ||
      td?.primaryType === 'PermitSingle' ||
      td?.primaryType === 'PermitBatch'
    ) {
      return {
        id: 'permit-non-canonical',
        severity: 'danger',
        message:
          `non-standard ${td.primaryType} — fields don't match the spec (different order or types). standard contracts won't verify this; a custom contract might. high phishing risk.`,
        primary: true,
        requiresAck: true,
      };
    }

    return null;
  },
};

const ruleSafeTxDelegateCall: SecurityRule = {
  id: 'safetx-delegatecall',
  evaluate(req) {
    const m = req.payload.method;
    if (
      m !== 'eth_signTypedData_v4' &&
      m !== 'eth_signTypedData' &&
      m !== 'eth_signTypedData_v1'
    ) return null;
    const { data } = unpackTypedDataParams(req.payload.params);
    const td = parseTyped(data);
    if (td?.primaryType !== 'SafeTx') return null;
    const op = (td.message as { operation?: number | string }).operation;
    if (op !== 1 && op !== '1' && op !== '0x1') return null;
    return {
      id: 'safetx-delegatecall',
      severity: 'danger',
      message:
        'SafeTx with DELEGATECALL. The target contract becomes the Safe — it can move every Safe asset. Verify the Safe and target are exactly what you expect.',
      primary: true,
      requiresAck: true,
    };
  },
};

const ruleSignerMismatch: SecurityRule = {
  id: 'signer-mismatch',
  evaluate(req, ctx) {
    const m = req.payload.method;
    let signer: unknown = undefined;
    if (m === 'personal_sign') {
      const params = req.payload.params as [string, string];
      signer = params?.[1];
    } else if (
      m === 'eth_signTypedData_v4' ||
      m === 'eth_signTypedData' ||
      m === 'eth_signTypedData_v1'
    ) {
      signer = unpackTypedDataParams(req.payload.params).signer;
    } else {
      return null;
    }
    if (typeof signer !== 'string') return null;
    if (signer.toLowerCase() === ctx.address.toLowerCase()) return null;
    return {
      id: 'signer-mismatch',
      severity: 'warning',
      message:
        `signer ${signer.slice(0, 8)}…${signer.slice(-4)} ≠ active ${ctx.address.slice(0, 8)}…${ctx.address.slice(-4)}`,
    };
  },
};

const ruleTypedChainMismatch: SecurityRule = {
  id: 'typed-chain-mismatch',
  evaluate(req, ctx) {
    const m = req.payload.method;
    if (
      m !== 'eth_signTypedData_v4' &&
      m !== 'eth_signTypedData' &&
      m !== 'eth_signTypedData_v1'
    ) return null;
    const { data } = unpackTypedDataParams(req.payload.params);
    const td = parseTyped(data);
    if (!td?.domain) return null;
    const cid = (td.domain as { chainId?: number | string }).chainId;
    if (cid === undefined || Number(cid) === ctx.chainId) return null;
    return {
      id: 'typed-chain-mismatch',
      severity: 'warning',
      message: `message chainId ${cid} ≠ wallet chainId ${ctx.chainId}`,
    };
  },
};

const ruleDeadlineExpired: SecurityRule = {
  id: 'deadline-expired',
  evaluate(req) {
    const m = req.payload.method;
    if (
      m !== 'eth_signTypedData_v4' &&
      m !== 'eth_signTypedData' &&
      m !== 'eth_signTypedData_v1'
    ) return null;
    const { data } = unpackTypedDataParams(req.payload.params);
    const td = parseTyped(data);
    if (!td?.message) return null;
    const m2 = td.message as { deadline?: string | number; sigDeadline?: string | number };
    const dl = m2.deadline ?? m2.sigDeadline;
    if (dl === undefined || dl === '' || dl === '0' || dl === 0) return null;
    try {
      const sec = Number(BigInt(dl as string | number));
      if (sec > 0 && sec * 1000 < Date.now()) {
        return {
          id: 'deadline-expired',
          severity: 'warning',
          message: 'deadline already expired — signature is wasted',
        };
      }
    } catch { /* unparseable */ }
    return null;
  },
};

const rule7702ChainMismatch: SecurityRule = {
  id: 'auth-chain-mismatch',
  evaluate(req, ctx) {
    if (req.payload.method !== 'wallet_signAuthorization') return null;
    const params = req.payload.params as [{ chainId: string }];
    const reqChain = params?.[0]?.chainId ? parseInt(params[0].chainId, 16) : NaN;
    if (!Number.isFinite(reqChain) || reqChain === ctx.chainId) return null;
    // High severity → wallet's 7702 gate hard-blocks the slide
    // regardless of Sourcify result. A delegation signed for chain
    // A and submitted on chain B is meaningless (auth.chainId is
    // part of the EIP-7702 sig payload); even with a clean Sourcify
    // verdict on the delegate's source, broadcasting this gets the
    // user nothing they intended.
    return {
      id: 'auth-chain-mismatch',
      severity: 'danger',
      message: `auth chainId ${reqChain} ≠ wallet chainId ${ctx.chainId}`,
    };
  },
};

// ─── Multicall recursive risk analysis ────────────────────────────────────
// The decoder labels `multicall(bytes[])` and `aggregate3(...)` as "known"
// — but the wallet has no idea what the INNER calls do. A phishing
// contract can pack any selector into the bytes[] (approve attacker,
// transferFrom from user, setApprovalForAll, etc.) and the user sees
// only "fn: multicall" in the legacy summary.
//
// This rule walks the inner calls (up to MAX_DEPTH to bound any nested-
// multicall griefing) and flags four high-risk patterns:
//   1. approve(spender, max uint256)            — drain-everything allowance
//   2. transferFrom(user, _, _)                  — direct theft from caller
//   3. setApprovalForAll(operator, true)         — NFT collection takeover
//   4. nested multicall beyond depth 1           — deliberate decoder evasion
//
// All four collapse to the same Signal because the user's UX choice
// is the same ("don't sign"). Detail goes into the message so the
// user can see *which* pattern fired.
//
// Limitations (intentional):
//   • We can't distinguish `delegatecall` vs `call` from calldata
//     alone, so true Uniswap V3 multicalls (which delegatecall back
//     into the router) trigger false positives on any approve they
//     wrap. The "verify the destination address" line in the body
//     remains the user's primary defence; this rule is a SECOND
//     check, not a sole gatekeeper.
//   • Universal Router's `execute(bytes commands, bytes[] inputs)`
//     uses a packed-byte command opcode scheme not covered by
//     selector matching. Adding it would require an opcode-by-opcode
//     decoder — separate work, future rule.

const MULTICALL_MAX_DEPTH = 3;
const UINT256_MAX_MINUS_1000 = (1n << 256n) - 1000n;

/** Try to read the first arg as an address. Returns null if not a
 *  parseable hex string. */
function asAddrLower(v: unknown): string | null {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null;
}

/** Try to read an arg as an uint256-shape bigint. */
function asBigInt(v: unknown): bigint | null {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    if (typeof v === 'string' && v.length > 0) return BigInt(v);
  } catch { /* fallthrough */ }
  return null;
}

/** Recursively walk a multicall-style decoded call and return any
 *  danger findings. Stops at depth limit. */
function findMulticallDangers(
  decoded: DecodedTx,
  userAddrLower: string,
  depth: number,
): string[] {
  const out: string[] = [];
  if (decoded.kind !== 'known') return out;

  // Direct danger patterns at this level.
  const args = decoded.args;
  if (decoded.name === 'approve' && args.length >= 2) {
    const amount = asBigInt(args[1]);
    const spender = asAddrLower(args[0]);
    if (amount !== null && amount >= UINT256_MAX_MINUS_1000) {
      out.push(`inner UNLIMITED approve → ${spender ?? '?'}`);
    }
  }
  if (decoded.name === 'transferFrom' && args.length >= 3) {
    const from = asAddrLower(args[0]);
    if (from && from === userAddrLower) {
      const to = asAddrLower(args[1]);
      out.push(`inner transferFrom — pulls from your wallet → ${to ?? '?'}`);
    }
  }
  if (decoded.name === 'setApprovalForAll' && args.length >= 2) {
    if (args[1] === true) {
      const op = asAddrLower(args[0]);
      out.push(`inner setApprovalForAll(true) — NFT operator → ${op ?? '?'}`);
    }
  }

  // Recurse into nested wrappers — guard depth to prevent
  // pathologically deep nesting from spinning forever.
  if (MULTICALL_NAMES.has(decoded.name)) {
    if (depth >= MULTICALL_MAX_DEPTH) {
      out.push(`nested multicall depth > ${MULTICALL_MAX_DEPTH} — suspicious`);
      return out;
    }
    const inner = decodeMulticallInner(decoded);
    if (inner) {
      for (const child of inner) {
        out.push(...findMulticallDangers(child, userAddrLower, depth + 1));
      }
    }
  }

  return out;
}

const ruleMulticallRisk: SecurityRule = {
  id: 'multicall-risk',
  evaluate(req, ctx) {
    if (req.payload.method !== 'eth_sendTransaction') return null;
    const p = (req.payload.params as [{ to?: string; data?: string }])[0];
    if (!p?.data) return null;
    const decoded = decodeTxData(p.data);
    if (decoded.kind !== 'known' || !MULTICALL_NAMES.has(decoded.name)) return null;

    const findings = findMulticallDangers(decoded, ctx.address.toLowerCase(), 0);
    if (findings.length === 0) return null;

    return {
      id: 'multicall-risk',
      severity: 'danger',
      message:
        `batched call contains ${findings.length} high-risk inner operation${findings.length === 1 ? '' : 's'}: ${findings.join('; ')}. ` +
        `the destination contract's actual behaviour decides whether these execute — verify the address is one you trust.`,
      primary: true,
      requiresAck: true,
    };
  },
};

/** Registered rules — order matters for primary-signal tiebreaks
 *  (engine picks the first highest-severity primary signal). */
export const RULES: readonly SecurityRule[] = [
  ruleSeven702Delegation,
  rulePermit,
  ruleSafeTxDelegateCall,
  ruleMulticallRisk,
  ruleSignerMismatch,
  ruleTypedChainMismatch,
  ruleDeadlineExpired,
  rule7702ChainMismatch,
];

/** Run every rule against the request. Returns the union of all
 *  fired Signals; caller can filter by severity / primary as needed. */
export function runEngine(req: PendingRequest, ctx: SecurityContext): Signal[] {
  const out: Signal[] = [];
  for (const r of RULES) {
    const s = r.evaluate(req, ctx);
    if (s) out.push(s);
  }
  return out;
}

/** Picks the highest-severity primary signal from a run, or null if
 *  none fired. The legacy `isDangerous()` shim uses this to keep the
 *  old red/yellow banner contract. */
export function primarySignal(signals: readonly Signal[]): Signal | null {
  const order: Record<Severity, number> = { danger: 3, warning: 2, info: 1, safe: 0 };
  let best: Signal | null = null;
  for (const s of signals) {
    if (!s.primary) continue;
    if (!best || order[s.severity] > order[best.severity]) best = s;
  }
  return best;
}

// Developer settings — own screen (was an inline card in Settings). Each
// toggle is opt-in and persisted in DevFlags. Currently:
//
//   rpcTrace                  — log every dapp RPC to the SW console.
//   allowUnverifiedDelegate   — bypass the EIP-7702 Sourcify gate.
//                                Marked red + double-confirm to flip ON.
//                                Flipping OFF is a single click (back to
//                                the safe default — no confirmation
//                                needed to restore safety).
//
// Layout mirrors AccountsScreen: own Header with onBack, list of rows
// below. Settings reaches this via a "developer ›" link row in the
// security card; the inline `dk-set-card` developer block was removed.

import { useEffect, useState } from 'react';
import { Header } from '../components/header';
import { send, useToast } from '../shared';

type DevFlagsView = {
  rpcTrace: boolean;
  allowUnverifiedDelegate: boolean;
};

export function DevSettingsScreen({ onBack }: { onBack: () => void }) {
  const showToast = useToast();
  const [flags, setFlags] = useState<DevFlagsView>({
    rpcTrace: false,
    allowUnverifiedDelegate: false,
  });
  // Two-stage confirm state for the dangerous override. 'closed' is
  // collapsed; 'open' shows the red warning strip + "yes, enable" CTA.
  // Toggling OFF skips this entirely (back to safe default).
  const [overrideConfirm, setOverrideConfirm] = useState<'closed' | 'open'>('closed');

  useEffect(() => {
    void (async () => {
      try {
        const f = await send<Partial<DevFlagsView>>({ kind: 'get-dev-flags' });
        setFlags({
          rpcTrace: !!f.rpcTrace,
          allowUnverifiedDelegate: !!f.allowUnverifiedDelegate,
        });
      } catch { /* keep defaults */ }
    })();
  }, []);

  async function setFlag(key: keyof DevFlagsView, value: boolean) {
    try {
      await send({ kind: 'set-dev-flag', key, value });
      setFlags((cur) => ({ ...cur, [key]: value }));
    } catch (e) {
      showToast({
        tone: 'red', icon: '⚠',
        text: (e instanceof Error ? e.message : String(e)).slice(0, 90),
      });
    }
  }

  async function toggleRpcTrace() {
    await setFlag('rpcTrace', !flags.rpcTrace);
  }

  function onClickOverride() {
    if (flags.allowUnverifiedDelegate) {
      // Currently ON → one-tap turn off (restoring safe default needs
      // no confirmation, only enabling does).
      void setFlag('allowUnverifiedDelegate', false);
      setOverrideConfirm('closed');
      return;
    }
    // Currently OFF → open the confirmation strip on first click.
    setOverrideConfirm('open');
  }

  async function confirmOverride() {
    await setFlag('allowUnverifiedDelegate', true);
    setOverrideConfirm('closed');
    showToast({
      tone: 'red', icon: '🚨',
      text: 'unverified delegate override ON. you are accepting full risk.',
    });
  }

  return (
    <>
      <Header status="unlocked" onBack={onBack} label="developer" caption="opt-in toggles, no warranty" />

      {/* RPC trace — neutral toggle. */}
      <div className="dk-set-card">
        <h4>diagnostics</h4>
        <div
          className="dk-set-row is-clickable"
          onClick={toggleRpcTrace}
          style={{ background: flags.rpcTrace ? 'var(--cream)' : undefined }}
        >
          <span className="ico">🔍</span>
          <span className="label">
            rpc trace
            <span className="dk-mono" style={{ display: 'block', fontSize: 10, opacity: 0.55, marginTop: 2 }}>
              log every dapp call to SW console
            </span>
          </span>
          <span className="val">{flags.rpcTrace ? 'ON' : 'off'}</span>
        </div>
      </div>

      {/* Danger override — red styling, two-stage confirm. */}
      <div className="dk-set-card">
        <h4 style={{ background: 'var(--alarm-red)', color: 'var(--white)' }}>
          danger overrides, much risk
        </h4>
        <div
          className={'dk-set-row is-clickable is-danger' + (flags.allowUnverifiedDelegate ? ' is-on' : '')}
          onClick={onClickOverride}
        >
          <span className="ico">🚨</span>
          <span className="label" style={{ color: flags.allowUnverifiedDelegate ? 'var(--alarm-red)' : undefined }}>
            allow unverified 7702 delegate
            <span className="dk-mono" style={{ display: 'block', fontSize: 10, opacity: 0.65, marginTop: 2 }}>
              bypass the Sourcify open-source check before signing.
              session-only — resets on lock.
            </span>
          </span>
          <span className="val" style={{ color: flags.allowUnverifiedDelegate ? 'var(--alarm-red)' : undefined }}>
            {flags.allowUnverifiedDelegate ? 'ON 🚨' : 'off'}
          </span>
        </div>

        {/* Inline second-stage confirm — appears only after the first
            tap on the OFF→ON path. Toggle OFF skips this entirely. */}
        {overrideConfirm === 'open' && !flags.allowUnverifiedDelegate && (
          <div className="dk-danger-confirm">
            <p>
              you are about to disable the wallet's main 7702 phishing
              defence. signing a delegation to an unverified contract
              gives that contract full control over this EOA — every
              token, every signature, every balance. <b>do not enable
              unless you 100% trust the contract and have read its
              bytecode yourself.</b>
            </p>
            <div className="dk-btn-row">
              <button
                className="dk-btn dk-btn-ghost"
                onClick={() => setOverrideConfirm('closed')}
              >
                cancel
              </button>
              <button
                className="dk-btn"
                onClick={confirmOverride}
                style={{ background: 'var(--alarm-red)', color: 'var(--white)', flex: 1 }}
              >
                yes, enable override
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

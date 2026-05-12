// Pin behavior of resolveTokenUri: the user-reported failure was a
// 504 Gateway Timeout on `https://ipfs.io/ipfs/...` URLs cached in
// older NftRecord.image fields. resolveTokenUri now rewrites known
// gateway URLs to the preferred mirror at render time so stale
// records auto-recover without re-add.

import { describe, it, expect } from 'bun:test';
import { resolveTokenUri } from '../src/core/erc721';

const PREFERRED_PREFIX = 'https://nftstorage.link/ipfs/';
const CID = 'bafkreiapk3pn7unvl4ecpwxn4wzm2assd5ogmoxccviag2vlastnq56uxa';

describe('resolveTokenUri', () => {
  it('expands ipfs:// to the preferred gateway', () => {
    expect(resolveTokenUri(`ipfs://${CID}`)).toBe(`${PREFERRED_PREFIX}${CID}`);
  });
  it('strips the `ipfs/` prefix some indexers prepend (`ipfs://ipfs/CID`)', () => {
    expect(resolveTokenUri(`ipfs://ipfs/${CID}`)).toBe(`${PREFERRED_PREFIX}${CID}`);
  });
  it('rewrites stale ipfs.io URLs onto the preferred gateway', () => {
    expect(resolveTokenUri(`https://ipfs.io/ipfs/${CID}`)).toBe(`${PREFERRED_PREFIX}${CID}`);
  });
  it('rewrites cloudflare-ipfs.com (deprecated 2024) onto the preferred gateway', () => {
    expect(resolveTokenUri(`https://cloudflare-ipfs.com/ipfs/${CID}`)).toBe(`${PREFERRED_PREFIX}${CID}`);
  });
  it('preserves a sub-path after the CID', () => {
    expect(resolveTokenUri(`https://ipfs.io/ipfs/${CID}/0.png`))
      .toBe(`${PREFERRED_PREFIX}${CID}/0.png`);
  });
  it('passes through data: URLs unchanged', () => {
    const data = 'data:application/json;base64,eyJuYW1lIjoidGVzdCJ9';
    expect(resolveTokenUri(data)).toBe(data);
  });
  it('passes through Arweave URLs via ar://', () => {
    expect(resolveTokenUri('ar://abc123')).toBe('https://arweave.net/abc123');
  });
  it('passes through unrelated https URLs unchanged', () => {
    expect(resolveTokenUri('https://example.com/api/nft/1.json'))
      .toBe('https://example.com/api/nft/1.json');
  });
  it('does NOT rewrite a non-gateway URL that happens to contain `/ipfs/`', () => {
    // A random site that uses `/ipfs/` in its path but isn't an IPFS
    // gateway must NOT be rewritten — that would replace the wrong
    // domain entirely.
    expect(resolveTokenUri('https://example.com/ipfs/foo'))
      .toBe('https://example.com/ipfs/foo');
  });
});

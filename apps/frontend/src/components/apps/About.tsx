'use client';

import { useState } from 'react';
import { copyText } from '@/utils/clipboard';
import XIcon from '@/components/ui/XIcon';

const VERSION = process.env.NEXT_PUBLIC_VERSION ?? '1.1.2';

const DONATE_ADDRESS = 'u192er4slrt3pqqqsqek5ksxvqfw9ws5qgtqvc5fjdpl9qg6kfzw9m9d8qcm80f2r37q0lxmkmtv9hqk8zrsuqlzny6pt8ut7xtgpam34q';

// Pixel-art old Twitter bird (16×16 logical pixels)

function QrModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 99999, cursor: 'pointer',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#000', border: '2px solid #00AAAA',
          boxShadow: '0 0 0 1px #0000AA, 6px 6px 0 #0000AA',
          width: 320, cursor: 'default',
        }}
      >
        <div style={{
          background: '#0000AA', padding: '5px 10px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid #00AAAA',
        }}>
          <span style={{ color: '#FFFF55', fontSize: '10px', fontFamily: 'monospace' }}>
            ZECOS Donation Address
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#AAA',
            cursor: 'pointer', fontSize: '13px', fontFamily: 'monospace', lineHeight: 1,
          }}>✕</button>
        </div>
        <div style={{ background: '#fff', padding: 16, display: 'flex', justifyContent: 'center' }}>
          <img src="/zcash.png" alt="ZEC donation QR" style={{ width: 280, height: 280 }} />
        </div>
      </div>
    </div>
  );
}

const ETH_HANDLE = 'orbgasm.eth';
/** The public repository. Empty until it is published; the link appears once it is set. */
const OPEN_SOURCE_REPO = 'https://github.com/orbism/zecos-public';

/** The people who found it broken before anyone else had to. */
const BETA_TESTERS: { name: string; handle: string; url: string }[] = [
  { name: 'dismad', handle: '@dismad8', url: 'https://x.com/dismad8' },
  { name: 'BIC DAO', handle: '@BIC_dao', url: 'https://x.com/BIC_dao' },
  { name: 'Zumbah', handle: '@zumbah', url: 'https://x.com/zumbah' },
  { name: 'Ammar', handle: '@ipaperhand', url: 'https://x.com/ipaperhand' },
  { name: 'spiderwars', handle: '@btc_on_eth', url: 'https://x.com/btc_on_eth' },
];

function DonateSection() {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedEth, setCopiedEth] = useState(false);

  const handleCopy = () => {
    void copyText(DONATE_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyEth = () => {
    void copyText(ETH_HANDLE);
    setCopiedEth(true);
    setTimeout(() => setCopiedEth(false), 1500);
  };

  return (
    <div className="mt-3 pt-2 border-t border-[var(--border-window)]">
      <p className="mb-2" style={{ fontSize: '12px', color: '#b8b8b8' }}>
        Donate to infrastructure and coffee costs:
      </p>
      <div className="flex items-start gap-2 flex-wrap">
        <span
          onClick={handleCopy}
          className="font-mono break-all transition-colors"
          style={{
            fontSize: '10px', flex: 1, minWidth: 0,
            color: copied ? 'var(--accent-green)' : 'var(--text-green)',
            cursor: 'pointer',
          }}
          title="Click to copy"
        >
          {copied ? '✓ Copied!' : DONATE_ADDRESS}
        </span>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <span style={{ fontSize: '10px', color: '#b8b8b8' }}>QR:</span>
          <img
            src="/zcash.png"
            alt="QR code"
            onClick={() => setShowQr(true)}
            style={{
              width: 28, height: 28, cursor: 'pointer',
              border: '1px solid var(--border-window)',
              imageRendering: 'pixelated',
            }}
            title="Click to enlarge"
          />
        </div>
      </div>
      <p
        className="mt-2"
        style={{ fontSize: '11px', color: '#5599ff', lineHeight: 1.5 }}
      >
        alternatively, you can tip on the Ethereum network at{' '}
        <span
          onClick={handleCopyEth}
          style={{
            fontWeight: 700,
            cursor: 'pointer',
            textDecoration: copiedEth ? 'none' : 'underline',
            textDecorationStyle: 'dotted',
            color: copiedEth ? '#55ff99' : '#7ab4ff',
          }}
          title="Click to copy"
        >
          {copiedEth ? '✓ copied!' : ETH_HANDLE}
        </span>
      </p>
      {showQr && <QrModal onClose={() => setShowQr(false)} />}
    </div>
  );
}

export function About() {
  return (
    <div className="flex flex-col h-full p-3 bg-[var(--bg-window)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <img src="/zec-logo.svg" alt="ZEC-OS" className="w-14 h-14" style={{ imageRendering: 'pixelated' }} />
        <div>
          <h1 className="text-[var(--accent-gold)]" style={{ fontFamily: 'var(--font-press-start)', fontSize: 'var(--font-size-title)' }}>
            ZEC-OS
          </h1>
          <p className="text-[var(--text-green)]" style={{ fontSize: 'var(--font-size-label)' }}>
            Version {VERSION}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0" style={{ fontSize: '13px' }}>
        <p className="text-[var(--text-green)] mb-3">
          A retro OS-style interface for the Zcash blockchain. Block explorer, mempool, miner analytics, privacy tools, and more - all in one place.
        </p>

        {/* Folders */}
        <div className="pt-2 border-t border-[var(--border-window)]">
          <p className="text-[var(--accent-gold)] font-bold mb-1">Folders:</p>
          <ul className="text-[var(--text-green)] ml-2 space-y-0.5">
            <li>Stats - price, height, pools, supply</li>
            <li>Charts - price, shielded pool, supply history</li>
            <li>Tools - Explorer, Mempool, Mining, TX Graph, more</li>
            <li>Privacy - weather score, coach, flow chart</li>
            <li>Widgets - ticker, halving countdown, network data</li>
            <li>Games - Dark Forest, Pong, Shmup</li>
          </ul>
        </div>

        {/* Philosophy */}
        <div className="mt-3 pt-2 border-t border-[var(--border-window)]">
          <p className="text-[var(--accent-gold)] font-bold mb-1">Philosophy</p>
          <p className="text-[var(--text-green)] leading-relaxed">
            ZEC-OS is built on one belief: <span className="text-[var(--accent-gold)]">great UX is the most powerful privacy tool</span>.
            When using Zcash feels good - exploring blocks, sending shielded transactions, analyzing the network - more people actually do it.
            That network effect matters for everyone.
          </p>
          <p className="mt-2 leading-relaxed" style={{ color: '#b8b8b8' }}>
            This is not about ideology. It&apos;s about making the Zcash network genuinely accessible:
            clear data, intuitive tools, an interface that feels fun and functional without requiring deep technical knowledge.
          </p>
        </div>

        {/* Tech stack */}
        <div className="mt-3 pt-2 border-t border-[var(--border-window)]">
          <p className="text-[var(--text-green)]">
            Built with Next.js · TypeScript · Tailwind CSS · Zustand · lots of coffee
          </p>
          <div className="mt-2" style={{ color: '#b8b8b8' }}>
            <span className="text-[var(--accent-gold)] font-bold">Zcash Stack: </span>
            <span>Zebra · Zaino · Zingo · Zallet · gRPC · custom RPC layer · more coffee</span>
          </div>
          <p className="text-[var(--accent-gold)] mt-2 font-bold">
            Powered by Zcash
            ... and coffee
          </p>
        </div>

        {/* Licence */}
        <div className="mt-3 pt-2 border-t border-[var(--border-window)]" style={{ color: '#b8b8b8' }}>
          <span className="text-[var(--accent-gold)] font-bold">Open source: </span>
          the core of ZEC-OS is free software under the{' '}
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-gold)] hover:underline">AGPL-3.0</a>
          {OPEN_SOURCE_REPO && <>{' '}(<a href={OPEN_SOURCE_REPO} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-gold)] hover:underline">source</a>)</>}.
          {' '}Some features of zec-os.com are not part of it.
        </div>

        {/* Credits */}
        <div className="mt-3 pt-2 border-t border-[var(--border-window)]">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ color: '#b8b8b8' }}>Created by</span>
            <a href="https://orbatron.org" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-gold)] hover:underline font-bold">
              Orb
            </a>
            <a href="https://x.com/artoforb" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity" title="@artoforb on X">
              <XIcon size={15} />
            </a>
          </div>

          {/* The people who broke it first.
              A LIST, not a wrapped row: the row fitted three names and reflowed
              into a ragged two lines at five, and it is only going to get
              longer. A column takes the same width at any length. */}
          <div className="mt-3">
            <div style={{ color: '#b8b8b8' }}>Beta testers</div>
            <ul className="mt-1 space-y-0.5">
              {BETA_TESTERS.map((t) => (
                <li key={t.handle} className="flex items-center gap-1.5">
                  <a href={t.url} target="_blank" rel="noopener noreferrer"
                    className="text-[var(--accent-gold)] hover:underline font-bold">
                    {t.name}
                  </a>
                  <a href={t.url} target="_blank" rel="noopener noreferrer"
                    className="hover:opacity-80 transition-opacity" title={`${t.handle} on X`}>
                    <XIcon size={12} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Donate */}
        <DonateSection />
      </div>
    </div>
  );
}

export default About;

'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

/**
 * The "u" in colour comes and goes.
 *
 * A small joke about the two spellings, first built for the Colours tab in the
 * Pools About panel and now used wherever the word is shown. The "u" wanders
 * out, the word sits as "color" for a while, and the letter slides back in a
 * random hue that settles into the text colour a moment later. Every word
 * runs its own clock, so no two blink in step.
 *
 * Server render and first paint always show the "u", so there is no hydration
 * mismatch. Anyone who has asked for reduced motion gets the plain word and no
 * timers at all.
 */

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const randomHue = () => `hsl(${Math.floor(Math.random() * 360)}, 85%, 68%)`;

/**
 * One wandering "u": whether it is in the word right now, and the hue it
 * arrived in (null once it has settled back to the text colour).
 *
 * Heavily skewed timing: mostly unhurried, occasionally a quick double-take. A
 * new hue only on the way IN; on the way out it is already fading.
 */
export function useFlickerU(): { present: boolean; hue: string | null } {
  const [present, setPresent] = useState(true);
  const [hue, setHue] = useState<string | null>(null);
  const presentRef = useRef(true);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const quick = Math.random() < 0.28;
      const wait = quick
        ? 260 + Math.random() * 500          // a beat
        : 2200 + Math.random() * 7000;       // long enough to forget about it
      timer = setTimeout(() => {
        const next = !presentRef.current;
        presentRef.current = next;
        setPresent(next);
        if (next) setHue(randomHue());
        tick();
      }, wait);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  /*
   * The settle is a SECOND transition, on colour alone, once the letter is up.
   * Fading width, opacity and colour together made the arrival read as a single
   * motion; letting the hue resolve afterwards is what makes it look like the
   * letter is deciding to belong.
   */
  useEffect(() => {
    if (!present || !hue) return;
    const t = setTimeout(() => setHue(null), 620);
    return () => clearTimeout(t);
  }, [present, hue]);

  return { present, hue };
}

/** A "u" in the case of the letters around it: COLOR gets "U", color gets "u". */
function uFor(head: string): string {
  return head === head.toUpperCase() && head !== head.toLowerCase() ? 'U' : 'u';
}

const PARTS = /^(colo)(u?)(r.*)$/i;

/**
 * One word - "colour", "Colours", "coloured", "color" - with its own
 * wandering "u". `rest` is the colour the letter settles to; omit it to
 * settle to the surrounding text.
 */
export function Colour({ word, rest }: { word: string; rest?: string }) {
  const { present, hue } = useFlickerU();
  const m = PARTS.exec(word);
  if (!m) return <>{word}</>;
  const [, head = '', own = '', tail = ''] = m;
  return (
    <span>
      {head}
      <span
        style={{
          // Width animates alongside opacity so the following letters slide
          // rather than jump: an animation should never move the furniture
          // around it.
          display: 'inline-block',
          overflow: 'hidden',
          verticalAlign: 'bottom',
          maxWidth: present ? '1ch' : 0,
          opacity: present ? 1 : 0,
          color: hue ?? rest,
          transition: 'max-width .42s cubic-bezier(.2,.8,.3,1), opacity .42s ease, color .6s ease',
        }}
      >{own || uFor(head)}</span>
      {tail}
    </span>
  );
}

const WORD = /(colou?r)/gi;

/**
 * Plain text in which every colour / color gets the wandering "u".
 *
 * A client component on purpose: server components can render it with a
 * string child, where calling a helper from a client module would not work.
 */
export function ColourText({ children }: { children: string }) {
  const parts = children.split(WORD);
  if (parts.length === 1) return <>{children}</>;
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1
        ? <Colour key={i} word={p} />
        : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

/**
 * The same joke for places that only take a string, like an `<option>` label,
 * which cannot hold an element. The "u" blinks there rather than slides.
 */
export function useColourLabel(text: string): string {
  const { present } = useFlickerU();
  return text.replace(/(colo)u?(r)/gi, (_m, head: string, r: string) => `${head}${present ? uFor(head) : ''}${r}`);
}

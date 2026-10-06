/**
 * The ZIM mark: a stick-figure sprinter in the spirit of a certain running
 * man from 1997 - except the whole body is a big italic Z, with a round head
 * on top, pumping stick arms, and legs ending in little feet. Speed lines
 * behind it in `currentColor`; the runner in Zcash gold.
 */
export default function ZimIcon({ size = 18, color = '#F4B728' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M0.4 10.6h2.8M0.9 13.2h2.4" stroke="currentColor" strokeWidth="1.2" opacity=".55" />
      {/* head */}
      <circle cx="16.8" cy="3.3" r="2.7" fill={color} />
      {/* the Z body, leaning into the run */}
      <path d="M9.6 7.1h8.2L7.8 15.6h8.1" stroke={color} strokeWidth="2.7" strokeLinejoin="miter" strokeLinecap="square" />
      <g stroke={color} strokeWidth="1.7">
        {/* arms: back one swung down and behind, front one bent and pumping up */}
        <path d="M9.6 7.4 6.6 9.6 4.6 8.6" />
        <path d="M17.8 7.4 20.6 9.2 22.3 7" />
        {/* legs with feet: front knee up and forward, back leg kicking out behind */}
        <path d="M15.2 15.8 18.2 18.8 17.2 22.1H20" />
        <path d="M8.6 15.8 5.9 18.6 3 19.6 2.3 17.9" />
      </g>
    </svg>
  );
}

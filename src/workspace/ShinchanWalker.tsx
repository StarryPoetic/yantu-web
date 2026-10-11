/** Locally drawn SVG; no images, fonts or external resources. */
export function ShinchanWalker() {
  return (
    <svg
      viewBox="0 0 100 120"
      aria-hidden="true"
      focusable="false"
      className="shinchan"
    >
      <g
        stroke="#25221e"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <g className="shinchan-leg back">
          <path
            d="M46 88 L41 106 L31 108"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="10"
          />
          <path d="M30 107 Q22 113 28 115 L43 114 L44 108" fill="#f5efc8" />
        </g>
        <g className="shinchan-arm back">
          <path
            d="M43 61 Q24 65 23 78"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="9"
          />
        </g>
        <path
          d="M37 75 L68 75 L70 94 L53 96 L51 88 L49 96 L33 93 Z"
          fill="#f6d637"
        />
        <g className="shinchan-leg front">
          <path
            d="M59 92 L63 106 L71 109"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="10"
          />
          <path d="M61 107 L59 114 L79 115 Q83 111 73 108" fill="#f5efc8" />
        </g>
        <path
          d="M38 54 Q53 49 66 56 L76 70 L65 76 L68 83 Q48 88 30 79 L34 66 L27 63 Z"
          fill="#e83e3e"
        />
        <g className="shinchan-arm front">
          <path
            d="M66 69 Q77 83 87 77"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="9"
          />
          <path d="M84 77 l5 -4 m-4 5 l6 -1" fill="none" strokeWidth="1.5" />
        </g>
        <path
          d="M17 22 Q21 3 46 5 Q72 4 80 24 L80 42 Q94 47 85 57 Q74 69 44 60 L25 49 Q12 46 14 35 Z"
          fill="#f8cda8"
        />
        <path
          d="M17 30 Q12 12 30 7 Q60 -1 77 16 L81 31 L71 19 L68 25 L62 16 L59 22 L49 15 L45 22 L34 18 L28 29 Z"
          fill="#211f1d"
        />
        <path
          d="M33 32 Q40 25 47 32 M56 31 Q63 25 69 32"
          fill="none"
          strokeWidth="7"
        />
        <ellipse cx="41" cy="39" rx="3.4" ry="5" fill="#211f1d" stroke="none" />
        <ellipse cx="64" cy="38" rx="3.4" ry="5" fill="#211f1d" stroke="none" />
        <path d="M24 37 Q13 30 15 43 Q17 49 25 47" fill="#f8cda8" />
        <path
          d="M20 38 Q16 39 21 43 M68 53 Q74 50 77 53"
          fill="none"
          strokeWidth="1.5"
        />
        <path d="M34 48 l3 3 m2 -4 l3 3" stroke="#dc946e" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

import { memo } from "react";

/** CSS owns the stride; progress updates need not redraw this local SVG. */
export const ShinchanWalker = memo(function ShinchanWalker() {
  return (
    <svg
      viewBox="0 0 100 120"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      focusable="false"
      className="shinchan"
    >
      <ellipse
        className="shinchan-shadow"
        cx="52"
        cy="117"
        rx="19"
        ry="3"
        fill="#25221e"
        opacity="0.16"
      />
      <g
        className="shinchan-body"
        stroke="#25221e"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <g className="shinchan-leg back">
          <path
            d="M44 88 L43 101"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="10"
          />
          <g className="shinchan-shin back">
            <path
              d="M43 101 L42 111"
              fill="none"
              stroke="#f7caa4"
              strokeWidth="9"
            />
            <path d="M37 109 L36 115 L53 115 Q57 111 47 109 Z" fill="#f5efc8" />
          </g>
        </g>
        <g className="shinchan-arm back">
          <path
            d="M42 61 L32 73 L42 80"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="9"
          />
        </g>
        <g className="shinchan-leg front">
          <path
            d="M59 88 L59 101"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="10"
          />
          <g className="shinchan-shin front">
            <path
              d="M59 101 L60 111"
              fill="none"
              stroke="#f7caa4"
              strokeWidth="9"
            />
            <path d="M55 109 L54 115 L72 115 Q76 111 66 109 Z" fill="#f5efc8" />
          </g>
        </g>
        <path
          d="M37 75 L68 75 L70 94 L53 96 L51 88 L49 96 L33 93 Z"
          fill="#f6d637"
        />
        <path
          d="M38 54 Q53 49 66 56 L76 70 L65 76 L68 83 Q48 88 30 79 L34 66 L27 63 Z"
          fill="#e83e3e"
        />
        <g className="shinchan-arm front">
          <path
            d="M65 64 L73 77 L85 70"
            fill="none"
            stroke="#f7caa4"
            strokeWidth="9"
          />
          <path d="M83 70 l4 -4 m-3 5 l5 -2" fill="none" strokeWidth="1.5" />
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
});

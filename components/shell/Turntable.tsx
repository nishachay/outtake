/** Photorealistic vector SVG turntable — the vault's signature deck.
 *  Vinyl spins + tonearm swings via the parent's `.playing` class.
 *  The center label is dyed per-song with the track's cover accent. */
export default function Turntable({ core }: { core: string }) {
  return (
    <svg className="turntable-svg" viewBox="0 0 400 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="chassisGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0f2f5" />
          <stop offset="25%" stopColor="#d4d8e0" />
          <stop offset="60%" stopColor="#a2a7b3" />
          <stop offset="100%" stopColor="#808591" />
        </linearGradient>

        <linearGradient id="bevelBorder" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#b0b5be" />
          <stop offset="100%" stopColor="#555a64" />
        </linearGradient>

        <linearGradient id="screwGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#4b5563" />
        </linearGradient>

        <radialGradient id="platterBevel" cx="50%" cy="50%" r="50%">
          <stop offset="85%" stopColor="#8a8f9a" />
          <stop offset="93%" stopColor="#ffffff" />
          <stop offset="97%" stopColor="#4a4e57" />
          <stop offset="100%" stopColor="#18181a" />
        </radialGradient>

        <radialGradient id="vinylGrooves" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1c1c1e" />
          <stop offset="25%" stopColor="#0c0c0e" />
          <stop offset="30%" stopColor="#1a1a1c" />
          <stop offset="55%" stopColor="#09090a" />
          <stop offset="60%" stopColor="#18181a" />
          <stop offset="85%" stopColor="#070708" />
          <stop offset="92%" stopColor="#161618" />
          <stop offset="100%" stopColor="#0a0a0c" />
        </radialGradient>

        <linearGradient id="vinylSheen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="35%" stopColor="#ffffff" stopOpacity="0.0" />
          <stop offset="65%" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
        </linearGradient>

        <linearGradient id="chromeArm" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#d1d5db" />
          <stop offset="70%" stopColor="#6b7280" />
          <stop offset="100%" stopColor="#374151" />
        </linearGradient>

        <filter id="dropShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000000" floodOpacity="0.5" />
        </filter>
        <filter id="armShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="3" dy="5" stdDeviation="4" floodColor="#000000" floodOpacity="0.6" />
        </filter>
      </defs>

      {/* 1. MAIN METALLIC CHASSIS DECK */}
      <rect x="8" y="8" width="384" height="364" rx="28" fill="url(#chassisGrad)" stroke="url(#bevelBorder)" strokeWidth="2.5" />
      <rect x="10" y="10" width="380" height="360" rx="26" fill="none" stroke="#000000" strokeOpacity="0.2" strokeWidth="1.5" />

      {/* 2. CORNER SCREWS (4 RIVETS) */}
      <g transform="translate(26, 26)">
        <circle cx="0" cy="0" r="5" fill="url(#screwGrad)" stroke="#4b5563" strokeWidth="0.8" />
        <line x1="-3" y1="-3" x2="3" y2="3" stroke="#374151" strokeWidth="1.2" />
      </g>
      <g transform="translate(374, 26)">
        <circle cx="0" cy="0" r="5" fill="url(#screwGrad)" stroke="#4b5563" strokeWidth="0.8" />
        <line x1="-3" y1="-3" x2="3" y2="3" stroke="#374151" strokeWidth="1.2" />
      </g>
      <g transform="translate(26, 354)">
        <circle cx="0" cy="0" r="5" fill="url(#screwGrad)" stroke="#4b5563" strokeWidth="0.8" />
        <line x1="-3" y1="-3" x2="3" y2="3" stroke="#374151" strokeWidth="1.2" />
      </g>
      <g transform="translate(374, 354)">
        <circle cx="0" cy="0" r="5" fill="url(#screwGrad)" stroke="#4b5563" strokeWidth="0.8" />
        <line x1="-3" y1="-3" x2="3" y2="3" stroke="#374151" strokeWidth="1.2" />
      </g>

      {/* 3. PLATTER WELL & STROBE DOTS RIM */}
      <g transform="translate(172, 190)">
        <circle cx="0" cy="0" r="148" fill="url(#platterBevel)" />
        <circle cx="0" cy="0" r="140" fill="#121214" stroke="#000000" strokeWidth="3" />

        <g opacity="0.85">
          <circle cx="0" cy="0" r="144" fill="none" stroke="#e5e7eb" strokeWidth="3" strokeDasharray="2.5 4.5" />
        </g>

        {/* 4. VINYL DISC (SPINNING GROUP) */}
        <g className="vinyl-group">
          <circle cx="0" cy="0" r="136" fill="url(#vinylGrooves)" filter="url(#dropShadow)" />
          <circle cx="0" cy="0" r="136" fill="url(#vinylSheen)" />

          {/* Center label: dyed per-song with the current track's accent. */}
          <circle cx="0" cy="0" r="44" fill="#101318" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
          <circle cx="0" cy="0" r="24" fill={core} stroke="rgba(255,255,255,0.40)" strokeWidth="1" />
          <circle cx="0" cy="0" r="43" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1" />

          {/* Center Spindle Pin (Dead Center 0 0) */}
          <circle cx="0" cy="0" r="5" fill="url(#screwGrad)" stroke="#111827" strokeWidth="1" />
          <circle cx="0" cy="0" r="2" fill="#111827" />
        </g>
      </g>

      {/* 5. TACTILE HARDWARE CONTROLS */}
      <g transform="translate(46, 330)" filter="url(#dropShadow)">
        <circle cx="0" cy="0" r="14" fill="url(#screwGrad)" stroke="#374151" strokeWidth="1.5" />
        <circle cx="0" cy="0" r="9" fill="#1f2937" stroke="#4b5563" strokeWidth="1" />
        <circle cx="0" cy="-4" r="2" fill="#ef4444" />
      </g>

      <g transform="translate(352, 310)" filter="url(#dropShadow)">
        <rect x="-3" y="-30" width="6" height="60" rx="3" fill="#1f2937" stroke="#4b5563" strokeWidth="1" />
        <line x1="-8" y1="-20" x2="-5" y2="-20" stroke="#6b7280" strokeWidth="1" />
        <line x1="-8" y1="0" x2="-5" y2="0" stroke="#ffffff" strokeWidth="1.2" />
        <line x1="-8" y1="20" x2="-5" y2="20" stroke="#6b7280" strokeWidth="1" />
        <rect x="-9" y="-6" width="18" height="12" rx="2" fill="url(#screwGrad)" stroke="#1f2937" strokeWidth="1.2" />
        <line x1="-6" y1="0" x2="6" y2="0" stroke="#1f2937" strokeWidth="1" />
      </g>

      {/* 6. 3D TONEARM & PIVOT ASSEMBLY */}
      <g className="tonearm-group" filter="url(#armShadow)">
        <circle cx="322" cy="72" r="26" fill="url(#chassisGrad)" stroke="#374151" strokeWidth="1.5" />
        <circle cx="322" cy="72" r="20" fill="url(#screwGrad)" stroke="#1f2937" strokeWidth="1.2" />
        <circle cx="322" cy="72" r="12" fill="#1f2937" stroke="#4b5563" strokeWidth="1" />
        <circle cx="322" cy="72" r="5" fill="url(#screwGrad)" />

        {/* Curved S-Arm Rod */}
        <path d="M 322 72 C 322 135, 305 175, 260 215" fill="none" stroke="url(#chromeArm)" strokeWidth="5.5" strokeLinecap="round" />

        {/* Inward-Facing Cartridge Headshell */}
        <g transform="translate(260, 215) rotate(-38)">
          <rect x="-8" y="0" width="16" height="28" rx="3" fill="url(#screwGrad)" stroke="#1f2937" strokeWidth="1.2" />
          <path d="M 8 10 Q 14 10 14 4" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" />
          <rect x="-4" y="26" width="8" height="6" rx="1" fill="#ef4444" />
        </g>
      </g>
    </svg>
  );
}

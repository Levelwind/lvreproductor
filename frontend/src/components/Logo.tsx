export function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <svg viewBox="0 0 100 40" width="80" height="32" xmlns="http://www.w3.org/2000/svg">
        <g stroke="var(--color-brand)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* Primera L */}
          <path d="M 10 10 L 10 30 L 22 30" />
          {/* Letra V central */}
          <path d="M 40 10 L 50 30 L 60 10" />
          {/* L invertida y simétrica */}
          <path d="M 90 10 L 90 30 L 78 30" />
        </g>
      </svg>
      <span style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px' }}>
        <span style={{ color: 'var(--color-brand)' }}>Level</span>
        <span style={{ color: 'var(--color-beige)', marginLeft: '6px' }}>Player</span>
      </span>
    </div>
  );
}

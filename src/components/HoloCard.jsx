import { useRef, useState } from 'react';

/** Card image with 3D tilt and holographic glare following the mouse. */
export default function HoloCard({ src, alt = '', width, glow = false, children, onClick }) {
  const ref = useRef(null);
  const [active, setActive] = useState(false);
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(px - 0.5) * 22}deg`);
    el.style.setProperty('--rx', `${(0.5 - py) * 22}deg`);
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
    el.style.setProperty('--o', '1');
  };
  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    setActive(false);
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--o', '0');
  };
  return (
    <div
      ref={ref}
      className={`holo-card ${active ? 'active' : ''}`}
      style={width ? { '--w': typeof width === 'number' ? `${width}px` : width } : undefined}
      onMouseMove={onMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      <div className="inner">
        {src ? <img src={src} alt={alt} draggable={false} loading="lazy" /> : <div className="skeleton" style={{ position: 'absolute', inset: 0 }} />}
        <div className="foil" />
        <div className="glare" />
        {children}
      </div>
      {glow && <div className="shadow-glow" />}
    </div>
  );
}

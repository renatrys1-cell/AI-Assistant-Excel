import { useState } from 'react';
import { fmtKzt, fmtKztShort, type Money } from '../../domain/money';
import { fmtDate } from '../../domain/periods';

/** Ақша қалдығы — бір серия (сызық), күн сайынғы. Hover — кроссхейр + тултип. */
export function CashChart({ data, height = 190 }: { data: { date: string; balance: Money; inflow: Money; outflow: Money }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div className="muted small">Дерек жоқ</div>;
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 12, t: 12, b: 24 };
  const vals = data.map((d) => d.balance);
  const rawMin = Math.min(...vals);
  let min = Math.min(0, rawMin);
  let max = Math.max(...vals);
  if (max === min) max = min + 100;
  const span = max - min;
  min -= span * 0.05;
  max += span * 0.05;
  const x = (i: number) => pad.l + (data.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (data.length - 1));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min));
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join(' ');
  const ticks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1];
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const h = hover !== null ? data[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Ақша қалдығының динамикасы"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
      >
        {ticks.map((tv, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tv)} y2={y(tv)} stroke="#e8ebef" />
            <text x={pad.l - 6} y={y(tv) + 4} fontSize="10" textAnchor="end" fill="#7b8696">
              {fmtKztShort(Math.round(tv)).replace(' ₸', '')}
            </text>
          </g>
        ))}
        {rawMin < 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#b42318" strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.date} x={x(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="#7b8696">
              {fmtDate(d.date).slice(0, 5)}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#9aa5b2" strokeDasharray="2 2" />
            <circle cx={x(hover)} cy={y(data[hover].balance)} r="4.5" fill="var(--chart-1)" stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.balance) / H) * 100}%` }}>
          <b>{fmtDate(h.date)}</b> · қалдық {fmtKzt(h.balance)}
          <br />
          түсім {fmtKzt(h.inflow)} · төлем {fmtKzt(h.outflow)}
        </div>
      )}
    </div>
  );
}

/** Жоспар және нақты — екі серия, легенда + тікелей мәндер. */
export function PlanFact({ rows }: { rows: { label: string; plan: Money; fact: Money | null; lowerIsBetter?: boolean }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.plan, r.fact ?? 0]));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row small muted">
        <span className="row" style={{ gap: 4 }}>
          <i style={{ width: 10, height: 10, background: 'var(--chart-plan)', borderRadius: 2, display: 'inline-block' }} /> Жоспар
        </span>
        <span className="row" style={{ gap: 4 }}>
          <i style={{ width: 10, height: 10, background: 'var(--chart-1)', borderRadius: 2, display: 'inline-block' }} /> Нақты
        </span>
      </div>
      {rows.map((r) => {
        const pct = r.fact === null || r.plan === 0 ? null : Math.round((r.fact / r.plan) * 100);
        const good = pct === null ? null : r.lowerIsBetter ? pct <= 100 : pct >= 100;
        return (
          <div key={r.label} title={`${r.label}: жоспар ${fmtKzt(r.plan)}, нақты ${fmtKzt(r.fact)}`}>
            <div className="row between small">
              <span>{r.label}</span>
              <span className="num">
                {fmtKztShort(r.fact)} / {fmtKztShort(r.plan)}{' '}
                {pct !== null && <b className={good ? 'delta-up' : 'delta-down'}>{pct}%</b>}
              </span>
            </div>
            <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
              <div style={{ height: 6, width: `${(r.plan / max) * 100}%`, background: 'var(--chart-plan)', borderRadius: '0 4px 4px 0' }} />
              <div style={{ height: 6, width: `${((r.fact ?? 0) / max) * 100}%`, background: 'var(--chart-1)', borderRadius: '0 4px 4px 0' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

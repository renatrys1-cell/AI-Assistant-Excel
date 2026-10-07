import { useState, type ReactNode } from 'react';
import { fmtKzt, fmtKztShort, type Money } from '../../domain/money';
import { GLOSSARY } from '../i18n';
import { FINDING_STATUS_LABEL, TASK_STATUS_LABEL } from '../../domain/workflow';
import type { FindingStatus, Severity, TaskStatus } from '../../domain/types';
import type { MetricStatus } from '../../domain/finance';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'ai' | 'outline';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone === 'neutral' ? '' : tone}`} title={title}>
      {children}
    </span>
  );
}

export function DemoBadge({ label = 'DEMO' }: { label?: string }) {
  return (
    <Badge tone="outline" title="Демонстрациялық дерек / функция">
      {label}
    </Badge>
  );
}

export function NotImplemented({ children = 'Кейінгі кезең — MVP-де іске асырылмаған' }: { children?: ReactNode }) {
  return <Badge tone="outline">⏳ {children}</Badge>;
}

export function Card({ title, actions, children, className = '', sub }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; sub?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-h">
          <div>
            {typeof title === 'string' ? <h3>{title}</h3> : title}
            {sub && <div className="muted small">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Жабу">
            ×
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Kzt({ v, short, sign }: { v: Money | null | undefined; short?: boolean; sign?: boolean }) {
  return <span className="num">{short ? fmtKztShort(v) : fmtKzt(v, { sign })}</span>;
}

export function Explain({ k }: { k: string }) {
  const [open, setOpen] = useState(false);
  const g = GLOSSARY[k];
  if (!g) return null;
  return (
    <>
      <button
        className="btn ghost sm"
        style={{ padding: '0 4px', minHeight: 20, fontSize: 12 }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Бұл нені білдіреді?"
      >
        ⓘ
      </button>
      {open && (
        <Modal title={`Бұл нені білдіреді? · ${g.title}`} onClose={() => setOpen(false)}>
          <p style={{ margin: 0 }}>{g.text}</p>
          {g.formula && <div className="callout info num" style={{ whiteSpace: 'normal' }}>{g.formula}</div>}
        </Modal>
      )}
    </>
  );
}

export function MetricStatusBadge({ status }: { status: MetricStatus | 'stale' }) {
  if (status === 'final') return <Badge tone="ok">Ай жабылған</Badge>;
  if (status === 'preliminary') return <Badge tone="info">Алдын ала</Badge>;
  if (status === 'incomplete') return <Badge tone="warn">Есеп толық емес</Badge>;
  if (status === 'stale') return <Badge tone="warn">Дерек ескі</Badge>;
  return <Badge>Дерек жоқ</Badge>;
}

const SEV: Record<Severity, [Tone, string]> = { low: ['neutral', 'Төмен'], medium: ['info', 'Орташа'], high: ['warn', 'Жоғары'], critical: ['danger', 'Шұғыл'] };
export function SeverityBadge({ s }: { s: Severity }) {
  return <Badge tone={SEV[s][0]}>{SEV[s][1]}</Badge>;
}

export function FindingStatusBadge({ s }: { s: FindingStatus }) {
  const tone: Tone = s === 'closed' ? 'ok' : s === 'not_an_error' ? 'neutral' : s === 'waiting_client' ? 'warn' : s === 'new' ? 'info' : 'outline';
  return <Badge tone={tone}>{FINDING_STATUS_LABEL[s]}</Badge>;
}

export function TaskStatusBadge({ s }: { s: TaskStatus }) {
  const tone: Tone = s === 'done' ? 'ok' : s === 'returned' ? 'danger' : s === 'waiting_client' ? 'warn' : s === 'in_review' ? 'info' : 'outline';
  return <Badge tone={tone}>{TASK_STATUS_LABEL[s]}</Badge>;
}

export function KindBadge({ kind }: { kind: 'rule' | 'ai' }) {
  return kind === 'ai' ? <Badge tone="ai" title="AI ұсынған күмән — дәлелденген қате емес">AI күмәні · тексеру керек</Badge> : <Badge tone="info" title="Нақты ереже бойынша табылған сәйкессіздік">Ереже</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted" style={{ padding: '24px 8px', textAlign: 'center' }}>{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="seg" role="tablist">
      {items.map(([k, l]) => (
        <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)} role="tab" aria-selected={value === k}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Bar({ pct, tone }: { pct: number; tone?: 'over' | 'warn' }) {
  return (
    <div className={`bar ${tone ?? ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Forbidden({ message }: { message: string }) {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 34 }}>🔒</div>
      <h2 className="mt8">Қолжетімділік жоқ</h2>
      <p className="muted">{message}</p>
      <p className="small muted">Әрекет аудит журналына жазылды. Рұқсат backend (API) деңгейінде тексеріледі.</p>
    </div>
  );
}

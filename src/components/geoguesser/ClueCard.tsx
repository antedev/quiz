import React from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

export interface ClueCardProps {
  title: string;
  subtitle: string;
  cost: number;
  isPurchased: boolean;
  isExpanded: boolean;
  isRoundEnded: boolean;
  isSv: boolean;
  borderColor: string;
  shadowColor: string;
  iconBg: string;
  icon: React.ReactNode;
  hintBadge?: string | null;
  /** Visas som en etikett när ledtråden ges gratis (t.ex. för nu levande personer). */
  freeLabel?: string | null;
  onToggle: () => void;
  children: React.ReactNode;
}

export const ClueCard: React.FC<ClueCardProps> = ({
  title,
  subtitle,
  cost,
  isPurchased,
  isExpanded,
  isRoundEnded,
  isSv,
  borderColor,
  shadowColor,
  iconBg,
  icon,
  hintBadge,
  freeLabel,
  onToggle,
  children,
}) => {
  const isUnlocked = isPurchased || isRoundEnded;

  return (
    <div
      onClick={onToggle}
      style={{
        border: isExpanded ? `2px solid ${borderColor}` : hintBadge ? '1.5px solid #86efac' : '1.5px solid #e2e8f0',
        borderRadius: '14px',
        padding: '12px 14px',
        background: isExpanded ? '#ffffff' : hintBadge ? '#f0fdf4' : '#f8fafc',
        boxShadow: isExpanded ? `0 4px 12px ${shadowColor}` : '0 1px 3px rgba(0,0,0,0.03)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        minHeight: '58px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: iconBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: '1.15rem',
            }}
          >
            {icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a', lineHeight: 1.25 }}>{title}</div>
            {freeLabel && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginTop: '4px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: '#fef9c3',
                  color: '#854d0e',
                  border: '1px solid #fde047',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                }}
              >
                🎁 {freeLabel}
              </div>
            )}
            {!isExpanded && (
              <div style={{ fontSize: '0.81rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.25 }}>
                {subtitle}
              </div>
            )}
            {!isExpanded && hintBadge && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginTop: '4px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: '#dcfce7',
                  color: '#166534',
                  border: '1px solid #86efac',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                }}
              >
                💡 {hintBadge}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            padding: '8px 14px',
            borderRadius: '999px',
            fontWeight: 800,
            fontSize: '0.85rem',
            background: isExpanded
              ? '#f1f5f9'
              : isUnlocked
              ? '#e0e7ff'
              : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
            color: isExpanded ? '#475569' : isUnlocked ? '#3730a3' : '#ffffff',
            boxShadow: !isUnlocked ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          {isExpanded ? (
            <>
              <span>{isSv ? 'Dölj' : 'Hide'}</span>
              <ChevronUp size={15} />
            </>
          ) : isUnlocked ? (
            <>
              <span>{isSv ? 'Visa' : 'Show'}</span>
              <ChevronDown size={15} />
            </>
          ) : (
            <>
              <Sparkles size={14} style={{ color: '#fef08a' }} />
              <span>{isSv ? `-${cost} p` : `-${cost} p`}</span>
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div
          style={{ marginTop: '11px', paddingTop: '11px', borderTop: '1px solid #e2e8f0' }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
};

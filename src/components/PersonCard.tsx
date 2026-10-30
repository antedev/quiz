import React from 'react';
import { loc, type Person } from '../types/person.ts';
import { MapPin, Award, Eye, Calendar, User, Globe } from 'lucide-react';

interface PersonCardProps {
  person: Person;
  allPeople?: Person[];
  lang: 'sv' | 'en';
  isSolved?: boolean;
  onInspect: (person: Person) => void;
}

export const PersonCard: React.FC<PersonCardProps> = ({ person, lang, isSolved, onInspect }) => {
  const isSv = lang === 'sv';

  const name = loc(person.name, lang, isSv ? 'Okänd' : 'Unknown');
  const desc = loc(person.description, lang);
  const birthPlace = loc(person.birthPlace?.name, lang);
  const deathPlace = loc(person.deathPlace?.name, lang);
  const occupations = person.occupations.map((o) => loc(o.name, lang)).filter(Boolean);
  const works = person.notableWorks.map((w) => loc(w.name, lang)).filter(Boolean);

  const birthYear = person.birthDate.year;
  const deathYear = person.deathDate?.year;
  const lifespan = deathYear ? deathYear - birthYear : (new Date().getFullYear() - birthYear);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: '14px',
        border: isSolved ? '1.5px solid #16a34a' : '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      {/* 1. Header-rad OVANFÖR bilden (så badges inte täcker ansiktet eller pannan!) */}
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: isSolved ? '#f0fdf4' : '#faf6ed',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${person.tier === 'standard' ? 'badge-guess' : person.tier === 'hard' ? 'badge-med' : 'badge-ref'}`}>
            {person.tier === 'standard'
              ? (isSv ? '⭐ Standard' : '⭐ Standard')
              : person.tier === 'hard'
              ? (isSv ? '🔥 Svår' : '🔥 Hard')
              : (isSv ? '⚡ Mycket svår' : '⚡ Very Hard')}
          </span>
          {person.swedish && (
            <span className="badge badge-swedish">
              🇸🇪 {isSv ? 'Sverige' : 'Sweden'}
            </span>
          )}
          {isSolved && (
            <span
              style={{
                background: '#dcfce7',
                color: '#166534',
                border: '1px solid #86efac',
                padding: '1px 6px',
                borderRadius: '999px',
                fontWeight: 800,
                fontSize: '0.7rem',
              }}
            >
              ✓ {isSv ? 'Löst' : 'Solved'}
            </span>
          )}
        </div>

        <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
          <Globe size={11} /> {person.sitelinks}
        </span>
      </div>

      {/* 2. Porträttbild i 1:1 KVADRATISKT FORMAT (visar hela ansiktet utan beskärning till liggande) */}
      <div
        onClick={() => onInspect(person)}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          background: '#ede5d6',
          overflow: 'hidden',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={isSv ? 'Klicka för att se full bild och detaljer' : 'Click to inspect'}
      >
        {person.image?.thumb ? (
          <img
            src={person.image.thumb}
            alt={name}
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center 20%', // Fokuserar på ögon och ansikte
              transition: 'transform 0.25s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              gap: '0.5rem',
            }}
          >
            <User size={56} strokeWidth={1.5} />
            <span style={{ fontSize: '0.8rem' }}>{isSv ? 'Porträtt saknas' : 'No portrait'}</span>
          </div>
        )}
      </div>

      {/* 3. Innehåll & information */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', flex: 1, gap: '0.65rem' }}>
        <div>
          <h3
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
            }}
          >
            {name}
          </h3>

          {/* Levnadsår & Ålder bricka */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '4px' }}>
            <Calendar size={13} style={{ color: 'var(--accent-gold-dark)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>
              {birthYear < 0 ? `${Math.abs(birthYear)} ${isSv ? 'f.Kr.' : 'BC'}` : birthYear} –{' '}
              {deathYear
                ? deathYear < 0
                  ? `${Math.abs(deathYear)} ${isSv ? 'f.Kr.' : 'BC'}`
                  : deathYear
                : isSv
                ? 'nu levande'
                : 'alive'}
            </span>
            <span
              style={{
                background: deathYear ? 'var(--tag-bg)' : '#fce8e6',
                color: deathYear ? 'var(--tag-text)' : '#c5221f',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '0.72rem',
                fontWeight: 700,
              }}
            >
              {lifespan} {isSv ? 'år' : 'yrs'}
            </span>
          </div>

          {desc && (
            <p
              className="quote-font"
              style={{
                fontSize: '0.88rem',
                color: 'var(--text-secondary)',
                fontStyle: 'italic',
                lineHeight: 1.35,
                marginTop: '6px',
              }}
            >
              "{desc}"
            </p>
          )}
        </div>

        {/* Platser */}
        {(birthPlace || deathPlace) && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <MapPin size={14} style={{ color: 'var(--border-focus)', flexShrink: 0 }} />
            <span>
              {birthPlace && deathPlace && birthPlace !== deathPlace
                ? `${birthPlace} → ${deathPlace}`
                : (birthPlace || deathPlace)}
            </span>
          </div>
        )}

        {/* Yrken */}
        {occupations.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: 'auto' }}>
            {occupations.slice(0, 3).map((occ, i) => (
              <span
                key={i}
                style={{
                  background: 'var(--tag-bg)',
                  color: 'var(--tag-text)',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                {occ}
              </span>
            ))}
          </div>
        )}

        {/* Kända verk */}
        {works.length > 0 && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Award size={13} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {works.slice(0, 2).join(', ')}
            </span>
          </div>
        )}

        {/* Knapp i botten */}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
          <button
            onClick={() => onInspect(person)}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-focus)',
              background: 'var(--accent-gold)',
              color: '#fff',
              fontSize: '0.78rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <Eye size={13} />
            {isSv ? 'Inspektera' : 'Inspect'}
          </button>
        </div>
      </div>
    </div>
  );
};

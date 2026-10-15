import React, { useState } from 'react';
import type { Person } from '../types/person.ts';
import { formatDate, generateClues } from '../engine/clues.ts';
import { MapPin, Briefcase, Award, Eye, Calendar, Sparkles, User, ExternalLink, Globe } from 'lucide-react';

interface PersonCardProps {
  person: Person;
  allPeople: Person[];
  lang: 'sv' | 'en';
  onInspect: (person: Person) => void;
}

export const PersonCard: React.FC<PersonCardProps> = ({ person, allPeople, lang, onInspect }) => {
  const [showClues, setShowClues] = useState(false);
  const isSv = lang === 'sv';

  const name = person.name[lang] || person.name.sv || person.name.en || 'Okänd';
  const desc = person.description[lang] || person.description.sv || person.description.en || '';
  const birthPlace = person.birthPlace?.name[lang] || person.birthPlace?.name.sv || person.birthPlace?.name.en;
  const deathPlace = person.deathPlace?.name[lang] || person.deathPlace?.name.sv || person.deathPlace?.name.en;
  const occupations = person.occupations.map((o) => o.name[lang] || o.name.sv || o.name.en).filter(Boolean);
  const works = person.notableWorks.map((w) => w.name[lang] || w.name.sv || w.name.en).filter(Boolean);

  const birthYear = person.birthDate.year;
  const deathYear = person.deathDate?.year;
  const lifespan = deathYear ? deathYear - birthYear : (new Date().getFullYear() - birthYear);

  const clues = showClues ? generateClues(person, allPeople, lang) : [];

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
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
          background: '#faf6ed',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
          <span className={`badge ${person.tier === 'guess' ? 'badge-guess' : 'badge-ref'}`}>
            {person.tier === 'guess' ? (isSv ? 'Nivå 1: Gissning' : 'Tier 1: Guess') : (isSv ? 'Nivå 2: Referens' : 'Tier 2: Ref')}
          </span>
          {person.swedish && (
            <span className="badge badge-swedish">
              🇸🇪 {isSv ? 'Sverige' : 'Sweden'}
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
              {birthYear} – {deathYear ? deathYear : (isSv ? 'nu levande' : 'alive')}
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
              {lifespan} år
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

        {/* Ledtråds-panel (om uppfälld) */}
        {showClues && (
          <div
            style={{
              marginTop: '0.5rem',
              padding: '0.75rem',
              background: 'var(--bg-subtle)',
              borderRadius: '8px',
              border: '1px dashed var(--border-color)',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--accent-gold-dark)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Sparkles size={14} /> {isSv ? 'Hur ledtrådarna ser ut i spelet:' : 'In-game clues preview:'}
            </div>
            {clues.map((c) => (
              <div key={c.level} style={{ borderBottom: '1px solid #e2d7c0', paddingBottom: '3px' }}>
                <span style={{ fontWeight: 700, color: 'var(--accent-blue)' }}>{c.points}p:</span> {c.text}
              </div>
            ))}
          </div>
        )}

        {/* Knappar i botten */}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
          <button
            onClick={() => setShowClues(!showClues)}
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: showClues ? 'var(--tag-bg)' : '#fff',
              color: 'var(--text-primary)',
              fontSize: '0.78rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <Sparkles size={13} />
            {showClues ? (isSv ? 'Dölj ledtrådar' : 'Hide clues') : (isSv ? 'Ledtrådar' : 'Clues')}
          </button>

          <button
            onClick={() => onInspect(person)}
            style={{
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

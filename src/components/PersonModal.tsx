import React from 'react';
import { loc, QUIZ_CATEGORIES, type Person } from '../types/person.ts';
import { formatDate, findContemporaries } from '../engine/clues.ts';
import { X, Calendar, MapPin, Globe, ExternalLink, Users, User } from 'lucide-react';

interface PersonModalProps {
  person: Person | null;
  allPeople: Person[];
  lang: 'sv' | 'en';
  onClose: () => void;
  onPlayGeoGuesser?: (person: Person) => void;
}

export const PersonModal: React.FC<PersonModalProps> = ({
  person,
  allPeople,
  lang,
  onClose,
  onPlayGeoGuesser,
}) => {
  if (!person) return null;
  const isSv = lang === 'sv';

  const name = loc(person.name, lang, isSv ? 'Okänd' : 'Unknown');
  const desc = loc(person.description, lang);
  const contemporaries = findContemporaries(person, allPeople, 3, lang);

  const birthPlace = loc(person.birthPlace?.name, lang);
  const birthCountry = loc(person.birthPlace?.country?.name, lang);
  const deathPlace = loc(person.deathPlace?.name, lang);
  const deathCountry = loc(person.deathPlace?.country?.name, lang);
  const occupations = person.occupations.map((o) => loc(o.name, lang)).filter(Boolean);
  const citizenship = person.citizenship.map((c) => loc(c.name, lang)).filter(Boolean);
  const works = person.notableWorks.map((w) => loc(w.name, lang)).filter(Boolean);
  const causes = person.causeOfDeath.map((c) => loc(c.name, lang)).filter(Boolean);
  const manners = person.mannerOfDeath.map((m) => loc(m.name, lang)).filter(Boolean);

  const wikiLang = person.wiki[lang] ? lang : (person.wiki.sv ? 'sv' : 'en');
  const wikiTitle = person.wiki[wikiLang];
  const wikiUrl = wikiTitle
    ? `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`
    : `https://www.wikidata.org/wiki/${person.id}`;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(20, 16, 12, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: '16px',
          maxWidth: '750px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header med bild och titel */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color)' }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'rgba(255, 255, 255, 0.9)',
              border: '1px solid var(--border-color)',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              color: 'var(--text-primary)',
            }}
          >
            <X size={18} />
          </button>

          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', background: 'var(--bg-subtle)' }}>
            {person.image?.thumb ? (
              <div style={{ width: '220px', height: '220px', flexShrink: 0, overflow: 'hidden', background: '#333' }}>
                <img
                  src={person.image.thumb}
                  alt={name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
                />
              </div>
            ) : (
              <div
                style={{
                  width: '160px',
                  height: '160px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#e0d6c4',
                  color: '#8c7b68',
                }}
              >
                <User size={64} />
              </div>
            )}

            <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                <span className={`badge ${person.tier === 'standard' ? 'badge-guess' : person.tier === 'hard' ? 'badge-med' : 'badge-ref'}`}>
                  {person.tier === 'standard'
                    ? (isSv ? '⭐ Standard (Ikon & Kändis)' : '⭐ Standard (Icon & Well-known)')
                    : person.tier === 'hard'
                    ? (isSv ? '🔥 Svår (Allmänbildning)' : '🔥 Hard (General knowledge)')
                    : (isSv ? '⚡ Mycket svår (Fördjupning & Nisch)' : '⚡ Very Hard (In-depth & Niche)')}
                </span>
                {person.categories && person.categories.map((cat) => {
                  const info = QUIZ_CATEGORIES[cat] || QUIZ_CATEGORIES.other;
                  return (
                    <span key={cat} className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 700 }}>
                      {info.icon} {info[lang] || info.sv}
                    </span>
                  );
                })}
                {person.swedish && <span className="badge badge-swedish">🇸🇪 {isSv ? 'Svensk koppling' : 'Swedish connection'}</span>}
                <span className="badge badge-ref">
                  <Globe size={11} /> {person.sitelinks} {isSv ? 'Wikipedia-språk' : 'Wikipedia languages'}
                </span>
              </div>

              <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15 }}>
                {name}
              </h2>
              {desc && (
                <p className="quote-font" style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '0.2rem' }}>
                  "{desc}"
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0.6rem', fontSize: '0.85rem' }}>
                <Calendar size={15} style={{ color: 'var(--accent-gold-dark)' }} />
                <span>
                  <strong>{formatDate(person.birthDate, lang)}</strong> – <strong>{formatDate(person.deathDate, lang)}</strong>
                  {person.deathDate && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                      ({isSv ? `blev ${person.deathDate.year - person.birthDate.year} år` : `aged ${person.deathDate.year - person.birthDate.year}`})
                    </span>
                  )}
                </span>
              </div>

              {onPlayGeoGuesser && (person.birthPlace?.coord || person.deathPlace?.coord) && (
                <button
                  onClick={() => {
                    onPlayGeoGuesser(person);
                    onClose();
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    marginTop: '0.75rem',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-focus)',
                    background: 'var(--accent-gold)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <MapPin size={14} />
                  {isSv ? 'Spela som gåta i GeoGuesser 🌍' : 'Play in GeoGuesser 🌍'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Detalj-sektioner */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Fakta-grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              background: '#fdfbf7',
              padding: '1rem',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                {isSv ? 'Födelseort' : 'Place of birth'}
              </div>
              <div style={{ fontWeight: 600, marginTop: '2px' }}>
                {birthPlace || (isSv ? 'Ej angivet' : 'Unknown')}
                {birthCountry && ` (${birthCountry})`}
              </div>
              {person.birthPlace?.coord && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {person.birthPlace.coord[0].toFixed(3)}°, {person.birthPlace.coord[1].toFixed(3)}°
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                {isSv ? 'Dödsort' : 'Place of death'}
              </div>
              <div style={{ fontWeight: 600, marginTop: '2px' }}>
                {deathPlace || (isSv ? 'Ej angivet' : 'Unknown')}
                {deathCountry && ` (${deathCountry})`}
              </div>
              {person.deathPlace?.coord && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {person.deathPlace.coord[0].toFixed(3)}°, {person.deathPlace.coord[1].toFixed(3)}°
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                {isSv ? 'Medborgarskap / Land' : 'Citizenship'}
              </div>
              <div style={{ fontWeight: 600, marginTop: '2px' }}>
                {citizenship.join(', ') || (isSv ? 'Ej angivet' : 'Unknown')}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                {isSv ? 'Dödsorsak / Sätt' : 'Cause of death'}
              </div>
              <div style={{ fontWeight: 600, marginTop: '2px' }}>
                {[...causes, ...manners].join(', ') || (isSv ? 'Naturlig / ej angiven' : 'Unspecified')}
              </div>
            </div>
          </div>

          {/* Yrken & Verk */}
          {(occupations.length > 0 || works.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {occupations.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    {isSv ? 'YRKESTITLAR & VERKSAMHET' : 'OCCUPATIONS'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {occupations.map((occ, i) => (
                      <span key={i} style={{ background: 'var(--tag-bg)', padding: '3px 8px', borderRadius: '5px', fontSize: '0.8rem', fontWeight: 600 }}>
                        {occ}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {works.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    {isSv ? 'KÄNDA VERK / BEDRIFTER' : 'NOTABLE WORKS'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {works.map((w, i) => (
                      <span key={i} style={{ background: '#f5ecd7', color: '#7a5a1e', border: '1px solid #ebd9b5', padding: '3px 8px', borderRadius: '5px', fontSize: '0.8rem', fontWeight: 600 }}>
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Samtida kända personer (Tidskompisar) */}
          {contemporaries.length > 0 && (
            <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--accent-gold-dark)', marginBottom: '0.6rem' }}>
                <Users size={16} />
                <span>{isSv ? 'Samtida kända personer (Tidskompisar):' : 'Famous Contemporaries:'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {contemporaries.map((c, idx) => (
                  <div key={c.person.id || idx} style={{ display: 'flex', gap: '10px', fontSize: '0.85rem', background: '#fff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e5dac6' }}>
                    <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>⏳</span>
                    <div style={{ flex: 1, color: 'var(--text-primary)' }}>{c.relationship}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bildlicens & Externa länkar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              {person.image?.license && (
                <span>
                  {isSv ? 'Bild:' : 'Image:'} {person.image.license} {person.image.artist && `• ${person.image.artist}`}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <a
                href={`https://www.wikidata.org/wiki/${person.id}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent-blue)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
              >
                Wikidata ({person.id}) <ExternalLink size={12} />
              </a>
              <a
                href={wikiUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent-blue)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
              >
                Wikipedia <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

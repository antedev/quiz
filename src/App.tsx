import React, { useState, useEffect, useMemo } from 'react';
import type { PeopleDataset, Person, Tier } from './types/person.ts';
import { PersonCard } from './components/PersonCard.tsx';
import { PersonModal } from './components/PersonModal.tsx';
import { TimelineView } from './components/TimelineView.tsx';
import { GeoGuesserView } from './components/GeoGuesserView.tsx';
import { Search, Shuffle, Filter, SlidersHorizontal, Users, Sparkles, BookOpen, Flag, CheckCircle2, ChevronDown, LayoutGrid, Clock, Compass } from 'lucide-react';

const CENTURIES = [
  { label: 'Alla sekler', value: 'all' },
  { label: '1000–1200-talet', value: 'early' },
  { label: '1300-talet', value: '1300' },
  { label: '1400-talet', value: '1400' },
  { label: '1500-talet', value: '1500' },
  { label: '1600-talet', value: '1600' },
  { label: '1700-talet', value: '1700' },
  { label: '1800-talet', value: '1800' },
  { label: '1900-talet', value: '1900' },
  { label: '2000-talet', value: '2000' },
];

export const App: React.FC = () => {
  const [dataset, setDataset] = useState<PeopleDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<'sv' | 'en'>('sv');
  const [viewMode, setViewMode] = useState<'geoguesser' | 'timeline' | 'cards'>('geoguesser');
  const [geoGuesserPersonId, setGeoGuesserPersonId] = useState<string | null>(null);

  // Filter-tillstånd
  const [search, setSearch] = useState('');
  const [selectedCentury, setSelectedCentury] = useState('all');
  const [selectedTier, setSelectedTier] = useState<'all' | Tier>('all');
  const [onlySwedish, setOnlySwedish] = useState(false);
  const [onlyLiving, setOnlyLiving] = useState(false);
  const [sortBy, setSortBy] = useState<'fame' | 'birth_asc' | 'birth_desc' | 'name'>('fame');

  // Paginering / Hur många som visas i taget
  const [visibleCount, setVisibleCount] = useState(24);

  // Inspektions-modal
  const [inspectedPerson, setInspectedPerson] = useState<Person | null>(null);

  // Mobil-detektering för anpassad vy
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    fetch('/data/people.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Kunde inte läsa databasen (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: PeopleDataset) => {
        setDataset(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const people = dataset?.people ?? [];

  // Filtrering & Sökning
  const filteredPeople = useMemo(() => {
    return people.filter((p) => {
      // Söksträng
      if (search.trim()) {
        const q = search.toLowerCase();
        const pName = (p.name[lang] || p.name.sv || p.name.en || '').toLowerCase();
        const pDesc = (p.description[lang] || p.description.sv || p.description.en || '').toLowerCase();
        const pBirthPlace = (p.birthPlace?.name[lang] || p.birthPlace?.name.sv || '').toLowerCase();
        const pOcc = p.occupations.map((o) => (o.name[lang] || o.name.sv || '').toLowerCase()).join(' ');
        const pWorks = p.notableWorks.map((w) => (w.name[lang] || w.name.sv || '').toLowerCase()).join(' ');
        if (!pName.includes(q) && !pDesc.includes(q) && !pBirthPlace.includes(q) && !pOcc.includes(q) && !pWorks.includes(q)) {
          return false;
        }
      }

      // Sekelfilter
      if (selectedCentury !== 'all') {
        const by = p.birthDate.year;
        if (selectedCentury === 'early' && by >= 1300) return false;
        if (selectedCentury !== 'early') {
          const targetCent = Number(selectedCentury);
          if (by < targetCent || by >= targetCent + 100) return false;
        }
      }

      // Nivåfilter
      if (selectedTier !== 'all' && p.tier !== selectedTier) return false;

      // Svensk-filter
      if (onlySwedish && !p.swedish) return false;

      // Levande-filter
      if (onlyLiving && p.deathDate !== null) return false;

      return true;
    });
  }, [people, search, selectedCentury, selectedTier, onlySwedish, onlyLiving, lang]);

  // Sortering
  const sortedPeople = useMemo(() => {
    const list = [...filteredPeople];
    if (sortBy === 'fame') {
      list.sort((a, b) => b.sitelinks - a.sitelinks);
    } else if (sortBy === 'birth_asc') {
      list.sort((a, b) => a.birthDate.year - b.birthDate.year);
    } else if (sortBy === 'birth_desc') {
      list.sort((a, b) => b.birthDate.year - a.birthDate.year);
    } else if (sortBy === 'name') {
      list.sort((a, b) => {
        const na = a.name[lang] || a.name.sv || a.name.en || '';
        const nb = b.name[lang] || b.name.sv || b.name.en || '';
        return na.localeCompare(nb, 'sv');
      });
    }
    return list;
  }, [filteredPeople, sortBy, lang]);

  // Slumpa ett kort
  const handleRandomCard = () => {
    if (!sortedPeople.length) return;
    const random = sortedPeople[Math.floor(Math.random() * sortedPeople.length)]!;
    setInspectedPerson(random);
  };

  const isSv = lang === 'sv';

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem' }}>
        <h2 className="serif-font" style={{ fontSize: '1.75rem', color: 'var(--accent-gold-dark)' }}>
          Laddar Wikidata-databasen...
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>Läser in 4 097 historiska personer...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-red)' }}>
        <h2>Ett fel uppstod vid inläsning</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Topp-header */}
      {/* Topp-header */}
      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid var(--border-color)',
          padding: isMobile ? '7px 10px' : '1.25rem 1.5rem',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: isMobile ? 'nowrap' : 'wrap', gap: isMobile ? '8px' : '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: isMobile ? '1.15rem' : '1.5rem' }}>⏳</span>
              <h1 className="serif-font" style={{ fontSize: isMobile ? '1.05rem' : '1.5rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                LIVSLINJEN
              </h1>
              {!isMobile && <span className="badge badge-guess">Databas-utforskare</span>}
            </div>
            {!isMobile && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {isSv
                  ? 'Bläddra runt bland 4 097 kurerade historiska personer från Wikidata'
                  : 'Explore 4,097 curated historical people from Wikidata'}
              </p>
            )}
          </div>

          {/* Visningsläge (Kort vs Tidslinje), Språkväxlare & Slumpa-knapp */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '0.75rem', flexWrap: 'nowrap' }}>
            {/* Vy-väljare */}
            <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
              <button
                onClick={() => setViewMode('geoguesser')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: isMobile ? '5px 7px' : '7px 13px',
                  background: viewMode === 'geoguesser' ? 'var(--accent-blue)' : '#fff',
                  color: viewMode === 'geoguesser' ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  fontWeight: viewMode === 'geoguesser' ? 700 : 500,
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                }}
                title="GeoGuesser"
              >
                <Compass size={isMobile ? 13 : 15} />
                <span>{isMobile ? 'Geo' : 'GeoGuesser'}</span>
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: isMobile ? '5px 7px' : '7px 12px',
                  background: viewMode === 'timeline' ? 'var(--accent-blue)' : '#fff',
                  color: viewMode === 'timeline' ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderLeft: '1px solid var(--border-color)',
                  fontWeight: viewMode === 'timeline' ? 700 : 500,
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                }}
                title={isSv ? 'Tidslinje' : 'Timeline'}
              >
                <Clock size={isMobile ? 13 : 15} />
                <span>{isMobile ? 'Tid' : (isSv ? 'Tidslinje' : 'Timeline')}</span>
              </button>
              <button
                onClick={() => setViewMode('cards')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: isMobile ? '5px 7px' : '7px 12px',
                  background: viewMode === 'cards' ? 'var(--accent-blue)' : '#fff',
                  color: viewMode === 'cards' ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderLeft: '1px solid var(--border-color)',
                  fontWeight: viewMode === 'cards' ? 700 : 500,
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                }}
                title={isSv ? 'Kortvy' : 'Cards'}
              >
                <LayoutGrid size={isMobile ? 13 : 15} />
                <span>{isMobile ? 'Kort' : (isSv ? 'Kortvy' : 'Cards')}</span>
              </button>
            </div>

            {!isMobile && (
              <button
                onClick={handleRandomCard}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  background: 'var(--accent-gold)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  boxShadow: '0 2px 5px rgba(197, 155, 39, 0.3)',
                }}
              >
                <Shuffle size={15} />
                {isSv ? 'Slumpa' : 'Random'}
              </button>
            )}

            <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
              <button
                onClick={() => setLang('sv')}
                style={{
                  padding: isMobile ? '4px 6px' : '6px 10px',
                  background: lang === 'sv' ? 'var(--tag-bg)' : '#fff',
                  border: 'none',
                  fontWeight: lang === 'sv' ? 700 : 400,
                  fontSize: isMobile ? '0.72rem' : '0.8rem',
                }}
                title="Svenska"
              >
                🇸🇪{isMobile ? '' : ' Svenska'}
              </button>
              <button
                onClick={() => setLang('en')}
                style={{
                  padding: isMobile ? '4px 6px' : '6px 10px',
                  background: lang === 'en' ? 'var(--tag-bg)' : '#fff',
                  border: 'none',
                  fontWeight: lang === 'en' ? 700 : 400,
                  fontSize: isMobile ? '0.72rem' : '0.8rem',
                }}
                title="English"
              >
                🇬🇧{isMobile ? '' : ' English'}
              </button>
            </div>
          </div>
        </div>

        {/* Statistik-chips (döljs i GeoGuesser och på mobil för att ge maximal yta) */}
        {!isMobile && viewMode !== 'geoguesser' && (
          <div style={{ maxWidth: '1400px', margin: '0.75rem auto 0', display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>{isSv ? 'I databasen:' : 'In database:'}</span>
            <span className="badge badge-ref">Totalt: {dataset?.counts.total}</span>
            <span className="badge badge-guess">Gissnings-pool: {dataset?.counts.guess}</span>
            <span className="badge badge-ref">Referens-pool: {dataset?.counts.reference}</span>
            <span className="badge badge-swedish">Svenska: {dataset?.counts.swedish}</span>
            <span className="badge badge-living">Nu levande: {dataset?.counts.living}</span>
            <span className="badge badge-ref">Med porträtt: {dataset?.counts.withImage}</span>
          </div>
        )}
      </header>

      {viewMode === 'geoguesser' ? (
        <main style={{ height: isMobile ? 'calc(100dvh - 46px)' : 'calc(100vh - 74px)', width: '100%', position: 'relative', overflow: 'hidden' }}>
          <GeoGuesserView
            allPeople={people}
            lang={lang}
            initialPersonId={geoGuesserPersonId}
            onInspectPerson={(person) => setInspectedPerson(person)}
            onBackToExplorer={() => setViewMode('timeline')}
          />
        </main>
      ) : viewMode === 'timeline' ? (
        <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.5rem', flex: 1, width: '100%' }}>
          <TimelineView people={people} lang={lang} onInspect={(person) => setInspectedPerson(person)} />
        </main>
      ) : (
        <>
          {/* Kontrollpanel (Sök & Filter) */}
          <div style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', padding: '1rem 1.5rem' }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Rad 1: Sökfält & Sortering */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 300px' }}>
                  <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder={isSv ? 'Sök på namn, yrke, ort, land eller verk (t.ex. Da Vinci, fysiker, Paris, Mona Lisa)...' : 'Search name, occupation, place, works...'}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setVisibleCount(24);
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 12px 9px 38px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: '#fff',
                      fontSize: '0.9rem',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{isSv ? 'Sortera:' : 'Sort:'}</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: '#fff',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <option value="fame">{isSv ? 'Kändisskap (Wikidata-sitelinks)' : 'Fame (Sitelinks)'}</option>
                    <option value="birth_asc">{isSv ? 'Födelseår (äldst först)' : 'Birth year (oldest first)'}</option>
                    <option value="birth_desc">{isSv ? 'Födelseår (nyast först)' : 'Birth year (newest first)'}</option>
                    <option value="name">{isSv ? 'Namn (A–Ö)' : 'Name (A–Z)'}</option>
                  </select>
                </div>
              </div>

              {/* Rad 2: Sekelflikar */}
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                {CENTURIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => {
                      setSelectedCentury(c.value);
                      setVisibleCount(24);
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '20px',
                      fontSize: '0.8rem',
                      fontWeight: selectedCentury === c.value ? 700 : 500,
                      background: selectedCentury === c.value ? 'var(--accent-blue)' : '#fff',
                      color: selectedCentury === c.value ? '#fff' : 'var(--text-secondary)',
                      border: '1px solid var(--border-color)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Rad 3: Snabbfilter (Nivå, Svensk, Levande) */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{isSv ? 'Filter:' : 'Filters:'}</span>

                {/* Nivå */}
                <button
                  onClick={() => setSelectedTier(selectedTier === 'all' ? 'guess' : selectedTier === 'guess' ? 'reference' : 'all')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: selectedTier === 'all' ? '#fff' : 'var(--tag-bg)',
                    fontWeight: 600,
                  }}
                >
                  {selectedTier === 'all' ? 'Alla nivåer' : selectedTier === 'guess' ? '🎯 Bara Gissnings-poolen' : '📚 Bara Referens-poolen'}
                </button>

                {/* Svensk */}
                <button
                  onClick={() => setOnlySwedish(!onlySwedish)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: onlySwedish ? '1px solid #137333' : '1px solid var(--border-color)',
                    background: onlySwedish ? '#e6f4ea' : '#fff',
                    color: onlySwedish ? '#137333' : 'inherit',
                    fontWeight: 600,
                  }}
                >
                  🇸🇪 {isSv ? 'Bara svenska personer' : 'Only Swedish'}
                </button>

                {/* Levande */}
                <button
                  onClick={() => setOnlyLiving(!onlyLiving)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: onlyLiving ? '1px solid #c5221f' : '1px solid var(--border-color)',
                    background: onlyLiving ? '#fce8e6' : '#fff',
                    color: onlyLiving ? '#c5221f' : 'inherit',
                    fontWeight: 600,
                  }}
                >
                  ❤️ {isSv ? 'Bara nu levande' : 'Only living'}
                </button>

                {/* Återställ-knapp */}
                {(search || selectedCentury !== 'all' || selectedTier !== 'all' || onlySwedish || onlyLiving) && (
                  <button
                    onClick={() => {
                      setSearch('');
                      setSelectedCentury('all');
                      setSelectedTier('all');
                      setOnlySwedish(false);
                      setOnlyLiving(false);
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'none',
                      color: 'var(--accent-red)',
                      fontWeight: 600,
                      textDecoration: 'underline',
                    }}
                  >
                    {isSv ? 'Rensa filter' : 'Clear filters'}
                  </button>
                )}

                <div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {isSv ? `Visar ${sortedPeople.length} av ${people.length} personer` : `Showing ${sortedPeople.length} of ${people.length} people`}
                </div>
              </div>
            </div>
          </div>

          {/* Huvudinnehåll: Kort-rutnät */}
          <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.5rem', flex: 1, width: '100%' }}>
        {sortedPeople.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-secondary)' }}>
            <Users size={48} style={{ color: 'var(--border-focus)', marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Inga personer matchade dina filter</h3>
            <p>Prova att rensa sökningen eller välja ett annat sekel.</p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '1.25rem',
              }}
            >
              {sortedPeople.slice(0, visibleCount).map((p) => (
                <PersonCard
                  key={p.id}
                  person={p}
                  allPeople={people}
                  lang={lang}
                  onInspect={(person) => setInspectedPerson(person)}
                />
              ))}
            </div>

            {/* "Visa fler"-knapp */}
            {visibleCount < sortedPeople.length && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2.5rem', marginBottom: '2rem' }}>
                <button
                  onClick={() => setVisibleCount((prev) => prev + 24)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-focus)',
                    background: '#fff',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <ChevronDown size={16} />
                  {isSv
                    ? `Visa fler personer (${visibleCount} av ${sortedPeople.length})`
                    : `Show more (${visibleCount} of ${sortedPeople.length})`}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  )}

      {/* Modal för detaljgranskning */}
      <PersonModal
        person={inspectedPerson}
        allPeople={people}
        lang={lang}
        onClose={() => setInspectedPerson(null)}
        onPlayGeoGuesser={(person) => {
          setGeoGuesserPersonId(person.id);
          setViewMode('geoguesser');
        }}
      />

      {/* Footer (visas i kortvy och tidslinje, men döljs i GeoGuesser för helskärmskarta) */}
      {viewMode !== 'geoguesser' && (
        <footer style={{ background: '#fff', borderTop: '1px solid var(--border-color)', padding: '1.5rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          <p>
            Data från <a href="https://www.wikidata.org" target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)' }}>Wikidata</a> (CC0 Public Domain).
            Bilder från Wikimedia Commons (se licens på respektive kort).
          </p>
        </footer>
      )}
    </div>
  );
};

import React, { useState, useEffect, useMemo } from 'react';
import { loc, type PeopleDataset, type Person, type Tier } from './types/person.ts';
import { PersonCard } from './components/PersonCard.tsx';
import { PersonModal } from './components/PersonModal.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';
import { TimelineView } from './components/TimelineView.tsx';
import { GeoGuesserView } from './components/GeoGuesserView.tsx';
import { Search, Shuffle, Users, ChevronDown, LayoutGrid, Clock, Compass } from 'lucide-react';

import { loadAppState, saveAppState } from './engine/sessionPersistence.ts';
import {
  loadProfileState,
  getActiveProfile,
  updateActiveProfile,
  createProfile,
  switchProfile,
  deleteProfile,
  recordRoundInState,
  recordMatchInState,
  importProfileData,
} from './engine/profileStore.ts';

const CENTURIES = [
  { labelSv: 'Alla epoker', labelEn: 'All eras', value: 'all' },
  { labelSv: 'Antiken (< 500)', labelEn: 'Antiquity (< 500)', value: 'antiquity' },
  { labelSv: '500–1200-talet', labelEn: '500–1200s', value: 'early' },
  { labelSv: '1300-talet', labelEn: '1300s', value: '1300' },
  { labelSv: '1400-talet', labelEn: '1400s', value: '1400' },
  { labelSv: '1500-talet', labelEn: '1500s', value: '1500' },
  { labelSv: '1600-talet', labelEn: '1600s', value: '1600' },
  { labelSv: '1700-talet', labelEn: '1700s', value: '1700' },
  { labelSv: '1800-talet', labelEn: '1800s', value: '1800' },
  { labelSv: '1900-talet', labelEn: '1900s', value: '1900' },
  { labelSv: '2000-talet', labelEn: '2000s', value: '2000' },
];

export const App: React.FC = () => {
  const [initialApp] = useState(() => loadAppState());
  const [profileState, setProfileState] = useState(() => loadProfileState());
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const activeProfile = useMemo(() => getActiveProfile(profileState), [profileState]);
  const solvedPersonIdsSet = useMemo(() => new Set(activeProfile.solvedPersonIds), [activeProfile.solvedPersonIds]);

  const [dataset, setDataset] = useState<PeopleDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<'sv' | 'en'>(() => initialApp.lang ?? 'sv');
  const [viewMode, setViewMode] = useState<'geoguesser' | 'timeline' | 'cards'>(() => initialApp.viewMode ?? 'geoguesser');
  const [geoGuesserPersonId, setGeoGuesserPersonId] = useState<string | null>(null);

  useEffect(() => {
    saveAppState({ lang, viewMode });
  }, [lang, viewMode]);

  // Filter-tillstånd
  const [search, setSearch] = useState('');
  const [selectedCentury, setSelectedCentury] = useState('all');
  const [selectedTier, setSelectedTier] = useState<'all' | Tier>('all');
  const [onlySwedish, setOnlySwedish] = useState(false);
  const [onlyLiving, setOnlyLiving] = useState(false);
  const [onlySolved, setOnlySolved] = useState(false);
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
    fetch('/data/people.json?v=2')
      .then((res) => {
        if (!res.ok) throw new Error(`Kunde inte läsa databasen (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: PeopleDataset) => {
        // Bakåtkompatibilitet om en äldre cachad people.json skulle ha 'easy'/'medium' som tier
        for (const p of data.people) {
          const rawTier = p.tier as string;
          if (rawTier === 'easy') p.tier = 'standard';
          else if (rawTier === 'medium') p.tier = 'hard';
        }
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
        const pName = loc(p.name, lang).toLowerCase();
        const pDesc = loc(p.description, lang).toLowerCase();
        const pBirthPlace = loc(p.birthPlace?.name, lang).toLowerCase();
        const pOcc = p.occupations.map((o) => loc(o.name, lang).toLowerCase()).join(' ');
        const pWorks = p.notableWorks.map((w) => loc(w.name, lang).toLowerCase()).join(' ');
        if (!pName.includes(q) && !pDesc.includes(q) && !pBirthPlace.includes(q) && !pOcc.includes(q) && !pWorks.includes(q)) {
          return false;
        }
      }

      // Sekelfilter
      if (selectedCentury !== 'all') {
        const by = p.birthDate.year;
        if (selectedCentury === 'antiquity') {
          if (by >= 500) return false;
        } else if (selectedCentury === 'early') {
          if (by < 500 || by >= 1300) return false;
        } else {
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

      // Lösta-filter
      if (onlySolved && !solvedPersonIdsSet.has(p.id)) return false;

      return true;
    });
  }, [people, search, selectedCentury, selectedTier, onlySwedish, onlyLiving, onlySolved, solvedPersonIdsSet, lang]);

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
        const na = loc(a.name, lang);
        const nb = loc(b.name, lang);
        return na.localeCompare(nb, lang);
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
          {isSv ? 'Laddar Wikidata-databasen...' : 'Loading Wikidata database...'}
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          {isSv ? 'Läser in 7 829 historiska personer...' : 'Loading 7,829 historical people...'}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-red)' }}>
        <h2>{isSv ? 'Ett fel uppstod vid inläsning' : 'An error occurred while loading'}</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Topp-header */}
      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid var(--border-color)',
          padding: isMobile ? '7px 10px' : '0.85rem 1.5rem',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: isMobile ? '8px' : '1rem' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '10px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: isMobile ? '28px' : '36px',
                  height: isMobile ? '28px' : '36px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                  color: '#fff',
                  fontSize: isMobile ? '0.95rem' : '1.15rem',
                  boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
                  flexShrink: 0,
                }}
              >
                {viewMode === 'geoguesser' ? '🧭' : viewMode === 'timeline' ? '⏳' : '🏛️'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h1
                    className="serif-font"
                    style={{
                      margin: 0,
                      fontSize: isMobile ? '1.05rem' : '1.35rem',
                      fontWeight: 900,
                      color: 'var(--text-primary)',
                      letterSpacing: '0.03em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    LIVSLINJEN
                  </h1>
                  {!isMobile && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 9px',
                        borderRadius: '999px',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        background:
                          viewMode === 'geoguesser'
                            ? '#dbeafe'
                            : viewMode === 'timeline'
                            ? '#fef3c7'
                            : '#f1f5f9',
                        color:
                          viewMode === 'geoguesser'
                            ? '#1e40af'
                            : viewMode === 'timeline'
                            ? '#92400e'
                            : '#334155',
                        border:
                          viewMode === 'geoguesser'
                            ? '1px solid #bfdbfe'
                            : viewMode === 'timeline'
                            ? '1px solid #fde68a'
                            : '1px solid #cbd5e1',
                      }}
                    >
                      {viewMode === 'geoguesser'
                        ? isSv
                          ? '🗺️ Geografisk Person-Gåta'
                          : '🗺️ Historical Geo-Mystery'
                        : viewMode === 'timeline'
                        ? isSv
                          ? '⏳ Interaktiv Tidslinje'
                          : '⏳ Interactive Timeline'
                        : isSv
                        ? '📚 Uppslagsverk'
                        : '📚 Encyclopedia'}
                    </span>
                  )}
                </div>
                {!isMobile && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {viewMode === 'geoguesser'
                      ? isSv
                        ? 'Följ livsresan på kartan och lista ut vem personen är med så få ledtrådar som möjligt'
                        : 'Follow the life journey on the map and deduce the mystery figure with minimal clues'
                      : viewMode === 'timeline'
                      ? isSv
                        ? 'Res genom historien år för år och se vilka kända personer som levde samtidigt'
                        : 'Travel through history year by year and see which famous figures lived at the same time'
                      : isSv
                      ? `Utforska och sök bland ${dataset?.counts.total?.toLocaleString('sv-SE') ?? '7 829'} historiska och nutida personer`
                      : `Explore and search ${dataset?.counts.total?.toLocaleString('en-US') ?? '7,829'} historical and contemporary figures`}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Visningsläge (Kort vs Tidslinje), Profilknapp, Språkväxlare & Slumpa-knapp */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '0.75rem', flexWrap: 'nowrap' }}>
            {/* Vy-väljare */}
            <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
              <button
                onClick={() => setViewMode('geoguesser')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  minHeight: isMobile ? '34px' : undefined,
                  padding: isMobile ? '6px 9px' : '7px 13px',
                  background: viewMode === 'geoguesser' ? 'var(--accent-blue)' : '#fff',
                  color: viewMode === 'geoguesser' ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  fontWeight: viewMode === 'geoguesser' ? 700 : 500,
                  fontSize: isMobile ? '0.78rem' : '0.85rem',
                }}
                title="GeoGuesser"
              >
                <Compass size={isMobile ? 14 : 15} />
                <span>{isMobile ? 'Geo' : 'GeoGuesser'}</span>
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  minHeight: isMobile ? '34px' : undefined,
                  padding: isMobile ? '6px 9px' : '7px 12px',
                  background: viewMode === 'timeline' ? 'var(--accent-blue)' : '#fff',
                  color: viewMode === 'timeline' ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderLeft: '1px solid var(--border-color)',
                  fontWeight: viewMode === 'timeline' ? 700 : 500,
                  fontSize: isMobile ? '0.78rem' : '0.85rem',
                }}
                title={isSv ? 'Tidslinje' : 'Timeline'}
              >
                <Clock size={isMobile ? 14 : 15} />
                <span>{isMobile ? 'Tid' : (isSv ? 'Tidslinje' : 'Timeline')}</span>
              </button>
              <button
                onClick={() => setViewMode('cards')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  minHeight: isMobile ? '34px' : undefined,
                  padding: isMobile ? '6px 9px' : '7px 12px',
                  background: viewMode === 'cards' ? 'var(--accent-blue)' : '#fff',
                  color: viewMode === 'cards' ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderLeft: '1px solid var(--border-color)',
                  fontWeight: viewMode === 'cards' ? 700 : 500,
                  fontSize: isMobile ? '0.78rem' : '0.85rem',
                }}
                title={isSv ? 'Kortvy' : 'Cards'}
              >
                <LayoutGrid size={isMobile ? 14 : 15} />
                <span>{isMobile ? 'Kort' : (isSv ? 'Kortvy' : 'Cards')}</span>
              </button>
            </div>

            {!isMobile && viewMode !== 'geoguesser' && (
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

            {/* Spelarprofil & Statistik-knapp */}
            <button
              onClick={() => setIsProfileModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? '5px' : '7px',
                minHeight: isMobile ? '34px' : undefined,
                padding: isMobile ? '5px 8px' : '6px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: '#f8fafc',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: isMobile ? '0.78rem' : '0.83rem',
                cursor: 'pointer',
              }}
              title={isSv ? 'Öppna spelarprofil, poäng & samling' : 'Open player profile, scores & collection'}
            >
              <span style={{ fontSize: isMobile ? '0.95rem' : '1.05rem' }}>{activeProfile.avatar}</span>
              {!isMobile && (
                <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeProfile.name}
                </span>
              )}
              <span
                style={{
                  background: '#dcfce7',
                  color: '#166534',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                }}
              >
                ✓ {activeProfile.solvedPersonIds.length}
              </span>
            </button>

            <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <button
                onClick={() => setLang('sv')}
                style={{
                  minHeight: isMobile ? '34px' : undefined,
                  padding: isMobile ? '6px 8px' : '6px 10px',
                  background: lang === 'sv' ? 'var(--tag-bg)' : '#fff',
                  border: 'none',
                  fontWeight: lang === 'sv' ? 700 : 400,
                  fontSize: isMobile ? '0.8rem' : '0.8rem',
                }}
                title="Svenska"
              >
                🇸🇪{isMobile ? '' : ' Svenska'}
              </button>
              <button
                onClick={() => setLang('en')}
                style={{
                  minHeight: isMobile ? '34px' : undefined,
                  padding: isMobile ? '6px 8px' : '6px 10px',
                  background: lang === 'en' ? 'var(--tag-bg)' : '#fff',
                  border: 'none',
                  fontWeight: lang === 'en' ? 700 : 400,
                  fontSize: isMobile ? '0.8rem' : '0.8rem',
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
            <span className="badge badge-ref">{isSv ? 'Totalt' : 'Total'}: {dataset?.counts.total}</span>
            <span className="badge badge-guess">⭐ {isSv ? 'Standard' : 'Standard'}: {dataset?.counts.standard}</span>
            <span className="badge badge-med">🔥 {isSv ? 'Svår' : 'Hard'}: {dataset?.counts.hard}</span>
            <span className="badge badge-ref">⚡ {isSv ? 'Mycket svår' : 'Very Hard'}: {dataset?.counts.very_hard}</span>
            <span className="badge badge-swedish">🇸🇪 {isSv ? 'Svenska' : 'Swedish'}: {dataset?.counts.swedish}</span>
            <span className="badge badge-living">❤️ {isSv ? 'Nu levande' : 'Living'}: {dataset?.counts.living}</span>
            <span className="badge badge-ref">🖼️ {isSv ? 'Med porträtt' : 'With portrait'}: {dataset?.counts.withImage}</span>
          </div>
        )}
      </header>

      {viewMode === 'geoguesser' ? (
        <main style={{ height: isMobile ? 'calc(100svh - 49px)' : 'calc(100vh - 74px)', width: '100%', position: 'relative', overflow: 'hidden' }}>
          <GeoGuesserView
            allPeople={people}
            lang={lang}
            initialPersonId={geoGuesserPersonId}
            solvedPersonIds={solvedPersonIdsSet}
            onRoundComplete={(round) => setProfileState((prev) => recordRoundInState(prev, round))}
            onMatchComplete={(match) => setProfileState((prev) => recordMatchInState(prev, match))}
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
                    {isSv ? c.labelSv : c.labelEn}
                  </button>
                ))}
              </div>

              {/* Rad 3: Snabbfilter (Nivå, Svensk, Levande, Lösta) */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{isSv ? 'Filter:' : 'Filters:'}</span>

                {/* Nivå */}
                <button
                  onClick={() =>
                    setSelectedTier(
                      selectedTier === 'all'
                        ? 'standard'
                        : selectedTier === 'standard'
                        ? 'hard'
                        : selectedTier === 'hard'
                        ? 'very_hard'
                        : 'all'
                    )
                  }
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: selectedTier === 'all' ? '#fff' : 'var(--tag-bg)',
                    fontWeight: 600,
                  }}
                >
                  {selectedTier === 'all'
                    ? (isSv ? 'Alla nivåer' : 'All tiers')
                    : selectedTier === 'standard'
                    ? (isSv ? '⭐ Bara Standard' : '⭐ Only Standard')
                    : selectedTier === 'hard'
                    ? (isSv ? '🔥 Bara Svår' : '🔥 Only Hard')
                    : (isSv ? '⚡ Bara Mycket svår' : '⚡ Only Very Hard')}
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

                {/* Upptäckta / Lösta i GeoGuesser */}
                <button
                  onClick={() => setOnlySolved(!onlySolved)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: onlySolved ? '1px solid #16a34a' : '1px solid var(--border-color)',
                    background: onlySolved ? '#dcfce7' : '#fff',
                    color: onlySolved ? '#166534' : 'inherit',
                    fontWeight: 600,
                  }}
                >
                  ✓ {isSv ? `Lösta i GeoGuesser (${solvedPersonIdsSet.size})` : `Solved (${solvedPersonIdsSet.size})`}
                </button>

                {/* Återställ-knapp */}
                {(search || selectedCentury !== 'all' || selectedTier !== 'all' || onlySwedish || onlyLiving || onlySolved) && (
                  <button
                    onClick={() => {
                      setSearch('');
                      setSelectedCentury('all');
                      setSelectedTier('all');
                      setOnlySwedish(false);
                      setOnlyLiving(false);
                      setOnlySolved(false);
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
                  isSolved={solvedPersonIdsSet.has(p.id)}
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

      {/* Modal för spelarprofil, poäng & samling */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        profileState={profileState}
        allPeople={people}
        lang={lang}
        onUpdateProfile={(updates) => setProfileState((prev) => updateActiveProfile(prev, updates))}
        onCreateProfile={(name, avatar) => setProfileState((prev) => createProfile(prev, name, avatar))}
        onSwitchProfile={(id) => setProfileState((prev) => switchProfile(prev, id))}
        onDeleteProfile={(id) => setProfileState((prev) => deleteProfile(prev, id))}
        onImportProfile={(jsonStr) => {
          const next = importProfileData(profileState, jsonStr);
          if (next) {
            setProfileState(next);
            return true;
          }
          return false;
        }}
        onInspectPerson={(person) => {
          setIsProfileModalOpen(false);
          setInspectedPerson(person);
        }}
      />

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

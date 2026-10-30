import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { loc, type Person } from '../types/person.ts';
import { Play, Pause, ChevronLeft, ChevronRight, ArrowDownCircle } from 'lucide-react';

interface TimelineViewProps {
  people: Person[];
  lang: 'sv' | 'en';
  onInspect: (person: Person) => void;
}

const HISTORIC_PRESETS = [
  { year: -44, label: '-44 (Julius Caesar)' },
  { year: 330, label: '330 (Konstantinopel)' },
  { year: 800, label: '800 (Karl den store)' },
  { year: 1066, label: '1066 (Slaget vid Hastings)' },
  { year: 1350, label: '1350 (Digerdöden)' },
  { year: 1453, label: '1453 (Konstantinopel faller)' },
  { year: 1492, label: '1492 (Columbus)' },
  { year: 1523, label: '1523 (Gustav Vasa)' },
  { year: 1632, label: '1632 (Lützen)' },
  { year: 1700, label: '1700 (Upplysningen)' },
  { year: 1789, label: '1789 (Franska rev.)' },
  { year: 1848, label: '1848 (Folkens vår)' },
  { year: 1914, label: '1914 (Första vk)' },
  { year: 1945, label: '1945 (Andra vk)' },
  { year: 1969, label: '1969 (Månen)' },
  { year: 2000, label: '2000 (Millennium)' },
];

const MIN_YEAR = -800;
const MAX_YEAR = 2026;
const ROW_HEIGHT = 44; // Höjd per personrad
const BUFFER_ROWS = 25; // Buffert för virtualiserad rendering

export const TimelineView: React.FC<TimelineViewProps> = ({ people, lang, onInspect }) => {
  const isSv = lang === 'sv';
  const currentYear = new Date().getFullYear();

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const SIDEBAR_WIDTH = isMobile ? 140 : 240;

  const [selectedYear, setSelectedYear] = useState<number>(1700);
  const [pxPerYear, setPxPerYear] = useState<number>(16); // Zoom (pixlar per år: 8, 16, 26)
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [onlySwedish, setOnlySwedish] = useState<boolean>(false);
  const [onlyGuessTier, setOnlyGuessTier] = useState<boolean>(true);
  const [filterMode, setFilterMode] = useState<'alive_and_nearby' | 'only_alive' | 'all'>('alive_and_nearby');
  const [search, setSearch] = useState<string>('');

  // Scroll-behållare
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(650);

  // Total bredd på tidsaxeln (inklusive namnkolumn)
  const timelineCanvasWidth = (MAX_YEAR - MIN_YEAR) * pxPerYear;
  const totalWidth = SIDEBAR_WIDTH + timelineCanvasWidth;

  const yearToPx = useCallback((year: number) => {
    return SIDEBAR_WIDTH + (year - MIN_YEAR) * pxPerYear;
  }, [SIDEBAR_WIDTH, pxPerYear]);

  const pxToYear = useCallback((px: number) => {
    const timelinePx = px - SIDEBAR_WIDTH;
    return Math.round(MIN_YEAR + timelinePx / pxPerYear);
  }, [SIDEBAR_WIDTH, pxPerYear]);

  // Sorterad och filtrerad lista över alla personer (FÖRST FÖDD LÄNGST UPP)
  const allSortedPeople = useMemo(() => {
    const list = people.filter((p) => {
      if (onlySwedish && !p.swedish) return false;
      if (onlyGuessTier && p.tier !== 'standard' && p.tier !== 'hard') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const name = loc(p.name, lang).toLowerCase();
        const occ = p.occupations.map((o) => loc(o.name, lang).toLowerCase()).join(' ');
        if (!name.includes(q) && !occ.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => a.birthDate.year - b.birthDate.year);
    return list;
  }, [people, onlySwedish, onlyGuessTier, search, lang]);

  // Filtrera baserat på visningsläge
  const filteredPeople = useMemo(() => {
    if (filterMode === 'all') return allSortedPeople;

    return allSortedPeople.filter((p) => {
      const b = p.birthDate.year;
      const d = p.deathDate?.year ?? currentYear;

      const isAlive = b <= selectedYear && d >= selectedYear;
      if (filterMode === 'only_alive') return isAlive;

      // 'alive_and_nearby': Levande + nyss avlidna (upp till 35 år sedan) + födda snart (upp till 35 år efter)
      const nearbyDead = d < selectedYear && d >= selectedYear - 35;
      const nearbyBorn = b > selectedYear && b <= selectedYear + 35;
      return isAlive || nearbyDead || nearbyBorn;
    });
  }, [allSortedPeople, filterMode, selectedYear, currentYear]);

  // Index för den första personen som faktiskt LEVDE valt år
  const firstLivingIndex = useMemo(() => {
    return filteredPeople.findIndex((p) => {
      const b = p.birthDate.year;
      const d = p.deathDate?.year ?? currentYear;
      return b <= selectedYear && d >= selectedYear;
    });
  }, [filteredPeople, selectedYear, currentYear]);

  // Antal levande valt år
  const aliveCount = useMemo(() => {
    return filteredPeople.filter((p) => {
      const b = p.birthDate.year;
      const d = p.deathDate?.year ?? currentYear;
      return b <= selectedYear && d >= selectedYear;
    }).length;
  }, [filteredPeople, selectedYear, currentYear]);

  // Scrolla direkt till första levande personen och centrera året horisontellt
  const scrollToLivingYear = useCallback((year: number, smooth = true) => {
    const el = containerRef.current;
    if (!el) return;

    // 1. Horisontell scroll: Centrera valt år i fönstret (med hänsyn till sidopanelen)
    const yearX = SIDEBAR_WIDTH + (year - MIN_YEAR) * pxPerYear;
    const targetScrollLeft = Math.max(0, yearX - el.clientWidth / 2);

    // 2. Vertikal scroll: Hitta första levande i den filtrerade listan
    const idx = filteredPeople.findIndex((p) => {
      const b = p.birthDate.year;
      const d = p.deathDate?.year ?? currentYear;
      return b <= year && d >= year;
    });

    const targetScrollTop = idx >= 0 ? Math.max(0, idx * ROW_HEIGHT - 40) : 0;

    el.scrollTo({
      left: targetScrollLeft,
      top: targetScrollTop,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, [pxPerYear, filteredPeople, currentYear]);

  const handleSelectYear = (year: number) => {
    setSelectedYear(year);
    setTimeout(() => scrollToLivingYear(year, true), 10);
  };

  useEffect(() => {
    scrollToLivingYear(selectedYear, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-play animation framåt i tiden
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSelectedYear((prev) => {
        if (prev >= currentYear) {
          setIsPlaying(false);
          return currentYear;
        }
        return prev + 1;
      });
    }, 180);
    return () => clearInterval(interval);
  }, [isPlaying, currentYear]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Virtuell fönster-beräkning
  const totalRows = filteredPeople.length;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  const visibleRows = filteredPeople.slice(startRow, endRow);

  // Klick på tidsaxeln
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const scrollX = containerRef.current?.scrollLeft ?? 0;
    const totalX = clickX + scrollX;
    if (totalX < SIDEBAR_WIDTH) return;
    const newYear = Math.max(MIN_YEAR, Math.min(MAX_YEAR, pxToYear(totalX)));
    handleSelectYear(newYear);
  };

  // Årstickor på x-axeln
  const ticks = useMemo(() => {
    const step = pxPerYear <= 10 ? 25 : pxPerYear <= 20 ? 10 : 5;
    const res: number[] = [];
    for (let y = MIN_YEAR; y <= MAX_YEAR; y += step) {
      res.push(y);
    }
    return res;
  }, [pxPerYear]);

  const selectedX = yearToPx(selectedYear);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Kontrollpanel */}
      <div
        style={{
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          padding: '1rem 1.25rem',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
        }}
      >
        {/* Rad 1: Årtal, Steg, Play/Paus & Hoppa till första levande */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: isPlaying ? '#9b2c2c' : '#c59b27',
                color: '#fff',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
              }}
              title={isPlaying ? 'Pausa' : 'Spela framåt'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: '2px' }} />}
            </button>

            <button
              onClick={() => handleSelectYear(Math.max(MIN_YEAR, selectedYear - 10))}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', fontSize: '0.82rem', fontWeight: 600 }}
            >
              -10 år
            </button>
            <button
              onClick={() => handleSelectYear(Math.max(MIN_YEAR, selectedYear - 1))}
              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff' }}
            >
              <ChevronLeft size={16} />
            </button>

            {/* Stort framhävt årtal */}
            <div style={{ textAlign: 'center', minWidth: '130px', padding: '0 6px' }}>
              <div
                className="serif-font"
                style={{
                  fontSize: '1.9rem',
                  fontWeight: 900,
                  color: 'var(--text-primary)',
                  letterSpacing: '0.04em',
                  lineHeight: 1,
                }}
              >
                {selectedYear < 0
                  ? `${Math.abs(selectedYear)} ${isSv ? 'f.Kr.' : 'BC'}`
                  : `${isSv ? 'År' : 'Year'} ${selectedYear}`}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#1E3A5F', fontWeight: 700, marginTop: '2px' }}>
                {aliveCount} {isSv ? 'personer levde då' : 'people alive'}
              </div>
            </div>

            <button
              onClick={() => handleSelectYear(Math.min(MAX_YEAR, selectedYear + 1))}
              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff' }}
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => handleSelectYear(Math.min(MAX_YEAR, selectedYear + 10))}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', fontSize: '0.82rem', fontWeight: 600 }}
            >
              +10 år
            </button>

            {/* Knapp: Scrolla till första levande */}
            <button
              onClick={() => scrollToLivingYear(selectedYear, true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '6px',
                background: '#ebf4ff',
                color: '#1E3A5F',
                border: '1px solid #c3dafe',
                fontSize: '0.82rem',
                fontWeight: 700,
                marginLeft: '6px',
              }}
              title="Scrolla vyn så att den första personen som faktiskt levde detta år hamnar överst"
            >
              <ArrowDownCircle size={15} />
              {isSv ? 'Gå till första levande' : 'Jump to first alive'}
            </button>
          </div>

          {/* Zoom & Tidslinjeläge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Zoom */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-subtle)', padding: '3px 6px', borderRadius: '6px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginRight: '2px' }}>
                Zoom:
              </span>
              {[
                { px: 8, label: 'Kompakt' },
                { px: 16, label: 'Normal' },
                { px: 26, label: 'Detaljerad' },
              ].map((z) => (
                <button
                  key={z.px}
                  onClick={() => {
                    setPxPerYear(z.px);
                    setTimeout(() => scrollToLivingYear(selectedYear, false), 50);
                  }}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: 'none',
                    background: pxPerYear === z.px ? '#fff' : 'transparent',
                    fontWeight: pxPerYear === z.px ? 700 : 500,
                    fontSize: '0.75rem',
                    boxShadow: pxPerYear === z.px ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  {z.label}
                </button>
              ))}
            </div>

            {/* Visningsläge */}
            <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
              <button
                onClick={() => setFilterMode('alive_and_nearby')}
                style={{
                  padding: '5px 10px',
                  background: filterMode === 'alive_and_nearby' ? 'var(--tag-bg)' : '#fff',
                  border: 'none',
                  fontWeight: filterMode === 'alive_and_nearby' ? 700 : 500,
                  fontSize: '0.78rem',
                }}
              >
                {isSv ? 'Levande + Grannar' : 'Living + Neighbors'}
              </button>
              <button
                onClick={() => setFilterMode('only_alive')}
                style={{
                  padding: '5px 10px',
                  background: filterMode === 'only_alive' ? 'var(--tag-bg)' : '#fff',
                  border: 'none',
                  fontWeight: filterMode === 'only_alive' ? 700 : 500,
                  fontSize: '0.78rem',
                }}
              >
                {isSv ? 'Endast levande' : 'Only living'}
              </button>
              <button
                onClick={() => setFilterMode('all')}
                style={{
                  padding: '5px 10px',
                  background: filterMode === 'all' ? 'var(--tag-bg)' : '#fff',
                  border: 'none',
                  fontWeight: filterMode === 'all' ? 700 : 500,
                  fontSize: '0.78rem',
                }}
              >
                {isSv ? 'Alla tider' : 'All history'}
              </button>
            </div>
          </div>
        </div>

        {/* Snabbval av historiska händelser */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {isSv ? 'Hoppa till:' : 'Presets:'}
          </span>
          {HISTORIC_PRESETS.map((p) => (
            <button
              key={p.year}
              onClick={() => handleSelectYear(p.year)}
              style={{
                padding: '3px 9px',
                borderRadius: '14px',
                background: selectedYear === p.year ? '#1E3A5F' : 'var(--bg-subtle)',
                color: selectedYear === p.year ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                fontSize: '0.74rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Färg-förklaring (Eleganta historiska nyanser) & Snabbfilter */}
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', fontSize: '0.78rem', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px dashed var(--border-color)' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Färgkoder:</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '14px', height: '10px', background: '#1E3A5F', borderRadius: '3px', border: '1px solid #4A90E2' }} />
            <span><strong>{isSv ? 'Levde under valt år (Preussisk marinblå)' : 'Alive in selected year'}</strong></span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '14px', height: '10px', background: '#96614F', borderRadius: '3px', opacity: 0.8 }} />
            <span>{isSv ? 'Dog före valt år (Antik terrakotta)' : 'Died before'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '14px', height: '10px', background: '#635374', borderRadius: '3px', opacity: 0.8 }} />
            <span>{isSv ? 'Föddes efter valt år (Mjuk ametist)' : 'Born after'}</span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={onlySwedish} onChange={(e) => setOnlySwedish(e.target.checked)} />
              🇸🇪 {isSv ? 'Endast svenska' : 'Only Swedish'}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={onlyGuessTier} onChange={(e) => setOnlyGuessTier(e.target.checked)} />
              🎯 {isSv ? 'Endast kända (Nivå 1)' : 'Only famous'}
            </label>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              ({filteredPeople.length} personer på tidslinjen)
            </span>
          </div>
        </div>
      </div>

      {/* 2D Oändligt scrollbar Tidslinje-canvas */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          height: '680px',
          background: '#faf7f0',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06)',
          overflowX: 'auto',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Hela tidslinjens inre canvas */}
        <div style={{ width: `${totalWidth}px`, height: `${totalRows * ROW_HEIGHT + 70}px`, position: 'relative' }}>
          {/* Klistrig tidsaxel (Sticky Time Axis) överst */}
          <div
            onClick={handleTimelineClick}
            style={{
              position: 'sticky',
              top: 0,
              width: `${totalWidth}px`,
              height: '44px',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(8px)',
              borderBottom: '2px solid #1E3A5F',
              zIndex: 50,
              cursor: 'crosshair',
              display: 'flex',
            }}
            title="Klicka var som helst på tidsaxeln för att flytta tidslinjen dit"
          >
            {/* Vänsterhörn för personkolumnen (Sticky) */}
            <div
              style={{
                position: 'sticky',
                left: 0,
                width: `${SIDEBAR_WIDTH}px`,
                minWidth: `${SIDEBAR_WIDTH}px`,
                height: '100%',
                background: '#f8f4ec',
                borderRight: '2px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                fontSize: '0.78rem',
                fontWeight: 800,
                color: 'var(--text-secondary)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                zIndex: 60,
                boxShadow: '2px 0 6px rgba(0,0,0,0.05)',
              }}
            >
              <span>👤 {isSv ? 'Historisk gestalt' : 'Historical figure'}</span>
            </div>

            {/* Årstickor på x-axeln */}
            <div style={{ position: 'relative', flex: 1, height: '100%' }}>
              {ticks.map((t) => {
                const x = (t - MIN_YEAR) * pxPerYear;
                const isCentury = t % 100 === 0;
                return (
                  <div
                    key={t}
                    style={{
                      position: 'absolute',
                      left: `${x}px`,
                      bottom: '2px',
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      style={{
                        fontSize: isCentury ? '0.78rem' : '0.68rem',
                        fontWeight: isCentury ? 800 : 500,
                        color: isCentury ? '#1E3A5F' : 'var(--text-muted)',
                      }}
                    >
                      {t < 0 ? `${Math.abs(t)} ${isSv ? 'f.Kr.' : 'BC'}` : t}
                    </span>
                    <div
                      style={{
                        width: '1px',
                        height: isCentury ? '8px' : '4px',
                        background: isCentury ? '#1E3A5F' : '#c5dac6',
                        marginTop: '2px',
                      }}
                    />
                  </div>
                );
              })}

              {/* Markörbricka för valt år på axeln */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(selectedYear - MIN_YEAR) * pxPerYear}px`,
                  top: '4px',
                  transform: 'translateX(-50%)',
                  background: '#b91c1c',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                  pointerEvents: 'none',
                }}
              >
                {selectedYear < 0
                  ? `${Math.abs(selectedYear)} ${isSv ? 'f.Kr.' : 'BC'}`
                  : `${isSv ? 'År' : 'Year'} ${selectedYear}`}
              </div>
            </div>
          </div>

          {/* Den vertikala tidsnålen ("Selected Year") genom hela höjden */}
          <div
            style={{
              position: 'absolute',
              left: `${selectedX}px`,
              top: '44px',
              bottom: 0,
              width: '2px',
              background: '#b91c1c',
              zIndex: 35,
              pointerEvents: 'none',
              boxShadow: '0 0 6px rgba(185, 28, 28, 0.45)',
            }}
          />

          {/* Virtuella rader för personerna */}
          {visibleRows.map((p, offsetIdx) => {
            const rowIndex = startRow + offsetIdx;
            const birth = p.birthDate.year;
            const death = p.deathDate?.year ?? currentYear;
            const isAliveAtSelected = birth <= selectedYear && death >= selectedYear;
            const isDeadBefore = death < selectedYear;
            const isBornAfter = birth > selectedYear;

            // Nya eleganta färgkoder
            let barBg = '#1E3A5F'; // Djup preussisk marinblå
            let barBorder = '1px solid rgba(74, 144, 226, 0.6)';
            let opacity = 1;
            let shadow = '0 2px 5px rgba(30, 58, 95, 0.35)';
            let dotColor = '#1E3A5F';

            if (isDeadBefore) {
              barBg = '#96614F'; // Antik terrakotta
              barBorder = '1px solid rgba(150, 97, 79, 0.4)';
              opacity = 0.75;
              shadow = 'none';
              dotColor = '#96614F';
            } else if (isBornAfter) {
              barBg = '#635374'; // Mjuk ametist / skiffer
              barBorder = '1px solid rgba(99, 83, 116, 0.4)';
              opacity = 0.75;
              shadow = 'none';
              dotColor = '#635374';
            }

            const startX = yearToPx(birth);
            const endX = yearToPx(death);
            const width = Math.max(70, endX - startX);

            const name = loc(p.name, lang, isSv ? 'Okänd' : 'Unknown');
            const ageAtSelected = isAliveAtSelected ? selectedYear - birth : null;

            return (
              <div
                key={p.id}
                style={{
                  position: 'absolute',
                  top: `${48 + rowIndex * ROW_HEIGHT}px`,
                  left: 0,
                  width: `${totalWidth}px`,
                  height: `${ROW_HEIGHT}px`,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {/* 1. KLISTRIG VÄNSTERKOLUMN: Alltid 100% synlig och läsbar oavsett horisontell scroll! */}
                <div
                  onClick={() => onInspect(p)}
                  style={{
                    position: 'sticky',
                    left: 0,
                    width: `${SIDEBAR_WIDTH}px`,
                    minWidth: `${SIDEBAR_WIDTH}px`,
                    height: '36px',
                    background: isAliveAtSelected ? '#f0f7ff' : '#fff',
                    borderRight: '2px solid var(--border-color)',
                    borderBottom: '1px solid #f0eae1',
                    zIndex: 40,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 10px',
                    gap: '8px',
                    boxShadow: '2px 0 6px rgba(0,0,0,0.04)',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fef9ec')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isAliveAtSelected ? '#f0f7ff' : '#fff')}
                  title={`Klicka för att inspektera ${name}`}
                >
                  {/* Status-dot */}
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: dotColor,
                      flexShrink: 0,
                      boxShadow: isAliveAtSelected ? '0 0 4px #3b82f6' : 'none',
                    }}
                  />

                  {/* Liten avatar */}
                  {p.image?.thumb ? (
                    <img
                      src={p.image.thumb}
                      alt=""
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        flexShrink: 0,
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: '#e2d8c7',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        flexShrink: 0,
                      }}
                    >
                      👤
                    </div>
                  )}

                  {/* Namn och levnadsår i den klistriga kolumnen */}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', whiteSpace: 'nowrap', lineHeight: 1.15 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span
                        style={{
                          fontWeight: isAliveAtSelected ? 800 : 600,
                          fontSize: '0.82rem',
                          color: isAliveAtSelected ? '#1E3A5F' : 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {name}
                      </span>
                      {p.swedish && <span style={{ fontSize: '0.7rem' }}>🇸🇪</span>}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {birth}–{p.deathDate ? death : 'nu'}
                      {isAliveAtSelected && (
                        <strong style={{ color: '#b45309', marginLeft: '4px' }}>
                          ({ageAtSelected} år då)
                        </strong>
                      )}
                    </span>
                  </div>
                </div>

                {/* 2. SJÄLVA TIDSLINJE-STAPELN PÅ X-AXELN */}
                <div
                  onClick={() => onInspect(p)}
                  style={{
                    position: 'absolute',
                    left: `${startX}px`,
                    width: `${width}px`,
                    height: '32px',
                    background: barBg,
                    border: barBorder,
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    color: '#fff',
                    boxShadow: shadow,
                    opacity,
                    cursor: 'pointer',
                    zIndex: isAliveAtSelected ? 20 : 10,
                    transition: 'transform 0.15s ease, opacity 0.15s ease',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.02)';
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.zIndex = '30';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.opacity = String(opacity);
                    e.currentTarget.style.zIndex = isAliveAtSelected ? '20' : '10';
                  }}
                  title={`${name} (${birth}–${death})`}
                >
                  {/* Klibbig text inuti stapeln som följer med vid horisontell scroll så den inte hamnar utanför skärmen */}
                  <div
                    style={{
                      position: 'sticky',
                      left: `${SIDEBAR_WIDTH + 10}px`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: '0.8rem', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      {name}
                    </span>

                    {/* Ålder vid valt år */}
                    {isAliveAtSelected && (
                      <span
                        style={{
                          background: 'rgba(0, 0, 0, 0.45)',
                          color: '#fef08a',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {ageAtSelected} år
                      </span>
                    )}

                    <span style={{ fontSize: '0.68rem', opacity: 0.8, flexShrink: 0 }}>
                      ({birth}–{p.deathDate ? death : 'nu'})
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

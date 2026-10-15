import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import type { Person } from '../types/person.ts';
import {
  Compass,
  Sparkles,
  Shuffle,
  CheckCircle2,
  XCircle,
  Eye,
  AlertTriangle,
  ArrowRight,
  Search,
  Flag,
  Briefcase,
  Award,
  BookOpen,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Maximize2,
  HelpCircle,
  X,
  Trophy,
  UserCheck,
  RotateCcw,
  Check,
  Flame,
  Medal,
  SlidersHorizontal,
} from 'lucide-react';

import { searchPeopleForgiving } from '../engine/fuzzySearch.ts';
import {
  getPersonWikipediaSummary,
  loadLocalWikipediaSummaries,
  type WikiSummaryData,
} from '../engine/wikipedia.ts';

interface GeoGuesserViewProps {
  allPeople: Person[];
  lang: 'sv' | 'en';
  initialPersonId?: string | null;
  onInspectPerson?: (person: Person) => void;
  onBackToExplorer?: () => void;
}

type ClueType =
  | 'gender'
  | 'occupation'
  | 'citizenship'
  | 'works'
  | 'description'
  | 'portrait'
  | 'wikiSummary';

const CLUE_COSTS: Record<ClueType, number> = {
  gender: 50,
  citizenship: 100,
  occupation: 150,
  wikiSummary: 250,
  works: 250,
  description: 100,
  portrait: 350,
};

const WRONG_GUESS_PENALTY = 100;
const MIN_ROUND_SCORE = 100;

interface MatchRoundResult {
  person: Person;
  score: number;
  isSolved: boolean;
  cluesUsed: ClueType[];
  wrongGuessesCount: number;
}

function haversineKm(coord1: [number, number], coord2: [number, number]): number {
  const [lat1, lon1] = coord1;
  const [lat2, lon2] = coord2;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function getGeodesicPath(p1: [number, number], p2: [number, number], numPoints = 30): [number, number][] {
  const [lat1, lon1] = p1;
  const [lat2, lon2] = p2;

  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  const phi1 = lat1 * toRad;
  const lambda1 = lon1 * toRad;
  const phi2 = lat2 * toRad;
  const lambda2 = lon2 * toRad;

  const dLambda = lambda2 - lambda1;
  const dPhi = phi2 - phi1;

  // Angulärt avstånd på sfären (Haversine)
  const sinHalfDPhi = Math.sin(dPhi / 2);
  const sinHalfDLambda = Math.sin(dLambda / 2);
  const a = sinHalfDPhi * sinHalfDPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfDLambda * sinHalfDLambda;
  const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  // Om orterna är extremt nära varandra (< 100m) räcker en rak linje
  if (d < 0.0001) {
    return [p1, p2];
  }

  const sinD = Math.sin(d);
  const points: [number, number][] = [];

  // Beräkna punkter längs jordens faktiska sfäriska geodet (storcirkel)
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / sinD;
    const B = Math.sin(f * d) / sinD;

    const x = A * Math.cos(phi1) * Math.cos(lambda1) + B * Math.cos(phi2) * Math.cos(lambda2);
    const y = A * Math.cos(phi1) * Math.sin(lambda1) + B * Math.cos(phi2) * Math.sin(lambda2);
    const z = A * Math.sin(phi1) + B * Math.sin(phi2);

    const phi = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lambda = Math.atan2(y, x);

    points.push([phi * toDeg, lambda * toDeg]);
  }

  return points;
}

const CENTURIES = [
  { label: 'Alla sekler', labelEn: 'All centuries', value: 'all' },
  { label: 'Före 1400', labelEn: 'Before 1400', value: 'early' },
  { label: '1400-talet', labelEn: '1400s', value: '1400' },
  { label: '1500-talet', labelEn: '1500s', value: '1500' },
  { label: '1600-talet', labelEn: '1600s', value: '1600' },
  { label: '1700-talet', labelEn: '1700s', value: '1700' },
  { label: '1800-talet', labelEn: '1800s', value: '1800' },
  { label: '1900-talet', labelEn: '1900s', value: '1900' },
  { label: '2000-talet', labelEn: '2000s', value: '2000' },
];

function matchesCentury(year: number, century: string): boolean {
  if (century === 'all') return true;
  if (century === 'early') return year < 1400;
  const cNum = parseInt(century, 10);
  return year >= cNum && year < cNum + 100;
}

export const GeoGuesserView: React.FC<GeoGuesserViewProps> = ({
  allPeople,
  lang,
  initialPersonId,
  onInspectPerson,
}) => {
  const isSv = lang === 'sv';
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Filter-tillstånd: Standard är 'guess' (Nivå 1: Mest kända personerna)
  const [selectedTier, setSelectedTier] = useState<'guess' | 'reference' | 'all'>('guess');
  const [selectedCentury, setSelectedCentury] = useState<string>('all');
  const [onlySwedish, setOnlySwedish] = useState<boolean>(false);
  const [requireBothCoords, setRequireBothCoords] = useState<boolean>(false);

  const eligiblePeople = useMemo(() => {
    return allPeople.filter((p) => {
      // 1. Nivå: Mest kända (guess) vs Referens (reference) vs Alla
      if (selectedTier !== 'all' && p.tier !== selectedTier) return false;

      // 2. Århundrade / Sekel
      if (!matchesCentury(p.birthDate.year, selectedCentury)) return false;

      // 3. Svensk koppling
      if (onlySwedish && !p.swedish) return false;

      // 4. Måste ha minst en koordinat för att kunna visas på kartan
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;

      // 5. Kräver hel resa med både födelse- och dödsort om aktiverat
      if (requireBothCoords && (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate))) return false;

      return true;
    });
  }, [allPeople, selectedTier, selectedCentury, onlySwedish, requireBothCoords]);

  // Current person
  const [currentPerson, setCurrentPerson] = useState<Person>(() => {
    if (initialPersonId) {
      const found = allPeople.find((p) => p.id === initialPersonId);
      if (found) return found;
    }
    const preferred =
      allPeople.find((p) => p.id === 'Q762' || p.id === 'Q55767') ||
      eligiblePeople[Math.floor(Math.random() * eligiblePeople.length)] ||
      allPeople[0]!;
    return preferred;
  });

  // Game state
  const [revealedClues, setRevealedClues] = useState<Set<ClueType>>(new Set());
  const [isSolved, setIsSolved] = useState(false);
  const [isSurrendered, setIsSurrendered] = useState(false);
  const [earnedRoundScore, setEarnedRoundScore] = useState<number | null>(null);
  const [deductionsAtEnd, setDeductionsAtEnd] = useState<{ cluesCost: number; wrongCost: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [wrongGuesses, setWrongGuesses] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [wikiData, setWikiData] = useState<WikiSummaryData | null>(null);
  const [wikiLoading, setWikiLoading] = useState<boolean>(false);

  // Match state (5 ronders spelomgång)
  const [isMatchActive, setIsMatchActive] = useState<boolean>(false);
  const [showMatchModal, setShowMatchModal] = useState<boolean>(false);
  const [matchRounds, setMatchRounds] = useState<Person[]>([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState<number>(0);
  const [matchResults, setMatchResults] = useState<MatchRoundResult[]>([]);
  const [isMatchSummaryOpen, setIsMatchSummaryOpen] = useState<boolean>(false);

  // Match setup form-tillstånd
  const [matchCentury, setMatchCentury] = useState<string>('all');
  const [matchTier, setMatchTier] = useState<'guess' | 'reference' | 'all'>('guess');
  const [matchOnlySwedish, setMatchOnlySwedish] = useState<boolean>(false);

  // Ladda in lokala Wikipedia-sammanfattningar i bakgrunden så de finns i minnet direkt
  useEffect(() => {
    loadLocalWikipediaSummaries();
  }, []);

  // UI state: whether the floating overlay sidebar is expanded or minimized
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Mobil-anpassat tillstånd
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [showMobileFilterModal, setShowMobileFilterModal] = useState(false);
  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(false);

  const touchStartYRef = useRef<number | null>(null);
  const touchStartScrollTopRef = useRef<number>(0);
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
    touchStartScrollTopRef.current = sheetScrollRef.current?.scrollTop ?? 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? 0;
    const deltaY = currentY - touchStartYRef.current;

    // När panelen är nere: svep UPPÅT (deltaY < -20) -> expandera ledtrådar mjukt
    if (deltaY < -20 && !isMobileSheetExpanded) {
      setIsMobileSheetExpanded(true);
      touchStartYRef.current = null;
    }
    // När panelen är uppe: svep NEDÅT (deltaY > 25) -> minimera tillbaka till kartan
    else if (deltaY > 25 && isMobileSheetExpanded && !isSolved && !isSurrendered) {
      if (touchStartScrollTopRef.current <= 0) {
        setIsMobileSheetExpanded(false);
        touchStartYRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartYRef.current = null;
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [48.8566, 2.3522],
      zoom: 4,
      zoomControl: false, // will add custom positioned zoom
      minZoom: 2,
      maxZoom: 18,
      zoomSnap: 0.1, // Mycket finfördelad zoom (inga stora hopp!)
      zoomDelta: 0.25, // Mjuka steg vid knappar
      wheelPxPerZoomLevel: 180, // Mjuk och precis zoomning med mushjul
    });

    // Zoom control at bottom left to avoid overlapping top bars
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Free tile layers: Esri World Topo Map & OpenStreetMap
    const topoLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri, DeLorme, USGS, NPS',
        maxZoom: 18,
      }
    );

    const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });

    topoLayer.addTo(map);

    L.control
      .layers(
        {
          [isSv ? '🗺️ Historisk Atlas (Esri)' : '🗺️ Historic Atlas (Esri)']: topoLayer,
          [isSv ? '🌐 Standardkarta (OSM)' : '🌐 Standard (OSM)']: osmLayer,
        },
        undefined,
        { position: 'bottomright' }
      )
      .addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapRef.current = map;

    const timer = setTimeout(() => {
      if (mapRef.current) {
        map.invalidateSize();
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, [isSv]);

  // Update markers and polyline when currentPerson changes
  useEffect(() => {
    const map = mapRef.current;
    const layers = layerGroupRef.current;
    if (!map || !layers) return;

    layers.clearLayers();

    const birthCoord = currentPerson.birthPlace?.coord;
    const deathCoord = currentPerson.deathPlace?.coord;

    const birthPlaceName =
      currentPerson.birthPlace?.name[lang] ||
      currentPerson.birthPlace?.name.sv ||
      currentPerson.birthPlace?.name.en ||
      (isSv ? 'Födelseort' : 'Birthplace');

    const deathPlaceName =
      currentPerson.deathPlace?.name[lang] ||
      currentPerson.deathPlace?.name.sv ||
      currentPerson.deathPlace?.name.en ||
      (isSv ? 'Dödsort' : 'Deathplace');

    const birthYear = currentPerson.birthDate.year;
    const deathYear = currentPerson.deathDate?.year;

    if (birthCoord && deathCoord) {
      const dist = haversineKm(birthCoord, deathCoord);

      if (dist < 8) {
        const mergedHtml = `
          <div class="geo-marker-container geo-marker-same">
            <div class="geo-marker-pill">
              <span class="pin-icon">🏛️</span>
              <span class="pin-place">${birthPlaceName}</span>
              <span class="pin-year">${birthYear} – ${deathYear ?? (isSv ? 'nu levande' : 'alive')}</span>
            </div>
            <div class="geo-marker-tip"></div>
            <div class="geo-marker-dot"></div>
          </div>
        `;
        const icon = L.divIcon({
          html: mergedHtml,
          className: 'custom-geo-marker',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        L.marker(birthCoord, { icon }).addTo(layers);
        map.setView(birthCoord, isMobile ? 4.5 : 5.0, { animate: true });
      } else {
        const birthHtml = `
          <div class="geo-marker-container geo-marker-birth">
            <div class="geo-marker-pill">
              <span class="pin-icon">🐣</span>
              <span class="pin-place">${birthPlaceName}</span>
              <span class="pin-year">${birthYear}</span>
            </div>
            <div class="geo-marker-tip"></div>
            <div class="geo-marker-dot"></div>
          </div>
        `;
        const birthIcon = L.divIcon({
          html: birthHtml,
          className: 'custom-geo-marker',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        L.marker(birthCoord, { icon: birthIcon }).addTo(layers);

        const deathHtml = `
          <div class="geo-marker-container geo-marker-death">
            <div class="geo-marker-pill">
              <span class="pin-icon">🪦</span>
              <span class="pin-place">${deathPlaceName}</span>
              <span class="pin-year">${deathYear ?? (isSv ? 'nu' : 'now')}</span>
            </div>
            <div class="geo-marker-tip"></div>
            <div class="geo-marker-dot"></div>
          </div>
        `;
        const deathIcon = L.divIcon({
          html: deathHtml,
          className: 'custom-geo-marker',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        L.marker(deathCoord, { icon: deathIcon }).addTo(layers);

        const curvePoints = getGeodesicPath(birthCoord, deathCoord);
        L.polyline(curvePoints, {
          color: '#c59b27',
          weight: 3.5,
          dashArray: '8, 8',
          opacity: 0.85,
        }).addTo(layers);

        // God marginal runt orterna så standardvyn är lagom utzoomad och visar omkringliggande länder/hav
        const bounds = L.latLngBounds([birthCoord, deathCoord]).pad(isMobile ? 0.95 : 0.8);
        map.fitBounds(bounds, {
          paddingTopLeft: isMobile ? [100, 25] : [70, 70],
          paddingBottomRight: isMobile ? [25, 140] : [390, 70],
          maxZoom: isMobile ? 4.6 : 5.2,
          animate: true,
        });
      }
    } else if (birthCoord) {
      const birthHtml = `
        <div class="geo-marker-container geo-marker-birth">
          <div class="geo-marker-pill">
            <span class="pin-icon">🐣</span>
            <span class="pin-place">${birthPlaceName}</span>
            <span class="pin-year">${birthYear}</span>
          </div>
          <div class="geo-marker-tip"></div>
          <div class="geo-marker-dot"></div>
        </div>
      `;
      const birthIcon = L.divIcon({
        html: birthHtml,
        className: 'custom-geo-marker',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker(birthCoord, { icon: birthIcon }).addTo(layers);
      map.setView(birthCoord, isMobile ? 4.2 : 4.8, { animate: true });
    } else if (deathCoord) {
      const deathHtml = `
        <div class="geo-marker-container geo-marker-death">
          <div class="geo-marker-pill">
            <span class="pin-icon">🪦</span>
            <span class="pin-place">${deathPlaceName}</span>
            <span class="pin-year">${deathYear ?? (isSv ? 'nu' : 'now')}</span>
          </div>
          <div class="geo-marker-tip"></div>
          <div class="geo-marker-dot"></div>
        </div>
      `;
      const deathIcon = L.divIcon({
        html: deathHtml,
        className: 'custom-geo-marker',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker(deathCoord, { icon: deathIcon }).addTo(layers);
      map.setView(deathCoord, isMobile ? 4.2 : 4.8, { animate: true });
    } else {
      map.setView([35, 15], 3, { animate: true });
    }
  }, [currentPerson, lang, isSv, isMobile]);

  const handleNextPerson = (specified?: Person) => {
    let next: Person;
    if (specified) {
      next = specified;
    } else {
      const candidates = eligiblePeople.filter((p) => p.id !== currentPerson.id);
      next = candidates[Math.floor(Math.random() * candidates.length)] || allPeople[0]!;
    }
    setCurrentPerson(next);
    setRevealedClues(new Set());
    setIsSolved(false);
    setIsSurrendered(false);
    setEarnedRoundScore(null);
    setDeductionsAtEnd(null);
    setSearchQuery('');
    setWrongGuesses([]);
    setShowSuggestions(false);
    setWikiData(null);
    setWikiLoading(false);
    setIsSidebarOpen(true);
    setIsMobileSheetExpanded(false);
  };

  const handleTierChange = (tier: 'guess' | 'reference' | 'all') => {
    setSelectedTier(tier);
    const candidates = allPeople.filter((p) => {
      if (tier !== 'all' && p.tier !== tier) return false;
      if (!matchesCentury(p.birthDate.year, selectedCentury)) return false;
      if (onlySwedish && !p.swedish) return false;
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;
      if (requireBothCoords && (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate))) return false;
      return true;
    });
    if (candidates.length > 0 && (tier !== 'all' && currentPerson.tier !== tier)) {
      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
    }
  };

  const handleCenturyChange = (century: string) => {
    setSelectedCentury(century);
    const candidates = allPeople.filter((p) => {
      if (selectedTier !== 'all' && p.tier !== selectedTier) return false;
      if (!matchesCentury(p.birthDate.year, century)) return false;
      if (onlySwedish && !p.swedish) return false;
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;
      if (requireBothCoords && (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate))) return false;
      return true;
    });
    if (candidates.length > 0 && !matchesCentury(currentPerson.birthDate.year, century)) {
      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
    }
  };

  const handleSwedishToggle = () => {
    const nextVal = !onlySwedish;
    setOnlySwedish(nextVal);
    if (nextVal && !currentPerson.swedish) {
      const candidates = allPeople.filter((p) => {
        if (selectedTier !== 'all' && p.tier !== selectedTier) return false;
        if (!matchesCentury(p.birthDate.year, selectedCentury)) return false;
        if (!p.swedish) return false;
        if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;
        return true;
      });
      if (candidates.length > 0) {
        handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
      }
    }
  };

  const toggleClue = (type: ClueType) => {
    setRevealedClues((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const currentPotentialScore = useMemo(() => {
    let base = currentPerson.tier === 'reference' ? 1200 : 1000;
    for (const clue of revealedClues) {
      base -= CLUE_COSTS[clue] ?? 100;
    }
    base -= wrongGuesses.length * WRONG_GUESS_PENALTY;
    return Math.max(MIN_ROUND_SCORE, base);
  }, [currentPerson, revealedClues, wrongGuesses]);

  const score = earnedRoundScore ?? (isSolved ? currentPotentialScore : 0);

  const handleSelectGuess = (person: Person) => {
    setShowSuggestions(false);
    setSearchQuery('');

    if (person.id === currentPerson.id) {
      const cluesCost = Array.from(revealedClues).reduce((sum, c) => sum + (CLUE_COSTS[c] ?? 0), 0);
      const wrongCost = wrongGuesses.length * WRONG_GUESS_PENALTY;
      const base = currentPerson.tier === 'reference' ? 1200 : 1000;
      const finalScore = Math.max(MIN_ROUND_SCORE, base - cluesCost - wrongCost);

      setEarnedRoundScore(finalScore);
      setDeductionsAtEnd({ cluesCost, wrongCost });
      setIsSolved(true);

      if (isMatchActive) {
        setMatchResults((prev) => [
          ...prev,
          {
            person: currentPerson,
            score: finalScore,
            isSolved: true,
            cluesUsed: Array.from(revealedClues),
            wrongGuessesCount: wrongGuesses.length,
          },
        ]);
      }

      // Avslöja alla ledtrådar för fri läsning efter rätt svar utan att påverka poängen
      setRevealedClues(new Set(['gender', 'occupation', 'citizenship', 'works', 'description', 'portrait', 'wikiSummary']));
      setIsSidebarOpen(true);
      setIsMobileSheetExpanded(true);
    } else {
      const guessedName = person.name[lang] || person.name.sv || person.name.en || 'Okänd';
      if (!wrongGuesses.includes(guessedName)) {
        setWrongGuesses((prev) => [...prev, guessedName]);
      }
    }
  };

  const startMatch = (century: string, tier: 'guess' | 'reference' | 'all', swedishOnly: boolean) => {
    const candidates = allPeople.filter((p) => {
      if (tier !== 'all' && p.tier !== tier) return false;
      if (!matchesCentury(p.birthDate.year, century)) return false;
      if (swedishOnly && !p.swedish) return false;
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;
      return true;
    });

    if (candidates.length < 5) {
      alert(isSv ? 'För få personer matchar filtret för en match på 5 ronder (behövs minst 5).' : 'Not enough people match the filter for a 5-round match (at least 5 needed).');
      return;
    }

    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    const five = shuffled.slice(0, 5);

    setSelectedCentury(century);
    setSelectedTier(tier);
    setOnlySwedish(swedishOnly);

    setMatchRounds(five);
    setCurrentRoundIndex(0);
    setMatchResults([]);
    setIsMatchActive(true);
    setIsMatchSummaryOpen(false);
    setShowMatchModal(false);

    handleNextPerson(five[0]);
  };

  const handleNextMatchRound = () => {
    if (currentRoundIndex < 4) {
      const nextIdx = currentRoundIndex + 1;
      setCurrentRoundIndex(nextIdx);
      handleNextPerson(matchRounds[nextIdx]);
    } else {
      setIsMatchSummaryOpen(true);
    }
  };

  const cancelMatch = () => {
    setIsMatchActive(false);
    setMatchRounds([]);
    setMatchResults([]);
    setCurrentRoundIndex(0);
    setIsMatchSummaryOpen(false);
  };

  const suggestions = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2 || isSolved || isSurrendered) return [];
    return searchPeopleForgiving(searchQuery, allPeople, 6);
  }, [searchQuery, allPeople, isSolved, isSurrendered]);

  // Hämta Wikipedia-ingress (lokalt i minnet eller fallback från API) när ledtråden öppnas eller när gåtan är avslutad
  useEffect(() => {
    if (!revealedClues.has('wikiSummary') && !isSolved && !isSurrendered) return;
    if (wikiData || wikiLoading) return;

    setWikiLoading(true);
    getPersonWikipediaSummary(currentPerson, lang)
      .then((data) => {
        if (data) setWikiData(data);
      })
      .finally(() => {
        setWikiLoading(false);
      });
  }, [revealedClues, isSolved, isSurrendered, currentPerson, lang, wikiData, wikiLoading]);

  const sanitizedWikiSummary = wikiData?.sanitized || '';
  const wikiSummary = wikiData?.raw || null;
  const wikiTitle = wikiData?.title || currentPerson.wiki[lang] || currentPerson.wiki.sv || currentPerson.wiki.en;
  const wikiDomain = wikiData?.lang || (currentPerson.wiki[lang] || currentPerson.wiki.sv ? 'sv' : 'en');
  const wikiUrl = wikiTitle
    ? `https://${wikiDomain}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`
    : undefined;

  // Data helpers
  const name = currentPerson.name[lang] || currentPerson.name.sv || currentPerson.name.en || 'Okänd';
  const desc = currentPerson.description[lang] || currentPerson.description.sv || currentPerson.description.en || '';
  const birthPlace = currentPerson.birthPlace;
  const deathPlace = currentPerson.deathPlace;
  const birthCoord = birthPlace?.coord;
  const deathCoord = deathPlace?.coord;
  const birthYear = currentPerson.birthDate.year;
  const deathYear = currentPerson.deathDate?.year;
  const isLiving = !deathYear;
  const lifespan = deathYear ? deathYear - birthYear : new Date().getFullYear() - birthYear;
  const distanceKm = birthCoord && deathCoord ? haversineKm(birthCoord, deathCoord) : null;

  const occupations = currentPerson.occupations
    .map((o) => o.name[lang] || o.name.sv || o.name.en)
    .filter(Boolean);
  const citizenship = currentPerson.citizenship
    .map((c) => c.name[lang] || c.name.sv || c.name.en)
    .filter(Boolean);
  const works = currentPerson.notableWorks
    .map((w) => w.name[lang] || w.name.sv || w.name.en)
    .filter(Boolean);

  const matchCandidatesCount = useMemo(() => {
    return allPeople.filter((p) => {
      if (matchTier !== 'all' && p.tier !== matchTier) return false;
      if (!matchesCentury(p.birthDate.year, matchCentury)) return false;
      if (matchOnlySwedish && !p.swedish) return false;
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;
      return true;
    }).length;
  }, [allPeople, matchTier, matchCentury, matchOnlySwedish]);

  const getClueActionLabel = (clue: ClueType, cost: number) => {
    const isRev = revealedClues.has(clue);
    if (isSolved || isSurrendered) {
      return isRev ? (isSv ? 'Dölj' : 'Hide') : (isSv ? 'Visa' : 'Show');
    }
    return isRev ? (isSv ? 'Dölj' : 'Hide') : `${isSv ? 'Avslöja' : 'Reveal'} (-${cost} p)`;
  };

  const getClueActionColor = (clue: ClueType) => {
    if (revealedClues.has(clue)) return 'var(--text-muted)';
    if (isSolved || isSurrendered) return 'var(--accent-blue)';
    return 'var(--accent-gold-dark)';
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 1. HELDÄCKANDE KARTA (100% AV YTAN) */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', zIndex: 1 }} />

      {/* 2. TOPP-MITTEN OVERLAY: KOMPAKT FAKTA-HUD */}
      <div
        style={{
          position: 'absolute',
          top: isMobile ? '6px' : '14px',
          left: isMobile ? '8px' : '50%',
          right: isMobile ? '8px' : 'auto',
          transform: isMobile ? 'none' : 'translateX(-50%)',
          zIndex: 1000,
          pointerEvents: 'none',
          maxWidth: isMobile ? '100%' : '92vw',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            background: '#ffffff',
            padding: isMobile ? '6px 12px' : '9px 20px',
            borderRadius: '999px',
            border: '2px solid #cbd5e1',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: isMobile ? '6px' : '12px',
            fontSize: isMobile ? '0.8rem' : '0.88rem',
            whiteSpace: 'nowrap',
            width: isMobile ? '100%' : 'auto',
            overflow: 'hidden',
          }}
        >
          {/* Född */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              minWidth: 0,
              background: '#f0fdf4',
              border: '1px solid #86efac',
              padding: isMobile ? '3px 8px' : '4px 10px',
              borderRadius: '999px',
            }}
          >
            <span style={{ fontSize: isMobile ? '0.82rem' : '0.95rem' }}>🐣</span>
            <strong style={{ color: '#166534', fontWeight: 900, fontSize: isMobile ? '0.86rem' : '0.94rem' }}>
              {birthYear}
            </strong>
            <span
              style={{
                color: '#0f172a',
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: isMobile ? '90px' : 'none',
              }}
            >
              {birthPlace
                ? birthPlace.name[lang] || birthPlace.name.sv || birthPlace.name.en
                : (isSv ? 'Okänd ort' : 'Unknown')}
            </span>
          </div>

          <span style={{ color: '#94a3b8', fontWeight: 900, fontSize: isMobile ? '0.82rem' : '0.95rem' }}>➔</span>

          {/* Död */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              minWidth: 0,
              background: isLiving ? '#fff1f2' : '#fef2f2',
              border: isLiving ? '1px solid #fecdd3' : '1px solid #fecaca',
              padding: isMobile ? '3px 8px' : '4px 10px',
              borderRadius: '999px',
            }}
          >
            <span style={{ fontSize: isMobile ? '0.82rem' : '0.95rem' }}>{isLiving ? '❤️' : '🪦'}</span>
            <strong
              style={{
                color: isLiving ? '#be123c' : '#991b1b',
                fontWeight: 900,
                fontSize: isMobile ? '0.86rem' : '0.94rem',
              }}
            >
              {isLiving ? (isSv ? 'Levande' : 'Alive') : deathYear}
            </strong>
            {!isLiving && (
              <span
                style={{
                  color: '#0f172a',
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: isMobile ? '90px' : 'none',
                }}
              >
                {deathPlace
                  ? deathPlace.name[lang] || deathPlace.name.sv || deathPlace.name.en
                  : (isSv ? 'Okänd ort' : 'Unknown')}
              </span>
            )}
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '16px', background: '#cbd5e1', flexShrink: 0 }} />

          {/* Livslängd & Sträcka */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
            <span
              style={{
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                color: '#1e40af',
                padding: '3px 8px',
                borderRadius: '999px',
                fontWeight: 800,
                fontSize: isMobile ? '0.76rem' : '0.82rem',
              }}
            >
              {lifespan} {isSv ? 'år' : 'yr'}
            </span>
            {!isMobile && distanceKm !== null && (
              <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 700 }}>
                {distanceKm === 0 ? (isSv ? 'Samma ort' : 'Same city') : `${distanceKm.toLocaleString('sv-SE')} km`}
              </span>
            )}
          </div>
        </div>

        {/* Varning om en ort saknar koordinater */}
        {(!birthCoord || (!deathCoord && !isLiving)) && (
          <div
            style={{
              pointerEvents: 'auto',
              background: 'rgba(254, 243, 199, 0.95)',
              color: '#92400e',
              border: '1px solid #fde68a',
              padding: isMobile ? '2px 8px' : '4px 12px',
              borderRadius: '999px',
              fontSize: isMobile ? '0.68rem' : '0.74rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <AlertTriangle size={12} />
            <span>
              {!birthCoord && !deathCoord
                ? (isSv ? 'Inga koordinater' : 'No coordinates')
                : !birthCoord
                ? (isSv ? `"${birthPlace?.name.sv}" saknar koordinater` : 'Birthplace lacks coords')
                : (isSv ? `"${deathPlace?.name.sv}" saknar koordinater` : 'Deathplace lacks coords')}
            </span>
          </div>
        )}
      </div>

      {/* 3. SNABBKONTROLLER & FILTER (MOBIL vs DESKTOP) */}
      {isMobile ? (
        <div
          style={{
            position: 'absolute',
            top: '42px',
            left: '8px',
            right: '8px',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', gap: '5px', pointerEvents: 'auto' }}>
            {/* Filter-knapp med indikator om aktiva filter */}
            <button
              onClick={() => setShowMobileFilterModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 9px',
                borderRadius: '999px',
                background: (selectedCentury !== 'all' || selectedTier !== 'guess' || onlySwedish || requireBothCoords)
                  ? 'var(--accent-blue)'
                  : 'rgba(255, 255, 255, 0.94)',
                color: (selectedCentury !== 'all' || selectedTier !== 'guess' || onlySwedish || requireBothCoords)
                  ? '#fff'
                  : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                fontWeight: 700,
                fontSize: '0.74rem',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                cursor: 'pointer',
              }}
            >
              <SlidersHorizontal size={12} />
              <span>{isSv ? 'Filter' : 'Filters'}</span>
              {(selectedCentury !== 'all' || selectedTier !== 'guess' || onlySwedish || requireBothCoords) && (
                <span
                  style={{
                    background: '#fbbf24',
                    borderRadius: '50%',
                    width: '6px',
                    height: '6px',
                    display: 'inline-block',
                  }}
                />
              )}
            </button>

            {/* Ny gåta */}
            <button
              onClick={() => handleNextPerson()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 9px',
                borderRadius: '999px',
                background: 'rgba(255, 255, 255, 0.94)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                fontWeight: 700,
                fontSize: '0.74rem',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                cursor: 'pointer',
              }}
            >
              <Shuffle size={12} style={{ color: 'var(--accent-gold)' }} />
              <span>{isSv ? 'Ny' : 'New'}</span>
            </button>
          </div>

          {/* Match-knapp */}
          <button
            onClick={() => {
              if (isMatchActive) {
                if (confirm(isSv ? 'Avbryta matchen?' : 'Cancel match?')) {
                  cancelMatch();
                }
              } else {
                setMatchCentury(selectedCentury);
                setMatchTier(selectedTier);
                setMatchOnlySwedish(onlySwedish);
                setShowMatchModal(true);
              }
            }}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '5px 9px',
              borderRadius: '999px',
              background: isMatchActive ? 'linear-gradient(135deg, #1e3a8a, #2563eb)' : 'rgba(255, 255, 255, 0.94)',
              color: isMatchActive ? '#fff' : '#1e3a8a',
              border: isMatchActive ? 'none' : '1.5px solid #2563eb',
              fontWeight: 800,
              fontSize: '0.74rem',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              cursor: 'pointer',
            }}
          >
            <Trophy size={12} style={{ color: isMatchActive ? '#fbbf24' : '#2563eb' }} />
            <span>{isMatchActive ? `${currentRoundIndex + 1}/5` : (isSv ? 'Match' : 'Match')}</span>
          </button>
        </div>
      ) : (
        /* Desktop: Den kompletta raden med alla kontroller */
        <div
          style={{
            position: 'absolute',
            top: '14px',
            left: '14px',
            zIndex: 1000,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.94)',
            backdropFilter: 'blur(12px)',
            padding: '6px 10px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            maxWidth: 'calc(100vw - 420px)',
          }}
        >
          {/* Nivå 1 (Mest kända) vs Nivå 2 (Referens/Svårare) vs Alla */}
          <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
            <button
              onClick={() => handleTierChange('guess')}
              style={{
                padding: '5px 9px',
                background: selectedTier === 'guess' ? 'var(--accent-blue)' : '#fff',
                color: selectedTier === 'guess' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                fontWeight: selectedTier === 'guess' ? 800 : 500,
                fontSize: '0.76rem',
              }}
              title={isSv ? 'Nivå 1: Mest kända personerna (Rekommenderat!)' : 'Tier 1: Most famous'}
            >
              ⭐ {isSv ? 'Nivå 1: Kända' : 'Tier 1: Famous'}
            </button>
            <button
              onClick={() => handleTierChange('reference')}
              style={{
                padding: '5px 9px',
                background: selectedTier === 'reference' ? 'var(--accent-blue)' : '#fff',
                color: selectedTier === 'reference' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderLeft: '1px solid var(--border-color)',
                fontWeight: selectedTier === 'reference' ? 800 : 500,
                fontSize: '0.76rem',
              }}
              title={isSv ? 'Nivå 2: Fördjupad referenspool (Svårare personer)' : 'Tier 2: Reference (Harder)'}
            >
              📚 {isSv ? 'Nivå 2: Svårare' : 'Tier 2'}
            </button>
            <button
              onClick={() => handleTierChange('all')}
              style={{
                padding: '5px 9px',
                background: selectedTier === 'all' ? 'var(--accent-blue)' : '#fff',
                color: selectedTier === 'all' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderLeft: '1px solid var(--border-color)',
                fontWeight: selectedTier === 'all' ? 800 : 500,
                fontSize: '0.76rem',
              }}
              title={isSv ? 'Alla personer (både kända och fördjupade)' : 'All people'}
            >
              {isSv ? 'Alla' : 'All'}
            </button>
          </div>

          {/* Århundrade / Sekel Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <select
              value={selectedCentury}
              onChange={(e) => handleCenturyChange(e.target.value)}
              style={{
                padding: '5px 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: selectedCentury !== 'all' ? 'var(--tag-bg)' : '#fff',
                color: 'var(--text-primary)',
                fontWeight: 700,
                fontSize: '0.76rem',
                cursor: 'pointer',
                outline: 'none',
              }}
              title={isSv ? 'Filtrera på personens födelsesekel' : 'Filter by birth century'}
            >
              {CENTURIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {isSv ? c.label : c.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Svensk filter-knapp */}
          <button
            onClick={handleSwedishToggle}
            style={{
              padding: '5px 9px',
              borderRadius: '6px',
              border: onlySwedish ? '1px solid #137333' : '1px solid var(--border-color)',
              background: onlySwedish ? '#e6f4ea' : '#fff',
              color: onlySwedish ? '#137333' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.76rem',
            }}
            title={isSv ? 'Bara personer med svensk koppling' : 'Only Swedish people'}
          >
            🇸🇪 {isSv ? 'Sverige' : 'Sweden'}
          </button>

          {/* Hel resa filter-knapp */}
          <button
            onClick={() => {
              const nextVal = !requireBothCoords;
              setRequireBothCoords(nextVal);
              if (nextVal && (!currentPerson.birthPlace?.coord || (!currentPerson.deathPlace?.coord && currentPerson.deathDate))) {
                const candidates = allPeople.filter((p) => {
                  if (selectedTier !== 'all' && p.tier !== selectedTier) return false;
                  if (!matchesCentury(p.birthDate.year, selectedCentury)) return false;
                  if (onlySwedish && !p.swedish) return false;
                  if (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate)) return false;
                  return true;
                });
                if (candidates.length > 0) {
                  handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
                }
              }
            }}
            style={{
              padding: '5px 9px',
              borderRadius: '6px',
              border: requireBothCoords ? '1px solid var(--border-focus)' : '1px solid var(--border-color)',
              background: requireBothCoords ? '#fef3c7' : '#fff',
              color: requireBothCoords ? '#92400e' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '0.76rem',
            }}
            title={isSv ? 'Kräver både födelse- och dödsort på kartan' : 'Require both coords on map'}
          >
            🗺️ {isSv ? 'Hel resa' : 'Full journey'}
          </button>

          {/* Antal matchande personer */}
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            ({eligiblePeople.length} {isSv ? 'st' : ''})
          </span>

          {/* Ny gåta-knapp */}
          <button
            onClick={() => handleNextPerson()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '5px 11px',
              borderRadius: '6px',
              background: 'var(--accent-gold)',
              color: '#fff',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.78rem',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(197, 155, 39, 0.3)',
            }}
            title={isSv ? 'Slumpa en ny person utifrån dina filter' : 'New random mystery person'}
          >
            <Shuffle size={13} />
            {isSv ? 'Ny gåta' : 'New'}
          </button>

          {/* Spela match-knapp */}
          <button
            onClick={() => {
              if (isMatchActive) {
                if (confirm(isSv ? 'Vill du avbryta den pågående matchen?' : 'Do you want to cancel the active match?')) {
                  cancelMatch();
                }
              } else {
                setMatchCentury(selectedCentury);
                setMatchTier(selectedTier);
                setMatchOnlySwedish(onlySwedish);
                setShowMatchModal(true);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 11px',
              borderRadius: '6px',
              background: isMatchActive ? 'linear-gradient(135deg, #1e3a8a, #2563eb)' : '#fff',
              color: isMatchActive ? '#fff' : '#1e3a8a',
              border: isMatchActive ? 'none' : '1.5px solid #2563eb',
              fontWeight: 800,
              fontSize: '0.78rem',
              cursor: 'pointer',
              boxShadow: isMatchActive ? '0 2px 6px rgba(37, 99, 235, 0.35)' : 'none',
            }}
            title={isSv ? 'Starta eller hantera en match med 5 gåtor' : 'Start or manage a 5-round match'}
          >
            <Trophy size={13} style={{ color: isMatchActive ? '#fbbf24' : '#2563eb' }} />
            {isMatchActive
              ? (isSv ? `Match (${currentRoundIndex + 1}/5)` : `Match (${currentRoundIndex + 1}/5)`)
              : (isSv ? '🏆 Spela match (5 gåtor)' : '🏆 Play match (5 rounds)')}
          </button>
        </div>
      )}

      {/* 4. FLYTANDE SIDOPANEL / OVERLAY (HÖGER SIDA PÅ DESKTOP / BOTTOM SHEET PÅ MOBIL): GISSA & LEDTRÅDAR */}
      {isSidebarOpen ? (
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            position: 'absolute',
            ...(isMobile
              ? {
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '78vh',
                  maxHeight: '78vh',
                  transform: (isSolved || isSurrendered || isMobileSheetExpanded)
                    ? 'translateY(0)'
                    : 'translateY(calc(78vh - 110px))',
                  transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  willChange: 'transform',
                  width: '100%',
                  maxWidth: '100vw',
                  borderRadius: '20px 20px 0 0',
                  boxShadow: '0 -8px 32px rgba(0, 0, 0, 0.22)',
                }
              : {
                  top: '14px',
                  right: '14px',
                  bottom: '14px',
                  width: '385px',
                  maxWidth: 'calc(100vw - 28px)',
                  borderRadius: '16px',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.18)',
                }),
            zIndex: 1000,
            background: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            overflow: isMobile && !isMobileSheetExpanded ? 'visible' : 'hidden',
          }}
        >
          {/* Mobil drag handle */}
          {isMobile && (
            <div
              onClick={() => {
                if (!isSolved && !isSurrendered) {
                  setIsMobileSheetExpanded(!isMobileSheetExpanded);
                }
              }}
              style={{
                width: '100%',
                padding: '8px 0 3px',
                display: 'flex',
                justifyContent: 'center',
                cursor: 'pointer',
                background: '#faf6ed',
              }}
            >
              <div style={{ width: '42px', height: '4px', borderRadius: '3px', background: '#cbd5e1' }} />
            </div>
          )}

          {/* Header på overlay-panelen */}
          <div
            style={{
              padding: isMobile ? '7px 12px' : '12px 16px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#faf6ed',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <Compass size={isMobile ? 15 : 17} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
              <span style={{ fontWeight: 800, fontSize: isMobile ? '0.84rem' : '0.92rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isSolved
                  ? (isSv ? '🎉 Rätt svar!' : '🎉 Correct!')
                  : isSurrendered
                  ? (isSv ? 'Svar avslöjat' : 'Answer')
                  : (isSv ? 'Vem är personen?' : 'Who is this person?')}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              {/* Aktuell vinst eller slutpoäng integrerad direkt i headern! */}
              {!isSolved && !isSurrendered ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    borderRadius: '999px',
                    background: '#fff9e6',
                    border: '1.5px solid #fbbf24',
                    color: '#92400e',
                    fontWeight: 800,
                    fontSize: isMobile ? '0.76rem' : '0.82rem',
                    boxShadow: '0 1px 3px rgba(217,119,6,0.1)',
                  }}
                  title={isSv ? 'Aktuell vinst vid rätt svar' : 'Potential score'}
                >
                  <Sparkles size={11} style={{ color: '#d97706' }} />
                  <span>{currentPotentialScore} p</span>
                </div>
              ) : isSolved ? (
                <span className="badge badge-swedish" style={{ fontSize: '0.74rem', fontWeight: 800 }}>
                  +{score} p
                </span>
              ) : null}

              {isMobile ? (
                isMobileSheetExpanded || isSolved || isSurrendered ? (
                  <button
                    onClick={() => setIsMobileSheetExpanded(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      color: 'var(--accent-blue)',
                      padding: '3px 7px',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Minimera till kartan (eller svep ned)' : 'Back to map (or swipe down)'}
                  >
                    <span>{isSv ? 'Karta' : 'Map'}</span>
                    <ChevronDown size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => setIsMobileSheetExpanded(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1d4ed8',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Visa ledtrådar (eller svep upp)' : 'View clues (or swipe up)'}
                  >
                    <span>{isSv ? `Ledtrådar (${revealedClues.size}/7)` : `Clues (${revealedClues.size}/7)`}</span>
                    <ChevronUp size={13} />
                  </button>
                )
              ) : (
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px',
                    borderRadius: '4px',
                  }}
                  title={isSv ? 'Minimera panelen för att se mer av kartan' : 'Minimize panel'}
                >
                  <Minimize2 size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Fast sökfält ovanför scrollen så det aldrig klipper förslag eller försvinner */}
          {!isSolved && !isSurrendered && (
            <div
              style={{
                padding: isMobile ? '8px 12px 6px' : '10px 16px 8px',
                background: '#ffffff',
                borderBottom: '1px solid var(--border-color)',
                position: 'relative',
                zIndex: 500,
              }}
            >
              <div style={{ position: 'relative' }}>
                <Search
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                  placeholder={isSv ? 'Gissa vem personen är...' : 'Guess who it is...'}
                  style={{
                    width: '100%',
                    padding: '8px 32px 8px 36px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--border-focus)',
                    fontSize: '0.88rem',
                    outline: 'none',
                    background: '#fff',
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      padding: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              {/* Autocomplete-dropdown: flyter uppåt över kartan när panelen är nere, nedåt när den är uppe */}
              {showSuggestions && suggestions.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    ...(isMobile && !isMobileSheetExpanded
                      ? { bottom: 'calc(100% + 6px)' }
                      : { top: 'calc(100% + 4px)' }),
                    left: isMobile ? '12px' : '16px',
                    right: isMobile ? '12px' : '16px',
                    background: '#ffffff',
                    borderRadius: '12px',
                    border: '2px solid var(--accent-blue)',
                    boxShadow: isMobile && !isMobileSheetExpanded
                      ? '0 -10px 32px rgba(0, 0, 0, 0.35)'
                      : '0 12px 32px rgba(0, 0, 0, 0.28)',
                    zIndex: 9999,
                    maxHeight: isMobile ? '200px' : '230px',
                    overflowY: 'auto',
                  }}
                >
                  {suggestions.map((p) => {
                    const pName = p.name[lang] || p.name.sv || p.name.en || 'Okänd';
                    const pOcc = p.occupations[0]
                      ? p.occupations[0].name[lang] || p.occupations[0].name.sv || p.occupations[0].name.en
                      : null;
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleSelectGuess(p)}
                        style={{
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          background: '#ffffff',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>👤</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>{pName}</div>
                            {pOcc && (
                              <div style={{ fontSize: '0.76rem', color: '#2563eb', fontWeight: 600 }}>
                                {pOcc}
                              </div>
                            )}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 700, flexShrink: 0 }}>
                          {p.birthDate.year}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Felgissningar som små chips direkt under sökfältet */}
              {wrongGuesses.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                  {wrongGuesses.map((wg, idx) => (
                    <span
                      key={idx}
                      style={{
                        background: '#fdeded',
                        color: '#c62828',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      ✕ {wg}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rullningsbar innehållsyta */}
          <div
            ref={sheetScrollRef}
            style={{
              padding: isMobile ? '10px 14px 20px' : '14px 16px',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: isMobile ? '9px' : '12px',
            }}
          >
            {/* Match-framstegsbanner (när en match pågår) */}
            {isMatchActive && (
              <div
                style={{
                  padding: '9px 12px',
                  background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                  color: '#fff',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 2px 8px rgba(37,99,235,0.25)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Trophy size={15} style={{ color: '#fbbf24' }} />
                  <span style={{ fontWeight: 800, fontSize: '0.82rem' }}>
                    {isSv ? `Rond ${currentRoundIndex + 1} av 5` : `Round ${currentRoundIndex + 1} of 5`}
                  </span>
                </div>
                {/* 5 steg-prickar */}
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const res = matchResults[idx];
                    let bg = 'rgba(255,255,255,0.25)';
                    let border = 'transparent';
                    if (idx === currentRoundIndex) {
                      border = '#fbbf24';
                      bg = '#fff';
                    } else if (res) {
                      bg = res.isSolved ? '#4ade80' : '#f87171';
                    }
                    return (
                      <div
                        key={idx}
                        style={{
                          width: idx === currentRoundIndex ? '10px' : '8px',
                          height: idx === currentRoundIndex ? '10px' : '8px',
                          borderRadius: '50%',
                          background: bg,
                          border: `2px solid ${border}`,
                          transition: 'all 0.2s',
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fef08a' }}>
                  {matchResults.reduce((sum, r) => sum + r.score, 0)} p
                </div>
              </div>
            )}

            {/* A. Avslöjad / Rätt svar kort */}
            {(isSolved || isSurrendered) && (
              <div
                style={{
                  background: isSolved ? '#edf7ed' : '#fdeded',
                  border: `1.5px solid ${isSolved ? '#4caf50' : '#ef5350'}`,
                  borderRadius: '12px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  {currentPerson.image?.thumb && (
                    <img
                      src={currentPerson.image.thumb}
                      alt={name}
                      style={{
                        width: '54px',
                        height: '54px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: `2px solid ${isSolved ? '#4caf50' : '#ef5350'}`,
                      }}
                    />
                  )}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isSolved ? (
                        <CheckCircle2 size={18} style={{ color: '#2e7d32' }} />
                      ) : (
                        <XCircle size={18} style={{ color: '#c62828' }} />
                      )}
                      <strong style={{ fontSize: '1.1rem' }}>{name}</strong>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {birthYear} – {deathYear || (isSv ? 'nu' : 'now')}
                    </div>
                  </div>
                </div>

                {desc && (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.35, fontStyle: 'italic' }}>
                    "{desc}"
                  </p>
                )}

                {wikiSummary && (
                  <div
                    style={{
                      background: '#fff',
                      padding: '9px 11px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.8rem',
                      lineHeight: 1.45,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <p>{wikiSummary}</p>
                    {wikiUrl && (
                      <div style={{ marginTop: '5px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Källa: <a href={wikiUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>Wikipedia</a> (CC BY-SA 4.0)
                      </div>
                    )}
                  </div>
                )}

                {isSolved ? (
                  <div style={{ fontSize: '0.82rem', color: '#2e7d32', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>
                      🎉 {isSv ? `Rätt svar! Du fick +${score} poäng!` : `Correct! +${score} points!`}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {(() => {
                        const base = currentPerson.tier === 'reference' ? 1200 : 1000;
                        const cCost = deductionsAtEnd?.cluesCost ?? 0;
                        const wCost = deductionsAtEnd?.wrongCost ?? 0;
                        if (cCost === 0 && wCost === 0) {
                          return isSv
                            ? `Full pott! Inga ledtrådar använda (${base} p)`
                            : `Full score! No clues or wrong guesses used (${base} p)`;
                        }
                        const parts = [`Bas: ${base} p`];
                        if (cCost > 0) parts.push(`Ledtrådar: -${cCost} p`);
                        if (wCost > 0) parts.push(`Felgissningar: -${wCost} p`);
                        return parts.join(' · ');
                      })()}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#c62828' }}>
                    {isSv ? 'Du gav upp gåtan (0 poäng).' : 'You surrendered (0 points).'}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  {onInspectPerson && (
                    <button
                      onClick={() => onInspectPerson(currentPerson)}
                      style={{
                        flex: 1,
                        padding: '7px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-focus)',
                        background: '#fff',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      <Eye size={13} />
                      {isSv ? 'Inspektera' : 'Inspect'}
                    </button>
                  )}
                  {isMatchActive ? (
                    currentRoundIndex < 4 ? (
                      <button
                        onClick={handleNextMatchRound}
                        style={{
                          flex: 1.4,
                          padding: '7px',
                          borderRadius: '6px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                          color: '#fff',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        {isSv ? `Nästa rond (${currentRoundIndex + 2}/5)` : `Next round (${currentRoundIndex + 2}/5)`}
                        <ArrowRight size={13} />
                      </button>
                    ) : (
                      <button
                        onClick={() => setIsMatchSummaryOpen(true)}
                        style={{
                          flex: 1.4,
                          padding: '7px',
                          borderRadius: '6px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #b45309, #d97706)',
                          color: '#fff',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        <Trophy size={13} />
                        {isSv ? 'Se matchresultat 🏆' : 'Match summary 🏆'}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => handleNextPerson()}
                      style={{
                        flex: 1,
                        padding: '7px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'var(--accent-blue)',
                        color: '#fff',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {isSv ? 'Nästa gåta' : 'Next'}
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* C. Ledtrådar (Alltid i DOM för naturlig rullning på mobil & desktop) */}
            <div style={{ marginTop: '2px', position: 'relative', zIndex: 1 }}>
              <div
                style={{
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Sparkles size={13} style={{ color: 'var(--accent-gold)' }} />
                  <span>{isSv ? `Ledtrådar (${revealedClues.size}/7):` : `Clues (${revealedClues.size}/7):`}</span>
                </div>
                {isMobile && !isMobileSheetExpanded ? (
                  <button
                    onClick={() => setIsMobileSheetExpanded(true)}
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1d4ed8',
                      padding: '2px 9px',
                      borderRadius: '999px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <span>{isSv ? 'Visa ledtrådar' : 'View clues'}</span>
                    <ChevronUp size={12} />
                  </button>
                ) : !isSolved && !isSurrendered ? (
                  <span style={{ fontSize: '0.72rem', color: '#855700', fontWeight: 700 }}>
                    {isSv ? 'Klicka på ett kort för att avslöja' : 'Tap card to reveal'}
                  </span>
                ) : null}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* 0. Biografisk berättelse från Wikipedia */}
                <div
                  onClick={() => toggleClue('wikiSummary')}
                  style={{
                    border: revealedClues.has('wikiSummary') ? '2px solid #3b82f6' : '1.5px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '11px 13px',
                    background: revealedClues.has('wikiSummary') ? '#ffffff' : '#f8fafc',
                    boxShadow: revealedClues.has('wikiSummary') ? '0 4px 12px rgba(59, 130, 246, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    minHeight: '52px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: '#eff6ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <BookOpen size={18} style={{ color: '#2563eb' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                          {isSv ? 'Biografisk berättelse (Wikipedia)' : 'Biographical summary (Wikipedia)'}
                        </div>
                        {!revealedClues.has('wikiSummary') && (
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                            {isSv ? 'Ingress med personens historia' : 'Wikipedia intro narrative'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '7px 13px',
                        borderRadius: '999px',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        background: revealedClues.has('wikiSummary')
                          ? '#f1f5f9'
                          : isSolved || isSurrendered
                          ? '#e0e7ff'
                          : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                        color: revealedClues.has('wikiSummary')
                          ? '#475569'
                          : isSolved || isSurrendered
                          ? '#3730a3'
                          : '#ffffff',
                        boxShadow: !revealedClues.has('wikiSummary') && !isSolved && !isSurrendered ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {revealedClues.has('wikiSummary') ? (
                        <>
                          <span>{isSv ? 'Dölj' : 'Hide'}</span>
                          <ChevronUp size={14} />
                        </>
                      ) : isSolved || isSurrendered ? (
                        <>
                          <span>{isSv ? 'Visa' : 'Show'}</span>
                          <ChevronDown size={14} />
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} style={{ color: '#fef08a' }} />
                          <span>{isSv ? 'Avslöja (-250 p)' : 'Reveal (-250 p)'}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {revealedClues.has('wikiSummary') && (
                    <div
                      style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#1e293b', lineHeight: 1.5 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {wikiLoading ? (
                        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {isSv ? 'Hämtar sammanfattning från Wikipedia...' : 'Loading summary from Wikipedia...'}
                        </div>
                      ) : sanitizedWikiSummary ? (
                        <>
                          <p style={{ margin: 0, fontStyle: 'italic' }}>"{sanitizedWikiSummary}"</p>
                          {wikiUrl && (
                            <div style={{ marginTop: '6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {isSv ? 'Källa:' : 'Source:'}{' '}
                              <a
                                href={wikiUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: 'var(--accent-blue)', textDecoration: 'underline', fontWeight: 600 }}
                              >
                                Wikipedia (CC BY-SA 4.0)
                              </a>
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {isSv ? 'Kunde inte hämta sammanfattning från Wikipedia för denna person.' : 'Could not fetch summary from Wikipedia.'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 1. Yrke */}
                <div
                  onClick={() => toggleClue('occupation')}
                  style={{
                    border: revealedClues.has('occupation') ? '2px solid #16a34a' : '1.5px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '11px 13px',
                    background: revealedClues.has('occupation') ? '#ffffff' : '#f8fafc',
                    boxShadow: revealedClues.has('occupation') ? '0 4px 12px rgba(22, 163, 74, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    minHeight: '52px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: '#f0fdf4',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Briefcase size={18} style={{ color: '#16a34a' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                          {isSv ? 'Yrke & Verksamhet' : 'Occupation'}
                        </div>
                        {!revealedClues.has('occupation') && (
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                            {isSv ? 'Vad personen arbetade med' : 'Professional activities'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '7px 13px',
                        borderRadius: '999px',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        background: revealedClues.has('occupation')
                          ? '#f1f5f9'
                          : isSolved || isSurrendered
                          ? '#e0e7ff'
                          : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                        color: revealedClues.has('occupation')
                          ? '#475569'
                          : isSolved || isSurrendered
                          ? '#3730a3'
                          : '#ffffff',
                        boxShadow: !revealedClues.has('occupation') && !isSolved && !isSurrendered ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {revealedClues.has('occupation') ? (
                        <>
                          <span>{isSv ? 'Dölj' : 'Hide'}</span>
                          <ChevronUp size={14} />
                        </>
                      ) : isSolved || isSurrendered ? (
                        <>
                          <span>{isSv ? 'Visa' : 'Show'}</span>
                          <ChevronDown size={14} />
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} style={{ color: '#fef08a' }} />
                          <span>{isSv ? 'Avslöja (-150 p)' : 'Reveal (-150 p)'}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {revealedClues.has('occupation') && (
                    <div
                      style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {occupations.length > 0 ? (
                          occupations.map((occ, i) => (
                            <span
                              key={i}
                              style={{
                                background: '#f0fdf4',
                                color: '#166534',
                                border: '1px solid #bbf7d0',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '0.82rem',
                                fontWeight: 700,
                              }}
                            >
                              {occ}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {isSv ? 'Inga specifika yrken listade' : 'None listed'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Land / Medborgarskap */}
                <div
                  onClick={() => toggleClue('citizenship')}
                  style={{
                    border: revealedClues.has('citizenship') ? '2px solid #dc2626' : '1.5px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '11px 13px',
                    background: revealedClues.has('citizenship') ? '#ffffff' : '#f8fafc',
                    boxShadow: revealedClues.has('citizenship') ? '0 4px 12px rgba(220, 38, 38, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    minHeight: '52px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: '#fef2f2',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Flag size={18} style={{ color: '#dc2626' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                          {isSv ? 'Land & Medborgarskap' : 'Citizenship'}
                        </div>
                        {!revealedClues.has('citizenship') && (
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                            {isSv ? 'Nationalitet och hemländer' : 'National identity'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '7px 13px',
                        borderRadius: '999px',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        background: revealedClues.has('citizenship')
                          ? '#f1f5f9'
                          : isSolved || isSurrendered
                          ? '#e0e7ff'
                          : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                        color: revealedClues.has('citizenship')
                          ? '#475569'
                          : isSolved || isSurrendered
                          ? '#3730a3'
                          : '#ffffff',
                        boxShadow: !revealedClues.has('citizenship') && !isSolved && !isSurrendered ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {revealedClues.has('citizenship') ? (
                        <>
                          <span>{isSv ? 'Dölj' : 'Hide'}</span>
                          <ChevronUp size={14} />
                        </>
                      ) : isSolved || isSurrendered ? (
                        <>
                          <span>{isSv ? 'Visa' : 'Show'}</span>
                          <ChevronDown size={14} />
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} style={{ color: '#fef08a' }} />
                          <span>{isSv ? 'Avslöja (-100 p)' : 'Reveal (-100 p)'}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {revealedClues.has('citizenship') && (
                    <div
                      style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {citizenship.length > 0 ? (
                          citizenship.map((cit, i) => (
                            <span
                              key={i}
                              style={{
                                background: '#fef2f2',
                                color: '#991b1b',
                                border: '1px solid #fecaca',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '0.82rem',
                                fontWeight: 700,
                              }}
                            >
                              {cit}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {isSv ? 'Information saknas' : 'Not listed'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Kön (-50 p) */}
                <div
                  onClick={() => toggleClue('gender')}
                  style={{
                    border: revealedClues.has('gender') ? '2px solid #7c3aed' : '1.5px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '11px 13px',
                    background: revealedClues.has('gender') ? '#ffffff' : '#f8fafc',
                    boxShadow: revealedClues.has('gender') ? '0 4px 12px rgba(124, 58, 237, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    minHeight: '52px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: '#f5f3ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <UserCheck size={18} style={{ color: '#7c3aed' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                          {isSv ? 'Kön' : 'Gender'}
                        </div>
                        {!revealedClues.has('gender') && (
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                            {isSv ? 'Kvinna, man eller annat' : 'Gender identity'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '7px 13px',
                        borderRadius: '999px',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        background: revealedClues.has('gender')
                          ? '#f1f5f9'
                          : isSolved || isSurrendered
                          ? '#e0e7ff'
                          : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                        color: revealedClues.has('gender')
                          ? '#475569'
                          : isSolved || isSurrendered
                          ? '#3730a3'
                          : '#ffffff',
                        boxShadow: !revealedClues.has('gender') && !isSolved && !isSurrendered ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {revealedClues.has('gender') ? (
                        <>
                          <span>{isSv ? 'Dölj' : 'Hide'}</span>
                          <ChevronUp size={14} />
                        </>
                      ) : isSolved || isSurrendered ? (
                        <>
                          <span>{isSv ? 'Visa' : 'Show'}</span>
                          <ChevronDown size={14} />
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} style={{ color: '#fef08a' }} />
                          <span>{isSv ? 'Avslöja (-50 p)' : 'Reveal (-50 p)'}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {revealedClues.has('gender') && (
                    <div
                      style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        style={{
                          background: '#f5f3ff',
                          color: '#6d28d9',
                          border: '1px solid #ddd6fe',
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '0.84rem',
                          fontWeight: 800,
                          display: 'inline-block',
                        }}
                      >
                        {currentPerson.gender === 'female'
                          ? (isSv ? 'Kvinna ♀' : 'Female ♀')
                          : currentPerson.gender === 'male'
                          ? (isSv ? 'Man ♂' : 'Male ♂')
                          : (isSv ? 'Icke-binär / Annat' : 'Non-binary / Other')}
                      </span>
                    </div>
                  )}
                </div>

                {/* 4. Kända verk */}
                {works.length > 0 && (
                  <div
                    onClick={() => toggleClue('works')}
                    style={{
                      border: revealedClues.has('works') ? '2px solid #d97706' : '1.5px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '11px 13px',
                      background: revealedClues.has('works') ? '#ffffff' : '#f8fafc',
                      boxShadow: revealedClues.has('works') ? '0 4px 12px rgba(217, 119, 6, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      minHeight: '52px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            background: '#fffbeb',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Award size={18} style={{ color: '#d97706' }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                            {isSv ? 'Kända verk & Skapelser' : 'Notable Works'}
                          </div>
                          {!revealedClues.has('works') && (
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                              {isSv ? 'Böcker, tavlor, uppfinningar m.m.' : 'Major works and creations'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: '7px 13px',
                          borderRadius: '999px',
                          fontWeight: 800,
                          fontSize: '0.82rem',
                          background: revealedClues.has('works')
                            ? '#f1f5f9'
                            : isSolved || isSurrendered
                            ? '#e0e7ff'
                            : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                          color: revealedClues.has('works')
                            ? '#475569'
                            : isSolved || isSurrendered
                            ? '#3730a3'
                            : '#ffffff',
                          boxShadow: !revealedClues.has('works') && !isSolved && !isSurrendered ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {revealedClues.has('works') ? (
                          <>
                            <span>{isSv ? 'Dölj' : 'Hide'}</span>
                            <ChevronUp size={14} />
                          </>
                        ) : isSolved || isSurrendered ? (
                          <>
                            <span>{isSv ? 'Visa' : 'Show'}</span>
                            <ChevronDown size={14} />
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} style={{ color: '#fef08a' }} />
                            <span>{isSv ? 'Avslöja (-250 p)' : 'Reveal (-250 p)'}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {revealedClues.has('works') && (
                      <div
                        style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {works.map((w, i) => (
                            <span
                              key={i}
                              style={{
                                background: '#fffbeb',
                                color: '#92400e',
                                border: '1px solid #fde68a',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '0.82rem',
                                fontWeight: 700,
                              }}
                            >
                              {w}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. Beskrivning */}
                {desc && (
                  <div
                    onClick={() => toggleClue('description')}
                    style={{
                      border: revealedClues.has('description') ? '2px solid #0284c7' : '1.5px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '11px 13px',
                      background: revealedClues.has('description') ? '#ffffff' : '#f8fafc',
                      boxShadow: revealedClues.has('description') ? '0 4px 12px rgba(2, 132, 199, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      minHeight: '52px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            background: '#f0f9ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <BookOpen size={18} style={{ color: '#0284c7' }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                            {isSv ? 'Kort sammanfattning' : 'Short Bio'}
                          </div>
                          {!revealedClues.has('description') && (
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                              {isSv ? 'Wikidata-beskrivning av personen' : 'Wikidata short description'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: '7px 13px',
                          borderRadius: '999px',
                          fontWeight: 800,
                          fontSize: '0.82rem',
                          background: revealedClues.has('description')
                            ? '#f1f5f9'
                            : isSolved || isSurrendered
                            ? '#e0e7ff'
                            : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                          color: revealedClues.has('description')
                            ? '#475569'
                            : isSolved || isSurrendered
                            ? '#3730a3'
                            : '#ffffff',
                          boxShadow: !revealedClues.has('description') && !isSolved && !isSurrendered ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {revealedClues.has('description') ? (
                          <>
                            <span>{isSv ? 'Dölj' : 'Hide'}</span>
                            <ChevronUp size={14} />
                          </>
                        ) : isSolved || isSurrendered ? (
                          <>
                            <span>{isSv ? 'Visa' : 'Show'}</span>
                            <ChevronDown size={14} />
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} style={{ color: '#fef08a' }} />
                            <span>{isSv ? 'Avslöja (-100 p)' : 'Reveal (-100 p)'}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {revealedClues.has('description') && (
                      <div
                        style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            color: '#334155',
                            fontStyle: 'italic',
                            lineHeight: 1.45,
                          }}
                        >
                          "{desc}"
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 6. Porträtt */}
                {currentPerson.image?.thumb && (
                  <div
                    onClick={() => toggleClue('portrait')}
                    style={{
                      border: revealedClues.has('portrait') ? '2px solid #c026d3' : '1.5px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '11px 13px',
                      background: revealedClues.has('portrait') ? '#ffffff' : '#f8fafc',
                      boxShadow: revealedClues.has('portrait') ? '0 4px 12px rgba(192, 38, 211, 0.08)' : '0 1px 3px rgba(0,0,0,0.03)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      minHeight: '52px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            background: '#fdf4ff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Eye size={18} style={{ color: '#c026d3' }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1e293b' }}>
                            {isSv ? 'Porträttbild' : 'Portrait Image'}
                          </div>
                          {!revealedClues.has('portrait') && (
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                              {isSv ? 'Historiskt foto eller målning' : 'Historical photo or artwork'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: '7px 13px',
                          borderRadius: '999px',
                          fontWeight: 800,
                          fontSize: '0.82rem',
                          background: revealedClues.has('portrait')
                            ? '#f1f5f9'
                            : isSolved || isSurrendered
                            ? '#e0e7ff'
                            : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                          color: revealedClues.has('portrait')
                            ? '#475569'
                            : isSolved || isSurrendered
                            ? '#3730a3'
                            : '#ffffff',
                          boxShadow: !revealedClues.has('portrait') && !isSolved && !isSurrendered ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {revealedClues.has('portrait') ? (
                          <>
                            <span>{isSv ? 'Dölj' : 'Hide'}</span>
                            <ChevronUp size={14} />
                          </>
                        ) : isSolved || isSurrendered ? (
                          <>
                            <span>{isSv ? 'Visa' : 'Show'}</span>
                            <ChevronDown size={14} />
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} style={{ color: '#fef08a' }} />
                            <span>{isSv ? 'Avslöja (-350 p)' : 'Reveal (-350 p)'}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {revealedClues.has('portrait') && (
                      <div
                        style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <img
                          src={currentPerson.image.thumb}
                          alt="Portrait"
                          style={{
                            width: '90px',
                            height: '90px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            border: '3px solid var(--accent-gold)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Mobil ge upp-knapp i botten av listan */}
                {!isSolved && !isSurrendered && isMobile && (
                  <button
                    onClick={() => {
                      if (confirm(isSv ? 'Ge upp gåtan och visa svaret?' : 'Give up and show answer?')) {
                        const cluesCost = Array.from(revealedClues).reduce((sum, c) => sum + (CLUE_COSTS[c] ?? 0), 0);
                        const wrongCost = wrongGuesses.length * WRONG_GUESS_PENALTY;
                        setIsSurrendered(true);
                        setEarnedRoundScore(0);
                        setDeductionsAtEnd({ cluesCost, wrongCost });
                        if (isMatchActive) {
                          setMatchResults((prev) => [
                            ...prev,
                            {
                              person: currentPerson,
                              score: 0,
                              isSolved: false,
                              cluesUsed: Array.from(revealedClues),
                              wrongGuessesCount: wrongGuesses.length,
                            },
                          ]);
                        }
                        setRevealedClues(new Set(['gender', 'occupation', 'citizenship', 'works', 'description', 'portrait', 'wikiSummary']));
                        setIsMobileSheetExpanded(true);
                      }
                    }}
                    style={{
                      marginTop: '6px',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid #fecaca',
                      background: '#fff5f5',
                      color: '#b91c1c',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    {isSv ? 'Ge upp gåtan och visa svaret' : 'Give up and show answer'}
                  </button>
                )}
              </div>
            </div>

            {/* D. Ge upp-knapp i botten (visas på desktop, på mobil finns den i snabbkontrollerna) */}
            {!isSolved && !isSurrendered && !isMobile && (
              <button
                onClick={() => {
                  const cluesCost = Array.from(revealedClues).reduce((sum, c) => sum + (CLUE_COSTS[c] ?? 0), 0);
                  const wrongCost = wrongGuesses.length * WRONG_GUESS_PENALTY;
                  setIsSurrendered(true);
                  setEarnedRoundScore(0);
                  setDeductionsAtEnd({ cluesCost, wrongCost });
                  if (isMatchActive) {
                    setMatchResults((prev) => [
                      ...prev,
                      {
                        person: currentPerson,
                        score: 0,
                        isSolved: false,
                        cluesUsed: Array.from(revealedClues),
                        wrongGuessesCount: wrongGuesses.length,
                      },
                    ]);
                  }
                  setRevealedClues(new Set(['gender', 'occupation', 'citizenship', 'works', 'description', 'portrait', 'wikiSummary']));
                  setIsSidebarOpen(true);
                }}
                style={{
                  marginTop: 'auto',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                {isSv ? 'Ge upp och visa vem det var' : 'Give up and show answer'}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Minimerad knapp om användaren stängt sidopanelen på desktop */
        !isMobile && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              zIndex: 1000,
              background: 'rgba(255, 255, 255, 0.94)',
              backdropFilter: 'blur(10px)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
              borderRadius: '999px',
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              fontWeight: 800,
              fontSize: '0.85rem',
              color: 'var(--accent-blue)',
              cursor: 'pointer',
            }}
          >
            <Search size={15} />
            {isSv ? 'Gissa / Ledtrådar' : 'Guess / Clues'}
            <ChevronRight size={15} />
          </button>
        )
      )}

      {/* 5. MATCH SETUP MODAL */}
      {showMatchModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setShowMatchModal(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '20px',
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: '#fef3c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#b45309',
                  }}
                >
                  <Trophy size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {isSv ? 'Starta en Match (5 gåtor)' : 'Start a Match (5 rounds)'}
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {isSv ? 'Gissa 5 historiska personer och samla max 5 000 poäng' : 'Guess 5 figures and collect up to 5,000 points'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowMatchModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Filter-sektion */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: '#fcfaf6', padding: '16px', borderRadius: '12px', border: '1px solid #f0e9dc' }}>
              {/* Århundrade */}
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '5px' }}>
                  ⏳ {isSv ? 'Tidsperiod / Århundrade' : 'Century / Epoch'}
                </label>
                <select
                  value={matchCentury}
                  onChange={(e) => setMatchCentury(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: '#fff',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  {CENTURIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {isSv ? c.label : c.labelEn}
                    </option>
                  ))}
                </select>
              </div>

              {/* Svårighetsgrad */}
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '5px' }}>
                  🎯 {isSv ? 'Svårighetsgrad / Urval' : 'Difficulty / Tier'}
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setMatchTier('guess')}
                    style={{
                      padding: '7px 4px',
                      borderRadius: '8px',
                      border: matchTier === 'guess' ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                      background: matchTier === 'guess' ? '#e0f2fe' : '#fff',
                      color: matchTier === 'guess' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                  >
                    ⭐ {isSv ? 'Kända' : 'Famous'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatchTier('all')}
                    style={{
                      padding: '7px 4px',
                      borderRadius: '8px',
                      border: matchTier === 'all' ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                      background: matchTier === 'all' ? '#e0f2fe' : '#fff',
                      color: matchTier === 'all' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                  >
                    🎲 {isSv ? 'Alla' : 'All'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatchTier('reference')}
                    style={{
                      padding: '7px 4px',
                      borderRadius: '8px',
                      border: matchTier === 'reference' ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                      background: matchTier === 'reference' ? '#e0f2fe' : '#fff',
                      color: matchTier === 'reference' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                  >
                    🔥 {isSv ? 'Svår' : 'Hard'}
                  </button>
                </div>
              </div>

              {/* Geografi: Endast Sverige toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  checked={matchOnlySwedish}
                  onChange={(e) => setMatchOnlySwedish(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--accent-blue)', cursor: 'pointer' }}
                />
                🇸🇪 {isSv ? 'Endast personer med svensk koppling' : 'Only Swedish historical figures'}
              </label>

              {/* Kandidaträknare */}
              <div style={{ fontSize: '0.72rem', color: matchCandidatesCount >= 5 ? 'var(--text-muted)' : '#c62828', fontWeight: 600 }}>
                {matchCandidatesCount >= 5
                  ? (isSv ? `✨ ${matchCandidatesCount} personer matchar dina val` : `✨ ${matchCandidatesCount} people available`)
                  : (isSv ? '⚠️ För få personer matchar (minst 5 krävs). Ändra filter.' : '⚠️ Less than 5 people match. Broaden filters.')}
              </div>
            </div>

            {/* Poänginfo */}
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              💡 {isSv
                ? 'Varje gåta ger 1 000 baspoäng. Att öppna ledtrådar (-50 till -350p) eller gissa fel (-100p) ger avdrag. Kan du slå 4 000 poäng?'
                : 'Each round awards 1,000 base points. Clues and wrong guesses deduct points. Can you beat 4,000 points?'}
            </div>

            {/* Knappar */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setShowMatchModal(false)}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: '#fff',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {isSv ? 'Avbryt' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={matchCandidatesCount < 5}
                onClick={() => startMatch(matchCentury, matchTier, matchOnlySwedish)}
                style={{
                  flex: 2,
                  padding: '9px',
                  borderRadius: '10px',
                  border: 'none',
                  background: matchCandidatesCount >= 5 ? 'linear-gradient(135deg, #1e3a8a, #2563eb)' : '#cbd5e1',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: matchCandidatesCount >= 5 ? 'pointer' : 'not-allowed',
                  boxShadow: matchCandidatesCount >= 5 ? '0 4px 12px rgba(37, 99, 235, 0.35)' : 'none',
                }}
              >
                <Trophy size={16} style={{ color: '#fbbf24' }} />
                {isSv ? 'Starta matchen (5 ronder)' : 'Start match (5 rounds)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MATCH SUMMARY MODAL (När alla 5 ronder är klara) */}
      {isMatchSummaryOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setIsMatchSummaryOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '24px',
              maxWidth: '520px',
              width: '100%',
              padding: '28px 24px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Match Result Header */}
            {(() => {
              const totalScore = matchResults.reduce((sum, r) => sum + r.score, 0);
              const maxScore = 5000;
              let title = isSv ? 'Karthistoriker' : 'Map Explorer';
              let badgeColor = '#b45309';
              let badgeBg = '#fef3c7';

              if (totalScore >= 4500) {
                title = isSv ? '👑 Världsklass! En levande historisk atlas!' : '👑 World-Class! Living Historical Atlas!';
                badgeColor = '#92400e';
                badgeBg = '#fef08a';
              } else if (totalScore >= 3500) {
                title = isSv ? '🧭 Mästerlig Kartspejare!' : '🧭 Master Cartographer!';
                badgeColor = '#15803d';
                badgeBg = '#dcfce7';
              } else if (totalScore >= 2500) {
                title = isSv ? '📜 Skicklig Forskare!' : '📜 Skilled Researcher!';
                badgeColor = '#1d4ed8';
                badgeBg = '#dbeafe';
              } else if (totalScore >= 1500) {
                title = isSv ? '🗺️ Godkänd Upptäckare' : '🗺️ Approved Explorer';
                badgeColor = '#b45309';
                badgeBg = '#fef3c7';
              } else {
                title = isSv ? '🐣 Bra kämpat! Övning ger färdighet' : '🐣 Good effort! Practice makes perfect';
                badgeColor = '#475569';
                badgeBg = '#f1f5f9';
              }

              return (
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #fef08a, #f59e0b)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      boxShadow: '0 8px 24px rgba(245, 158, 11, 0.4)',
                    }}
                  >
                    <Trophy size={34} />
                  </div>

                  <h2 style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                    {isSv ? 'Matchresultat' : 'Match Results'}
                  </h2>

                  <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--accent-blue)', letterSpacing: '-0.02em' }}>
                    {totalScore} <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)' }}>/ {maxScore} p</span>
                  </div>

                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 12px',
                      borderRadius: '999px',
                      background: badgeBg,
                      color: badgeColor,
                      fontSize: '0.84rem',
                      fontWeight: 800,
                    }}
                  >
                    {title}
                  </div>
                </div>
              );
            })()}

            {/* Genomgång av de 5 personerna */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {isSv ? 'Rondernas personer:' : 'Round breakdown:'}
              </div>

              {matchResults.map((r, idx) => {
                const pName = r.person.name[lang] || r.person.name.sv || r.person.name.en || 'Okänd';
                const bYear = r.person.birthDate.year;
                const dYear = r.person.deathDate?.year;
                const bPlace = r.person.birthPlace?.name[lang] || r.person.birthPlace?.name.sv;
                const dPlace = r.person.deathPlace?.name[lang] || r.person.deathPlace?.name.sv;

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: '12px',
                      background: r.isSolved ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${r.isSolved ? '#bbf7d0' : '#fecaca'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {r.person.image?.thumb ? (
                        <img
                          src={r.person.image.thumb}
                          alt={pName}
                          style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: '#e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.8rem',
                          }}
                        >
                          👤
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.86rem', color: 'var(--text-primary)' }}>
                          {idx + 1}. {pName}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {bYear}–{dYear || (isSv ? 'nu' : 'now')} {bPlace && dPlace ? `· ${bPlace} → ${dPlace}` : ''}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: r.isSolved ? '#15803d' : '#b91c1c' }}>
                        {r.isSolved ? `+${r.score} p` : '0 p'}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {r.cluesUsed.length} {isSv ? 'ledtrådar' : 'clues'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => {
                  cancelMatch();
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: '#fff',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {isSv ? 'Avsluta till frispel' : 'Back to Free Play'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMatchSummaryOpen(false);
                  setShowMatchModal(true);
                }}
                style={{
                  flex: 1.5,
                  padding: '10px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
                }}
              >
                <RotateCcw size={15} />
                {isSv ? 'Spela ny match' : 'Play Another Match'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. MOBIL FILTER-MODAL */}
      {showMobileFilterModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setShowMobileFilterModal(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '20px 20px 0 0',
              width: '100%',
              maxWidth: '500px',
              padding: '20px 18px',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <SlidersHorizontal size={18} style={{ color: 'var(--accent-blue)' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
                  {isSv ? 'Filter & Inställningar' : 'Filters & Settings'}
                </h3>
              </div>
              <button
                onClick={() => setShowMobileFilterModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  padding: '4px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Nivå */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {isSv ? 'Svårighetsgrad:' : 'Difficulty tier:'}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => handleTierChange('guess')}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    border: selectedTier === 'guess' ? '2px solid var(--accent-blue)' : '1px solid var(--border-color)',
                    background: selectedTier === 'guess' ? 'var(--tag-bg)' : '#fff',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    textAlign: 'center',
                  }}
                >
                  ⭐ {isSv ? 'Nivå 1: Kända' : 'Tier 1'}
                </button>
                <button
                  type="button"
                  onClick={() => handleTierChange('reference')}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    border: selectedTier === 'reference' ? '2px solid var(--accent-blue)' : '1px solid var(--border-color)',
                    background: selectedTier === 'reference' ? 'var(--tag-bg)' : '#fff',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    textAlign: 'center',
                  }}
                >
                  📚 {isSv ? 'Nivå 2: Svårare' : 'Tier 2'}
                </button>
                <button
                  type="button"
                  onClick={() => handleTierChange('all')}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    border: selectedTier === 'all' ? '2px solid var(--accent-blue)' : '1px solid var(--border-color)',
                    background: selectedTier === 'all' ? 'var(--tag-bg)' : '#fff',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    textAlign: 'center',
                  }}
                >
                  {isSv ? 'Alla' : 'All'}
                </button>
              </div>
            </div>

            {/* Århundrade */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                {isSv ? 'Tidsperiod / Födelsesekel:' : 'Century:'}
              </label>
              <select
                value={selectedCentury}
                onChange={(e) => handleCenturyChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1.5px solid var(--border-color)',
                  background: '#fff',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  outline: 'none',
                }}
              >
                {CENTURIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {isSv ? c.label : c.labelEn}
                  </option>
                ))}
              </select>
            </div>

            {/* Toggle-knappar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                onClick={handleSwedishToggle}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: onlySwedish ? '1.5px solid #137333' : '1px solid var(--border-color)',
                  background: onlySwedish ? '#e6f4ea' : '#fff',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>🇸🇪 {isSv ? 'Bara personer med svensk koppling' : 'Swedish connection only'}</span>
                {onlySwedish && <Check size={16} style={{ color: '#137333' }} />}
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextVal = !requireBothCoords;
                  setRequireBothCoords(nextVal);
                  if (nextVal && (!currentPerson.birthPlace?.coord || (!currentPerson.deathPlace?.coord && currentPerson.deathDate))) {
                    const candidates = allPeople.filter((p) => {
                      if (selectedTier !== 'all' && p.tier !== selectedTier) return false;
                      if (!matchesCentury(p.birthDate.year, selectedCentury)) return false;
                      if (onlySwedish && !p.swedish) return false;
                      if (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate)) return false;
                      return true;
                    });
                    if (candidates.length > 0) {
                      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
                    }
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: requireBothCoords ? '1.5px solid var(--border-focus)' : '1px solid var(--border-color)',
                  background: requireBothCoords ? '#fef3c7' : '#fff',
                  fontWeight: 700,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>🗺️ {isSv ? 'Kräv både födelse- och dödsort (hel resa)' : 'Require both coordinates on map'}</span>
                {requireBothCoords && <Check size={16} style={{ color: '#b45309' }} />}
              </button>
            </div>

            {/* Antal matchande personer */}
            <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {eligiblePeople.length} {isSv ? 'personer matchar dina val' : 'people match your filters'}
            </div>

            {/* Knappar */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => {
                  handleNextPerson();
                  setShowMobileFilterModal(false);
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'var(--accent-gold)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                }}
              >
                <Shuffle size={14} />
                {isSv ? 'Ny gåta' : 'New puzzle'}
              </button>

              <button
                type="button"
                onClick={() => setShowMobileFilterModal(false)}
                style={{
                  flex: 1.2,
                  padding: '10px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'var(--accent-blue)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                }}
              >
                {isSv ? 'Klar' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

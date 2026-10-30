import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { loc, QUIZ_CATEGORIES, type Person, type Tier } from '../types/person.ts';
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
  Briefcase,
  Award,
  BookOpen,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Minimize2,
  X,
  Trophy,
  UserCheck,
  RotateCcw,
  Check,
  SlidersHorizontal,
} from 'lucide-react';

import { searchPeopleForgiving } from '../engine/fuzzySearch.ts';
import { getSafePlaceName } from '../engine/clues.ts';
import { compareGuess, haversineKm } from '../engine/guessFeedback.ts';
import {
  getPersonWikipediaSummary,
  loadLocalWikipediaSummaries,
  type WikiSummaryData,
} from '../engine/wikipedia.ts';
import { ClueCard } from './geoguesser/ClueCard.tsx';
import { loadGeoSession, saveGeoSession } from '../engine/sessionPersistence.ts';
import type { SavedRoundRecord, SavedMatchRecord } from '../engine/profileStore.ts';
import {
  CENTURY_OPTIONS,
  QUICK_COUNTRY_IDS,
  extractAvailableCountries,
  matchesCenturies,
  matchesCountries,
  matchesLifeStatuses,
  matchesTiers,
  normalizeTierList,
  toggleCentury,
  toggleCountry,
  toggleLifeStatus,
  toggleTier,
  type CountryMatchMode,
  type LifeStatusOption,
} from '../engine/filters.ts';

interface GeoGuesserViewProps {
  allPeople: Person[];
  lang: 'sv' | 'en';
  initialPersonId?: string | null;
  solvedPersonIds?: Set<string>;
  onRoundComplete?: (round: Omit<SavedRoundRecord, 'id' | 'date'>) => void;
  onMatchComplete?: (match: Omit<SavedMatchRecord, 'id' | 'date'>) => void;
  onInspectPerson?: (person: Person) => void;
  onBackToExplorer?: () => void;
}

export type ClueType =
  | 'profile'
  | 'occupation'
  | 'works'
  | 'wikiSummary'
  | 'portrait';

export const CLUE_COSTS: Record<ClueType, number> = {
  profile: 75,
  occupation: 150,
  works: 200,
  wikiSummary: 300,
  portrait: 350,
};

export const getBasePoints = (tier: Tier): number => {
  if (tier === 'very_hard') return 1500;
  if (tier === 'hard') return 1200;
  return 1000;
};

/**
 * Ledtrådar som ges gratis från start. Nu levande personer saknar dödsår och dödsort på kartan,
 * vilket gör dem betydligt svårare (median ~31 förenliga kandidater mot ~1 för avlidna).
 * Som kompensation får de Profil-ledtråden (kategori, kön, land) gratis.
 */
export const getFreeClues = (person: Person): ClueType[] => (person.deathDate ? [] : ['profile']);

export type LifeStatusFilter = 'historical' | 'living' | 'all';

const WRONG_GUESS_PENALTY = 100;
const MIN_ROUND_SCORE = 100;

interface MatchRoundResult {
  person: Person;
  score: number;
  isSolved: boolean;
  cluesUsed: ClueType[];
  wrongGuessesCount: number;
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

export const GeoGuesserView: React.FC<GeoGuesserViewProps> = ({
  allPeople,
  lang,
  initialPersonId,
  solvedPersonIds,
  onRoundComplete,
  onMatchComplete,
  onInspectPerson,
}) => {
  const isSv = lang === 'sv';
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const ghostLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const [initialSession] = useState(() => {
    const s = loadGeoSession();
    if (!s) return null;
    if (initialPersonId && s.currentPersonId !== initialPersonId) return null;
    const exists = allPeople.some((p) => p.id === s.currentPersonId);
    return exists ? s : null;
  });

  // Filter-tillstånd (flerval): Standard är ['standard'] och ['historical']
  const [selectedTiers, setSelectedTiers] = useState<Tier[]>(() =>
    normalizeTierList(initialSession?.selectedTiers, initialSession?.selectedTier)
  );
  const [selectedCenturies, setSelectedCenturies] = useState<string[]>(() => {
    if (initialSession?.selectedCenturies) return initialSession.selectedCenturies;
    if (initialSession?.selectedCentury && initialSession.selectedCentury !== 'all') return [initialSession.selectedCentury];
    return [];
  });
  const [lifeStatuses, setLifeStatuses] = useState<LifeStatusOption[]>(() => {
    if (initialSession?.lifeStatuses?.length) return initialSession.lifeStatuses as LifeStatusOption[];
    if (initialSession?.lifeStatus === 'all') return ['historical', 'living'];
    if (initialSession?.lifeStatus === 'living') return ['living'];
    return ['historical'];
  });
  const [selectedCountries, setSelectedCountries] = useState<string[]>(() => {
    if (initialSession?.selectedCountries) return initialSession.selectedCountries;
    if (initialSession?.onlySwedish) return ['Q34'];
    return [];
  });
  const [countryMatchMode, setCountryMatchMode] = useState<CountryMatchMode>(
    () => (initialSession?.countryMatchMode as CountryMatchMode) ?? 'any'
  );
  const [requireBothCoords, setRequireBothCoords] = useState<boolean>(() => initialSession?.requireBothCoords ?? true);

  const eligiblePeople = useMemo(() => {
    return allPeople.filter((p) => {
      // 1. Nivå (flerval): Lätt / Medel / Svår
      if (!matchesTiers(p, selectedTiers)) return false;

      // 2. Epok / Århundrade (flerval: födelseår ELLER dödsår)
      if (!matchesCenturies(p, selectedCenturies)) return false;

      // 3. Livsstatus (flerval): Historiska / Nu levande
      if (!matchesLifeStatuses(p, lifeStatuses)) return false;

      // 4. Länder (flerval med valbar kopplingstyp)
      if (!matchesCountries(p, selectedCountries, countryMatchMode)) return false;

      // 5. Måste ha minst en koordinat för att kunna visas på kartan
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;

      // 6. Kräver hel resa med både födelse- och dödsort om aktiverat
      if (requireBothCoords && (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate))) return false;

      return true;
    });
  }, [allPeople, selectedTiers, selectedCenturies, lifeStatuses, selectedCountries, countryMatchMode, requireBothCoords]);

  // Current person
  const [currentPerson, setCurrentPerson] = useState<Person>(() => {
    if (initialPersonId) {
      const found = allPeople.find((p) => p.id === initialPersonId);
      if (found) return found;
    }
    if (initialSession) {
      const found = allPeople.find((p) => p.id === initialSession.currentPersonId);
      if (found) return found;
    }
    const preferred =
      allPeople.find((p) => p.id === 'Q762' || p.id === 'Q55767') ||
      eligiblePeople[Math.floor(Math.random() * eligiblePeople.length)] ||
      allPeople[0]!;
    return preferred;
  });

  // Game state: purchasedClues tracks permanent point deductions; expandedClues tracks UI toggle state
  const [purchasedClues, setPurchasedClues] = useState<Set<ClueType>>(() => {
    if (initialSession?.purchasedClues) {
      return new Set(initialSession.purchasedClues as ClueType[]);
    }
    return new Set();
  });
  const [expandedClues, setExpandedClues] = useState<Set<ClueType>>(() => {
    if (initialSession?.expandedClues) {
      return new Set(initialSession.expandedClues as ClueType[]);
    }
    return new Set(getFreeClues(currentPerson));
  });
  const [isSolved, setIsSolved] = useState(() => initialSession?.isSolved ?? false);
  const [isSurrendered, setIsSurrendered] = useState(() => initialSession?.isSurrendered ?? false);
  const [earnedRoundScore, setEarnedRoundScore] = useState<number | null>(() => initialSession?.earnedRoundScore ?? null);
  const [deductionsAtEnd, setDeductionsAtEnd] = useState<{ cluesCost: number; wrongCost: number } | null>(() => initialSession?.deductionsAtEnd ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [wrongGuesses, setWrongGuesses] = useState<Person[]>(() => {
    if (initialSession?.wrongGuessIds) {
      const byId = new Map(allPeople.map((p) => [p.id, p]));
      return initialSession.wrongGuessIds.map((id) => byId.get(id)).filter((p): p is Person => !!p);
    }
    return [];
  });
  const [showGhostPins, setShowGhostPins] = useState<boolean>(() => initialSession?.showGhostPins ?? true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [wikiData, setWikiData] = useState<WikiSummaryData | null>(null);
  const [wikiLoading, setWikiLoading] = useState<boolean>(false);

  // Match state (5 ronders spelomgång)
  const [isMatchActive, setIsMatchActive] = useState<boolean>(() => initialSession?.isMatchActive ?? false);
  const [showMatchModal, setShowMatchModal] = useState<boolean>(false);
  const [matchRounds, setMatchRounds] = useState<Person[]>(() => {
    if (initialSession?.matchRoundIds && initialSession.isMatchActive) {
      const byId = new Map(allPeople.map((p) => [p.id, p]));
      return initialSession.matchRoundIds.map((id) => byId.get(id)).filter((p): p is Person => !!p);
    }
    return [];
  });
  const [currentRoundIndex, setCurrentRoundIndex] = useState<number>(() => initialSession?.currentRoundIndex ?? 0);
  const [matchResults, setMatchResults] = useState<MatchRoundResult[]>(() => {
    if (initialSession?.matchResults && initialSession.isMatchActive) {
      const byId = new Map(allPeople.map((p) => [p.id, p]));
      return initialSession.matchResults
        .map((r) => {
          const person = byId.get(r.personId);
          if (!person) return null;
          return {
            person,
            score: r.score,
            isSolved: r.isSolved,
            cluesUsed: r.cluesUsed as ClueType[],
            wrongGuessesCount: r.wrongGuessesCount,
          };
        })
        .filter((r): r is MatchRoundResult => !!r);
    }
    return [];
  });
  const [isMatchSummaryOpen, setIsMatchSummaryOpen] = useState<boolean>(() => initialSession?.isMatchSummaryOpen ?? false);

  // Match setup form-tillstånd (flerval)
  const [matchCenturies, setMatchCenturies] = useState<string[]>(() => {
    if (initialSession?.matchCenturies) return initialSession.matchCenturies;
    if (initialSession?.matchCentury && initialSession.matchCentury !== 'all') return [initialSession.matchCentury];
    return [];
  });
  const [matchTiers, setMatchTiers] = useState<Tier[]>(() =>
    normalizeTierList(initialSession?.matchTiers, initialSession?.matchTier)
  );
  const [matchLifeStatuses, setMatchLifeStatuses] = useState<LifeStatusOption[]>(() => {
    if (initialSession?.matchLifeStatuses?.length) return initialSession.matchLifeStatuses as LifeStatusOption[];
    if (initialSession?.matchLifeStatus === 'all') return ['historical', 'living'];
    if (initialSession?.matchLifeStatus === 'living') return ['living'];
    return ['historical'];
  });
  const [matchCountries, setMatchCountries] = useState<string[]>(() => {
    if (initialSession?.matchCountries) return initialSession.matchCountries;
    if (initialSession?.matchOnlySwedish) return ['Q34'];
    return [];
  });
  const [matchCountryMatchMode, setMatchCountryMatchMode] = useState<CountryMatchMode>(
    () => (initialSession?.matchCountryMatchMode as CountryMatchMode) ?? 'any'
  );
  const [showMoreCountries, setShowMoreCountries] = useState<boolean>(false);
  const [countrySearch, setCountrySearch] = useState<string>('');

  // Spara spelsession i localStorage så inte framsteg försvinner vid skärmsläckning eller flikomladdning
  useEffect(() => {
    saveGeoSession({
      selectedTier: selectedTiers.length === 3 ? 'all' : (selectedTiers[0] ?? 'standard'),
      selectedTiers,
      selectedCentury: selectedCenturies.length === 0 ? 'all' : selectedCenturies.join(','),
      selectedCenturies,
      lifeStatus: lifeStatuses.length === 2 ? 'all' : (lifeStatuses[0] ?? 'historical'),
      lifeStatuses,
      onlySwedish: selectedCountries.length === 1 && selectedCountries[0] === 'Q34',
      selectedCountries,
      countryMatchMode,
      requireBothCoords,
      showGhostPins,
      currentPersonId: currentPerson.id,
      purchasedClues: Array.from(purchasedClues),
      expandedClues: Array.from(expandedClues),
      isSolved,
      isSurrendered,
      earnedRoundScore,
      deductionsAtEnd,
      wrongGuessIds: wrongGuesses.map((p) => p.id),
      isMatchActive,
      matchRoundIds: matchRounds.map((p) => p.id),
      currentRoundIndex,
      matchResults: matchResults.map((r) => ({
        personId: r.person.id,
        score: r.score,
        isSolved: r.isSolved,
        cluesUsed: r.cluesUsed,
        wrongGuessesCount: r.wrongGuessesCount,
      })),
      isMatchSummaryOpen,
      matchCentury: matchCenturies.length === 0 ? 'all' : matchCenturies.join(','),
      matchCenturies,
      matchTier: matchTiers.length === 3 ? 'all' : (matchTiers[0] ?? 'standard'),
      matchTiers,
      matchLifeStatus: matchLifeStatuses.length === 2 ? 'all' : (matchLifeStatuses[0] ?? 'historical'),
      matchLifeStatuses,
      matchOnlySwedish: matchCountries.length === 1 && matchCountries[0] === 'Q34',
      matchCountries,
      matchCountryMatchMode,
    });
  }, [
    selectedTiers,
    selectedCenturies,
    lifeStatuses,
    selectedCountries,
    countryMatchMode,
    requireBothCoords,
    showGhostPins,
    currentPerson.id,
    purchasedClues,
    expandedClues,
    isSolved,
    isSurrendered,
    earnedRoundScore,
    deductionsAtEnd,
    wrongGuesses,
    isMatchActive,
    matchRounds,
    currentRoundIndex,
    matchResults,
    isMatchSummaryOpen,
    matchCenturies,
    matchTiers,
    matchLifeStatuses,
    matchCountries,
    matchCountryMatchMode,
  ]);

  // Ladda in lokala Wikipedia-sammanfattningar i bakgrunden så de finns i minnet direkt
  useEffect(() => {
    loadLocalWikipediaSummaries();
  }, []);

  // Nollställ Wikipedia-data vid språkbyte så rätt språk hämtas om ledtråden är öppen
  useEffect(() => {
    setWikiData(null);
  }, [lang]);

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

  // Initialize Map (endast vid mount så språkbyte inte förstör och återskapar kartan)
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
          '🗺️ Atlas (Esri)': topoLayer,
          '🌐 Standard (OSM)': osmLayer,
        },
        undefined,
        { position: 'bottomright' }
      )
      .addTo(map);

    const ghostLayerGroup = L.layerGroup().addTo(map);
    const layerGroup = L.layerGroup().addTo(map);
    ghostLayerGroupRef.current = ghostLayerGroup;
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
  }, []);

  const lastFittedKeyRef = useRef<string>('');

  // Säkerställ att Leaflet uppdaterar sin canvas-storlek när mobillayoutens dockade balkar ändrar höjd
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 60);
    return () => clearTimeout(timer);
  }, [isMobile, wrongGuesses.length, isSolved, isSurrendered]);

  // Update markers and polyline when currentPerson changes
  useEffect(() => {
    const map = mapRef.current;
    const layers = layerGroupRef.current;
    if (!map || !layers) return;

    layers.clearLayers();

    const birthCoord = currentPerson.birthPlace?.coord;
    const deathCoord = currentPerson.deathPlace?.coord;
    const isRevealed = isSolved || isSurrendered;

    const birthPlaceName = getSafePlaceName(
      currentPerson.birthPlace,
      currentPerson,
      lang,
      isRevealed,
      isSv ? 'Födelseort' : 'Birthplace'
    );
    const deathPlaceName = getSafePlaceName(
      currentPerson.deathPlace,
      currentPerson,
      lang,
      isRevealed,
      isSv ? 'Dödsort' : 'Deathplace'
    );

    const birthYear = currentPerson.birthDate.year;
    const deathYear = currentPerson.deathDate?.year;

    const fitKey = `${currentPerson.id}:${isMobile ? 'm' : 'd'}`;
    const shouldMoveCamera = lastFittedKeyRef.current !== fitKey;
    if (shouldMoveCamera) {
      lastFittedKeyRef.current = fitKey;
    }

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
        if (shouldMoveCamera) {
          map.setView(birthCoord, isMobile ? 4.5 : 5.0, { animate: true });
        }
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

        if (shouldMoveCamera) {
          // På mobil har kartan en egen fri yta mellan topp- och bottenbalken utan överlappande paneler!
          const bounds = L.latLngBounds([birthCoord, deathCoord]).pad(isMobile ? 0.65 : 0.8);
          map.fitBounds(bounds, {
            paddingTopLeft: isMobile ? [32, 32] : [70, 70],
            paddingBottomRight: isMobile ? [32, 32] : [390, 70],
            maxZoom: isMobile ? 4.8 : 5.2,
            animate: true,
          });
        }
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
      if (shouldMoveCamera) {
        map.setView(birthCoord, isMobile ? 4.3 : 4.8, { animate: true });
      }
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
      if (shouldMoveCamera) {
        map.setView(deathCoord, isMobile ? 4.3 : 4.8, { animate: true });
      }
    } else if (shouldMoveCamera) {
      map.setView([35, 15], 3, { animate: true });
    }
  }, [currentPerson, lang, isSv, isMobile, isSolved, isSurrendered]);

  // Rita Spökmarkörer (Ghost Pins) för felgissade personer utan att störa kamerans fokus
  useEffect(() => {
    const ghostLayers = ghostLayerGroupRef.current;
    if (!ghostLayers) return;

    ghostLayers.clearLayers();
    if (!showGhostPins || wrongGuesses.length === 0) return;

    for (const gp of wrongGuesses) {
      const gName = loc(gp.name, lang, isSv ? 'Gissning' : 'Guess');
      const gBirthCoord = gp.birthPlace?.coord;
      const gDeathCoord = gp.deathPlace?.coord;
      const gBirthPlace = loc(gp.birthPlace?.name, lang, '');
      const gDeathPlace = loc(gp.deathPlace?.name, lang, '');
      const gBirthYear = gp.birthDate.year;
      const gDeathYear = gp.deathDate?.year;

      if (gBirthCoord && gDeathCoord) {
        const dist = haversineKm(gBirthCoord, gDeathCoord);
        if (dist < 10) {
          const html = `
            <div class="geo-marker-container geo-marker-ghost">
              <div class="geo-marker-pill">
                <span class="pin-icon">👻</span>
                <span class="pin-place">${gName}${gBirthPlace ? ` · ${gBirthPlace}` : ''}</span>
                <span class="pin-year">${gBirthYear}–${gDeathYear ?? (isSv ? 'nu' : 'now')}</span>
              </div>
              <div class="geo-marker-tip"></div>
              <div class="geo-marker-dot"></div>
            </div>
          `;
          L.marker(gBirthCoord, {
            icon: L.divIcon({ html, className: 'custom-geo-marker', iconSize: [0, 0], iconAnchor: [0, 0] }),
          }).addTo(ghostLayers);
        } else {
          const birthHtml = `
            <div class="geo-marker-container geo-marker-ghost">
              <div class="geo-marker-pill">
                <span class="pin-icon">👻</span>
                <span class="pin-place">${gName}${gBirthPlace ? ` (${gBirthPlace})` : ''}</span>
                <span class="pin-year">🐣 ${gBirthYear}</span>
              </div>
              <div class="geo-marker-tip"></div>
              <div class="geo-marker-dot"></div>
            </div>
          `;
          L.marker(gBirthCoord, {
            icon: L.divIcon({ html: birthHtml, className: 'custom-geo-marker', iconSize: [0, 0], iconAnchor: [0, 0] }),
          }).addTo(ghostLayers);

          const deathHtml = `
            <div class="geo-marker-container geo-marker-ghost">
              <div class="geo-marker-pill">
                <span class="pin-icon">👻</span>
                <span class="pin-place">${gName}${gDeathPlace ? ` (${gDeathPlace})` : ''}</span>
                <span class="pin-year">🪦 ${gDeathYear ?? (isSv ? 'nu' : 'now')}</span>
              </div>
              <div class="geo-marker-tip"></div>
              <div class="geo-marker-dot"></div>
            </div>
          `;
          L.marker(gDeathCoord, {
            icon: L.divIcon({ html: deathHtml, className: 'custom-geo-marker', iconSize: [0, 0], iconAnchor: [0, 0] }),
          }).addTo(ghostLayers);

          const curve = getGeodesicPath(gBirthCoord, gDeathCoord);
          L.polyline(curve, {
            color: '#64748b',
            weight: 2,
            dashArray: '4, 6',
            opacity: 0.65,
          }).addTo(ghostLayers);
        }
      } else if (gBirthCoord) {
        const birthHtml = `
          <div class="geo-marker-container geo-marker-ghost">
            <div class="geo-marker-pill">
              <span class="pin-icon">👻</span>
              <span class="pin-place">${gName}${gBirthPlace ? ` · ${gBirthPlace}` : ''}</span>
              <span class="pin-year">${gBirthYear}–${gDeathYear ?? (isSv ? 'nu' : 'now')}</span>
            </div>
            <div class="geo-marker-tip"></div>
            <div class="geo-marker-dot"></div>
          </div>
        `;
        L.marker(gBirthCoord, {
          icon: L.divIcon({ html: birthHtml, className: 'custom-geo-marker', iconSize: [0, 0], iconAnchor: [0, 0] }),
        }).addTo(ghostLayers);
      } else if (gDeathCoord) {
        const deathHtml = `
          <div class="geo-marker-container geo-marker-ghost">
            <div class="geo-marker-pill">
              <span class="pin-icon">👻</span>
              <span class="pin-place">${gName}${gDeathPlace ? ` · ${gDeathPlace}` : ''}</span>
              <span class="pin-year">${gBirthYear}–${gDeathYear ?? (isSv ? 'nu' : 'now')}</span>
            </div>
            <div class="geo-marker-tip"></div>
            <div class="geo-marker-dot"></div>
          </div>
        `;
        L.marker(gDeathCoord, {
          icon: L.divIcon({ html: deathHtml, className: 'custom-geo-marker', iconSize: [0, 0], iconAnchor: [0, 0] }),
        }).addTo(ghostLayers);
      }
    }
  }, [wrongGuesses, showGhostPins, lang, isSv]);

  const focusPersonOnMap = (person: Person) => {
    const map = mapRef.current;
    if (!map) return;
    setShowGhostPins(true);
    if (isMobile) {
      setIsMobileSheetExpanded(false);
    }
    const b = person.birthPlace?.coord;
    const d = person.deathPlace?.coord;
    if (b && d && haversineKm(b, d) >= 10) {
      const bounds = L.latLngBounds([b, d]).pad(isMobile ? 0.65 : 0.8);
      map.fitBounds(bounds, {
        paddingTopLeft: isMobile ? [32, 32] : [70, 70],
        paddingBottomRight: isMobile ? [32, 32] : [390, 70],
        maxZoom: 5.2,
        animate: true,
      });
    } else if (b) {
      map.setView(b, 5.0, { animate: true });
    } else if (d) {
      map.setView(d, 5.0, { animate: true });
    }
  };

  const pickRandomPreferUnsolved = (pool: Person[]): Person => {
    const unsolved = solvedPersonIds ? pool.filter((p) => !solvedPersonIds.has(p.id)) : pool;
    const source = unsolved.length > 0 ? unsolved : pool;
    return source[Math.floor(Math.random() * source.length)] || allPeople[0]!;
  };

  const handleNextPerson = (specified?: Person) => {
    let next: Person;
    if (specified) {
      next = specified;
    } else {
      const candidates = eligiblePeople.filter((p) => p.id !== currentPerson.id);
      next = pickRandomPreferUnsolved(candidates);
    }
    setCurrentPerson(next);
    setPurchasedClues(new Set());
    setExpandedClues(new Set(getFreeClues(next)));
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

  // Om användaren väljer "Spela som gåta i GeoGuesser" från PersonModal när GeoGuesser redan varit monterad
  useEffect(() => {
    if (!initialPersonId) return;
    const found = allPeople.find((p) => p.id === initialPersonId);
    if (found && found.id !== currentPerson.id) {
      if (isMatchActive) {
        cancelMatch();
      }
      handleNextPerson(found);
    }
  }, [initialPersonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterPeopleWith = (
    tiers: Tier[],
    centuries: string[],
    statuses: LifeStatusOption[],
    countries: string[],
    cMode: CountryMatchMode,
    bothCoords: boolean
  ) =>
    allPeople.filter((p) => {
      if (!matchesTiers(p, tiers)) return false;
      if (!matchesCenturies(p, centuries)) return false;
      if (!matchesLifeStatuses(p, statuses)) return false;
      if (!matchesCountries(p, countries, cMode)) return false;
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;
      if (bothCoords && (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate))) return false;
      return true;
    });

  const handleTierToggle = (tier: Tier) => {
    if (isMatchActive) return;
    const nextTiers = toggleTier(selectedTiers, tier);
    setSelectedTiers(nextTiers);
    const candidates = filterPeopleWith(nextTiers, selectedCenturies, lifeStatuses, selectedCountries, countryMatchMode, requireBothCoords);
    if (candidates.length > 0 && !matchesTiers(currentPerson, nextTiers)) {
      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
    }
  };

  const handleCenturyToggle = (century: string) => {
    if (isMatchActive) return;
    const nextCenturies = toggleCentury(selectedCenturies, century);
    setSelectedCenturies(nextCenturies);
    const candidates = filterPeopleWith(selectedTiers, nextCenturies, lifeStatuses, selectedCountries, countryMatchMode, requireBothCoords);
    if (candidates.length > 0 && !matchesCenturies(currentPerson, nextCenturies)) {
      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
    }
  };

  const handleLifeStatusToggle = (status: LifeStatusOption) => {
    if (isMatchActive) return;
    const nextStatuses = toggleLifeStatus(lifeStatuses, status);
    setLifeStatuses(nextStatuses);
    // Om endast "Nu levande" är valt och epokfiltret bara har sekler före 1900, nollställ epokfiltret så det finns kandidater
    const onlyLiving = nextStatuses.length === 1 && nextStatuses[0] === 'living';
    const nextCenturies =
      onlyLiving && selectedCenturies.length > 0 && !selectedCenturies.some((c) => c === '1900' || c === '2000')
        ? []
        : selectedCenturies;
    if (nextCenturies !== selectedCenturies) {
      setSelectedCenturies(nextCenturies);
    }
    const candidates = filterPeopleWith(selectedTiers, nextCenturies, nextStatuses, selectedCountries, countryMatchMode, requireBothCoords);
    if (candidates.length > 0 && !matchesLifeStatuses(currentPerson, nextStatuses)) {
      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
    }
  };

  const handleCountryToggle = (countryId: string) => {
    if (isMatchActive) return;
    const nextCountries = countryId === 'all' ? [] : toggleCountry(selectedCountries, countryId);
    setSelectedCountries(nextCountries);
    const candidates = filterPeopleWith(selectedTiers, selectedCenturies, lifeStatuses, nextCountries, countryMatchMode, requireBothCoords);
    if (candidates.length > 0 && !matchesCountries(currentPerson, nextCountries, countryMatchMode)) {
      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
    }
  };

  const handleCountryMatchModeChange = (nextMode: CountryMatchMode) => {
    if (isMatchActive) return;
    setCountryMatchMode(nextMode);
    const candidates = filterPeopleWith(selectedTiers, selectedCenturies, lifeStatuses, selectedCountries, nextMode, requireBothCoords);
    if (candidates.length > 0 && !matchesCountries(currentPerson, selectedCountries, nextMode)) {
      handleNextPerson(candidates[Math.floor(Math.random() * candidates.length)]!);
    }
  };

  const handleSwedishToggle = () => {
    handleCountryToggle('Q34');
  };

  // Data helpers (behövs för att avgöra vilka ledtrådar som finns tillgängliga för aktuell person)
  const name = loc(currentPerson.name, lang, isSv ? 'Okänd' : 'Unknown');
  const desc = loc(currentPerson.description, lang);
  const birthPlace = currentPerson.birthPlace;
  const deathPlace = currentPerson.deathPlace;
  const isRevealed = isSolved || isSurrendered;
  const safeBirthPlaceLabel = getSafePlaceName(birthPlace, currentPerson, lang, isRevealed, isSv ? 'Okänd ort' : 'Unknown');
  const safeDeathPlaceLabel = getSafePlaceName(deathPlace, currentPerson, lang, isRevealed, isSv ? 'Okänd ort' : 'Unknown');
  const birthCoord = birthPlace?.coord;
  const deathCoord = deathPlace?.coord;
  const birthYear = currentPerson.birthDate.year;
  const deathYear = currentPerson.deathDate?.year;
  const isLiving = !deathYear;
  const lifespan = deathYear ? deathYear - birthYear : new Date().getFullYear() - birthYear;
  const distanceKm = birthCoord && deathCoord ? haversineKm(birthCoord, deathCoord) : null;

  const occupations = currentPerson.occupations
    .map((o) => loc(o.name, lang))
    .filter(Boolean);
  const citizenship = currentPerson.citizenship
    .map((c) => loc(c.name, lang))
    .filter(Boolean);
  const works = currentPerson.notableWorks
    .map((w) => loc(w.name, lang))
    .filter(Boolean);

  // Jämförelsekort för alla felaktiga gissningar under pågående rond
  const guessFeedbacks = useMemo(
    () => wrongGuesses.map((gp) => compareGuess(gp, currentPerson, lang)),
    [wrongGuesses, currentPerson, lang]
  );

  // Härledda ledtråds-badges från nära gissningar
  const deducedProfileHint = useMemo(() => {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const fb of guessFeedbacks) {
      for (const cat of fb.sharedCategories) {
        const info = QUIZ_CATEGORIES[cat];
        if (info && !seen.has(cat)) {
          seen.add(cat);
          parts.push(`${info.icon} ${info[lang] || info.sv}`);
        }
      }
      if (fb.matchedGenderLabel && !seen.has('gender')) {
        seen.add('gender');
        parts.push(fb.matchedGenderLabel);
      }
      for (const cit of fb.sharedCitizenships) {
        if (!seen.has(cit)) {
          seen.add(cit);
          parts.push(cit);
        }
      }
    }
    return parts.length > 0 ? parts.slice(0, 3).join(' · ') : null;
  }, [guessFeedbacks, lang]);

  const deducedOccupationHint = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const fb of guessFeedbacks) {
      for (const occ of fb.sharedOccupations) {
        if (!seen.has(occ)) {
          seen.add(occ);
          list.push(occ.charAt(0).toUpperCase() + occ.slice(1));
        }
      }
    }
    return list.length > 0 ? list.slice(0, 2).join(', ') : null;
  }, [guessFeedbacks]);

  // Vilka ledtrådar som faktiskt har data för aktuell person (5-stegsstege)
  const availableClues = useMemo<ClueType[]>(() => {
    const list: ClueType[] = ['profile'];
    if (occupations.length > 0 || desc) list.push('occupation');
    if (works.length > 0) list.push('works');
    list.push('wikiSummary');
    if (currentPerson.image?.thumb) list.push('portrait');
    return list;
  }, [occupations.length, desc, works.length, currentPerson.image?.thumb]);

  const freeClues = useMemo(() => new Set(getFreeClues(currentPerson)), [currentPerson]);

  const toggleClue = (type: ClueType) => {
    if (!isSolved && !isSurrendered && !purchasedClues.has(type) && !freeClues.has(type)) {
      setPurchasedClues((prev) => {
        const next = new Set(prev);
        next.add(type);
        return next;
      });
      setExpandedClues((prev) => {
        const next = new Set(prev);
        next.add(type);
        return next;
      });
      return;
    }

    // Om ledtråden redan är köpt eller om gåtan är över: växla bara expanderat läge (ingen poängåterbetalning!)
    setExpandedClues((prev) => {
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
    let base = getBasePoints(currentPerson.tier);
    for (const clue of purchasedClues) {
      base -= CLUE_COSTS[clue] ?? 100;
    }
    base -= wrongGuesses.length * WRONG_GUESS_PENALTY;
    return Math.max(MIN_ROUND_SCORE, base);
  }, [currentPerson, purchasedClues, wrongGuesses]);

  const score = earnedRoundScore ?? (isSolved ? currentPotentialScore : 0);

  const handleSelectGuess = (person: Person) => {
    setShowSuggestions(false);
    setSearchQuery('');

    if (person.id === currentPerson.id) {
      const cluesCost = Array.from(purchasedClues).reduce((sum, c) => sum + (CLUE_COSTS[c] ?? 0), 0);
      const wrongCost = wrongGuesses.length * WRONG_GUESS_PENALTY;
      const base = getBasePoints(currentPerson.tier);
      const finalScore = Math.max(MIN_ROUND_SCORE, base - cluesCost - wrongCost);

      setEarnedRoundScore(finalScore);
      setDeductionsAtEnd({ cluesCost, wrongCost });
      setIsSolved(true);

      onRoundComplete?.({
        personId: currentPerson.id,
        personName: loc(currentPerson.name, lang, 'Okänd'),
        tier: currentPerson.tier,
        score: finalScore,
        isSolved: true,
        cluesUsedCount: purchasedClues.size,
        wrongGuessesCount: wrongGuesses.length,
      });

      if (isMatchActive) {
        const newResult: MatchRoundResult = {
          person: currentPerson,
          score: finalScore,
          isSolved: true,
          cluesUsed: Array.from(purchasedClues),
          wrongGuessesCount: wrongGuesses.length,
        };
        const updatedResults = [...matchResults, newResult];
        setMatchResults(updatedResults);

        if (currentRoundIndex === 4) {
          onMatchComplete?.({
            totalScore: updatedResults.reduce((acc, r) => acc + r.score, 0),
            solvedCount: updatedResults.filter((r) => r.isSolved).length,
            tierFilter: selectedTiers.join(','),
            centuryFilter: selectedCenturies.length === 0 ? 'all' : selectedCenturies.join(','),
            swedishOnly: selectedCountries.length === 1 && selectedCountries[0] === 'Q34',
            rounds: updatedResults.map((r) => ({
              personId: r.person.id,
              personName: loc(r.person.name, lang, 'Okänd'),
              score: r.score,
              isSolved: r.isSolved,
            })),
          });
        }
      }

      // Avslöja alla tillgängliga ledtrådar för fri läsning efter rätt svar utan att påverka poängen
      setExpandedClues(new Set(availableClues));
      setIsSidebarOpen(true);
      setIsMobileSheetExpanded(true);
    } else {
      if (!wrongGuesses.some((wg) => wg.id === person.id)) {
        setWrongGuesses((prev) => [person, ...prev]);
      }
    }
  };

  const handleSurrender = () => {
    const cluesCost = Array.from(purchasedClues).reduce((sum, c) => sum + (CLUE_COSTS[c] ?? 0), 0);
    const wrongCost = wrongGuesses.length * WRONG_GUESS_PENALTY;
    setIsSurrendered(true);
    setEarnedRoundScore(0);
    setDeductionsAtEnd({ cluesCost, wrongCost });

    onRoundComplete?.({
      personId: currentPerson.id,
      personName: loc(currentPerson.name, lang, 'Okänd'),
      tier: currentPerson.tier,
      score: 0,
      isSolved: false,
      cluesUsedCount: purchasedClues.size,
      wrongGuessesCount: wrongGuesses.length,
    });

    if (isMatchActive) {
      const newResult: MatchRoundResult = {
        person: currentPerson,
        score: 0,
        isSolved: false,
        cluesUsed: Array.from(purchasedClues),
        wrongGuessesCount: wrongGuesses.length,
      };
      const updatedResults = [...matchResults, newResult];
      setMatchResults(updatedResults);

      if (currentRoundIndex === 4) {
        onMatchComplete?.({
          totalScore: updatedResults.reduce((acc, r) => acc + r.score, 0),
          solvedCount: updatedResults.filter((r) => r.isSolved).length,
          tierFilter: selectedTiers.join(','),
          centuryFilter: selectedCenturies.length === 0 ? 'all' : selectedCenturies.join(','),
          swedishOnly: selectedCountries.length === 1 && selectedCountries[0] === 'Q34',
          rounds: updatedResults.map((r) => ({
            personId: r.person.id,
            personName: loc(r.person.name, lang, 'Okänd'),
            score: r.score,
            isSolved: r.isSolved,
          })),
        });
      }
    }
    setExpandedClues(new Set(availableClues));
    setIsSidebarOpen(true);
    setIsMobileSheetExpanded(true);
  };

  const startMatch = (
    centuries: string[],
    tiers: Tier[],
    statuses: LifeStatusOption[],
    countries: string[],
    cMode: CountryMatchMode
  ) => {
    const candidates = filterPeopleWith(tiers, centuries, statuses, countries, cMode, requireBothCoords);

    if (candidates.length < 5) {
      alert(isSv ? 'För få personer matchar filtret för en match på 5 ronder (behövs minst 5).' : 'Not enough people match the filter for a 5-round match (at least 5 needed).');
      return;
    }

    const unsolved = solvedPersonIds ? candidates.filter((p) => !solvedPersonIds.has(p.id)) : candidates;
    const pool = unsolved.length >= 5 ? unsolved : candidates;
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const five = shuffled.slice(0, 5);

    setSelectedCenturies(centuries);
    setSelectedTiers(tiers);
    setLifeStatuses(statuses);
    setSelectedCountries(countries);
    setCountryMatchMode(cMode);

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
    if (!purchasedClues.has('wikiSummary') && !expandedClues.has('wikiSummary') && !isSolved && !isSurrendered) return;
    if (wikiData || wikiLoading) return;

    setWikiLoading(true);
    getPersonWikipediaSummary(currentPerson, lang)
      .then((data) => {
        if (data) setWikiData(data);
      })
      .finally(() => {
        setWikiLoading(false);
      });
  }, [purchasedClues, expandedClues, isSolved, isSurrendered, currentPerson, lang, wikiData, wikiLoading]);

  const sanitizedWikiSummary = wikiData?.sanitized || '';
  const wikiSummary = wikiData?.raw || null;
  const wikiTitle = wikiData?.title || currentPerson.wiki[lang] || currentPerson.wiki.sv || currentPerson.wiki.en;
  const wikiDomain = wikiData?.lang || (currentPerson.wiki[lang] ? lang : (currentPerson.wiki.sv ? 'sv' : 'en'));
  const wikiUrl = wikiTitle
    ? `https://${wikiDomain}.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`
    : undefined;

  const matchCandidatesCount = useMemo(() => {
    return allPeople.filter((p) => {
      if (!matchesTiers(p, matchTiers)) return false;
      if (!matchesCenturies(p, matchCenturies)) return false;
      if (!matchesLifeStatuses(p, matchLifeStatuses)) return false;
      if (!matchesCountries(p, matchCountries, matchCountryMatchMode)) return false;
      if (!p.birthPlace?.coord && !p.deathPlace?.coord) return false;
      if (requireBothCoords && (!p.birthPlace?.coord || (!p.deathPlace?.coord && p.deathDate))) return false;
      return true;
    }).length;
  }, [allPeople, matchTiers, matchCenturies, matchLifeStatuses, matchCountries, matchCountryMatchMode, requireBothCoords]);

  const availableMatchCountries = useMemo(
    () => extractAvailableCountries(allPeople, lang, matchCountryMatchMode),
    [allPeople, lang, matchCountryMatchMode]
  );

  const availableFreePlayCountries = useMemo(
    () => extractAvailableCountries(allPeople, lang, countryMatchMode),
    [allPeople, lang, countryMatchMode]
  );

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: isMobile ? 'flex' : 'block',
        flexDirection: 'column',
      }}
    >
      {/* MOBIL ZON 1: DOCKAD TOPPBALK MED LIVSRESA, SNABBKONTROLLER & SÖKFÄLT HÖGST UPP (TANGENTBORDSSÄKER!) */}
      {isMobile && (
        <div
          style={{
            flexShrink: 0,
            background: '#ffffff',
            borderBottom: '1.5px solid var(--border-color)',
            padding: '8px 10px',
            zIndex: 1200,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
          }}
        >
          {/* Rad 1: Livsresa (Född -> Död + Ålder) & Snabbknappar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                minWidth: 0,
                flex: 1,
                overflowX: 'auto',
                scrollbarWidth: 'none',
              }}
            >
              {/* Född */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  padding: '4px 8px',
                  borderRadius: '999px',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: '0.88rem' }}>🐣</span>
                <strong style={{ color: '#166534', fontWeight: 900, fontSize: '0.88rem' }}>{birthYear}</strong>
                <span
                  style={{
                    color: '#0f172a',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    maxWidth: '92px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {safeBirthPlaceLabel}
                </span>
              </div>

              <span style={{ color: '#94a3b8', fontWeight: 900, fontSize: '0.82rem', flexShrink: 0 }}>➔</span>

              {/* Död */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: isLiving ? '#fff1f2' : '#fef2f2',
                  border: isLiving ? '1px solid #fecdd3' : '1px solid #fecaca',
                  padding: '4px 8px',
                  borderRadius: '999px',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: '0.88rem' }}>{isLiving ? '❤️' : '🪦'}</span>
                <strong style={{ color: isLiving ? '#be123c' : '#991b1b', fontWeight: 900, fontSize: '0.88rem' }}>
                  {isLiving ? (isSv ? 'Nu' : 'Now') : deathYear}
                </strong>
                {!isLiving && (
                  <span
                    style={{
                      color: '#0f172a',
                      fontWeight: 700,
                      fontSize: '0.84rem',
                      maxWidth: '92px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {safeDeathPlaceLabel}
                  </span>
                )}
              </div>

              {/* Ålder */}
              <span
                style={{
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  color: '#1e40af',
                  padding: '4px 7px',
                  borderRadius: '999px',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  flexShrink: 0,
                }}
              >
                {lifespan} {isSv ? 'år' : 'yr'}
              </span>
            </div>

            {/* Snabbknappar (Filter, Ny, Match) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
              {!isMatchActive && (
                <>
                  <button
                    onClick={() => setShowMobileFilterModal(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      minHeight: '34px',
                      padding: '5px 9px',
                      borderRadius: '10px',
                      background:
                        selectedCenturies.length > 0 ||
                        !(selectedTiers.length === 1 && selectedTiers[0] === 'standard') ||
                        !(lifeStatuses.length === 1 && lifeStatuses[0] === 'historical') ||
                        selectedCountries.length > 0 ||
                        !requireBothCoords
                          ? 'var(--accent-blue)'
                          : '#f8fafc',
                      color:
                        selectedCenturies.length > 0 ||
                        !(selectedTiers.length === 1 && selectedTiers[0] === 'standard') ||
                        !(lifeStatuses.length === 1 && lifeStatuses[0] === 'historical') ||
                        selectedCountries.length > 0 ||
                        !requireBothCoords
                          ? '#fff'
                          : 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      fontWeight: 800,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Filter' : 'Filters'}
                  >
                    <SlidersHorizontal size={14} />
                  </button>

                  <button
                    onClick={() => handleNextPerson()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      minHeight: '34px',
                      padding: '5px 9px',
                      borderRadius: '10px',
                      background: '#f8fafc',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      fontWeight: 800,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Ny gåta' : 'New puzzle'}
                  >
                    <Shuffle size={14} style={{ color: 'var(--accent-gold-dark)' }} />
                  </button>
                </>
              )}

              <button
                onClick={() => {
                  if (isMatchActive) {
                    if (confirm(isSv ? 'Avbryta matchen?' : 'Cancel match?')) {
                      cancelMatch();
                    }
                  } else {
                    setMatchCenturies(selectedCenturies);
                    setMatchTiers(selectedTiers);
                    setMatchLifeStatuses(lifeStatuses);
                    setMatchCountries(selectedCountries);
                    setMatchCountryMatchMode(countryMatchMode);
                    setShowMatchModal(true);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  minHeight: '34px',
                  padding: '5px 9px',
                  borderRadius: '10px',
                  background: isMatchActive ? 'linear-gradient(135deg, #1e3a8a, #2563eb)' : '#eff6ff',
                  color: isMatchActive ? '#fff' : '#1e3a8a',
                  border: isMatchActive ? 'none' : '1px solid #bfdbfe',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
                title="Match"
              >
                <Trophy size={14} style={{ color: isMatchActive ? '#fbbf24' : '#2563eb' }} />
                {isMatchActive && <span>{currentRoundIndex + 1}/5</span>}
              </button>
            </div>
          </div>

          {/* Eventuell varning om en ort saknar koordinater */}
          {(!birthCoord || (!deathCoord && !isLiving)) && (
            <div
              style={{
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fde68a',
                padding: '3px 10px',
                borderRadius: '8px',
                fontSize: '0.76rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AlertTriangle size={13} />
              <span>
                {!birthCoord && !deathCoord
                  ? isSv
                    ? 'Inga koordinater'
                    : 'No coordinates'
                  : !birthCoord
                  ? isSv
                    ? `"${safeBirthPlaceLabel}" saknar koordinater`
                    : `"${safeBirthPlaceLabel}" lacks coords`
                  : isSv
                  ? `"${safeDeathPlaceLabel}" saknar koordinater`
                  : `"${safeDeathPlaceLabel}" lacks coords`}
              </span>
            </div>
          )}

          {/* Rad 2: Topp-dockat Sökfält (under pågående gissning) ELLER Snabb resultatrad (efter avslutad gåta) */}
          {!isSolved && !isSurrendered ? (
            <div style={{ position: 'relative' }}>
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--accent-blue)',
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
                placeholder={isSv ? 'Gissa vem personen är...' : 'Guess who it is...'}
                style={{
                  width: '100%',
                  padding: '10px 38px 10px 38px',
                  borderRadius: '10px',
                  border: '2px solid var(--border-focus)',
                  fontSize: '16px',
                  fontWeight: 600,
                  outline: 'none',
                  background: '#fcfaf5',
                  color: '#0f172a',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '4px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    width: '34px',
                    height: '34px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={18} />
                </button>
              )}

              {/* Autocomplete-dropdown öppnas NEDÅT från topp-sökfältet så tangentbordet aldrig täcker den! */}
              {showSuggestions && suggestions.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 5px)',
                    left: 0,
                    right: 0,
                    background: '#ffffff',
                    borderRadius: '12px',
                    border: '2px solid var(--accent-blue)',
                    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.28)',
                    zIndex: 9999,
                    maxHeight: '220px',
                    overflowY: 'auto',
                  }}
                >
                  {suggestions.map((p) => {
                    const pName = loc(p.name, lang, isSv ? 'Okänd' : 'Unknown');
                    const alreadyGuessed = wrongGuesses.some((wg) => wg.id === p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          if (!alreadyGuessed) handleSelectGuess(p);
                        }}
                        style={{
                          padding: '12px 14px',
                          minHeight: '46px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid #f1f5f9',
                          cursor: alreadyGuessed ? 'not-allowed' : 'pointer',
                          background: alreadyGuessed ? '#f8fafc' : '#ffffff',
                          opacity: alreadyGuessed ? 0.6 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{alreadyGuessed ? '👻' : '👤'}</span>
                          <span style={{ fontWeight: 800, fontSize: '0.96rem', color: '#0f172a' }}>{pName}</span>
                        </div>
                        {alreadyGuessed ? (
                          <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, flexShrink: 0 }}>
                            {isSv ? 'Redan gissad' : 'Guessed'}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.8rem',
                              color: '#ffffff',
                              background: 'var(--accent-blue)',
                              padding: '4px 10px',
                              borderRadius: '999px',
                              fontWeight: 800,
                              flexShrink: 0,
                            }}
                          >
                            {isSv ? 'Gissa' : 'Guess'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '6px 10px',
                borderRadius: '10px',
                background: isSolved ? '#dcfce7' : '#fee2e2',
                border: `1.5px solid ${isSolved ? '#4ade80' : '#fca5a5'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <span>{isSolved ? '🎉' : '👀'}</span>
                <strong
                  style={{
                    fontSize: '0.95rem',
                    color: '#0f172a',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </strong>
                {isSolved && (
                  <span
                    style={{
                      background: '#166534',
                      color: '#fff',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: '999px',
                      flexShrink: 0,
                    }}
                  >
                    +{score} p
                  </span>
                )}
              </div>

              <button
                onClick={() => {
                  if (isMatchActive) {
                    if (currentRoundIndex < 4) handleNextMatchRound();
                    else setIsMatchSummaryOpen(true);
                  } else {
                    handleNextPerson();
                  }
                }}
                style={{
                  background: 'var(--accent-blue)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
              >
                <span>{isSv ? 'Nästa' : 'Next'}</span>
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 1. KARTYTA (PÅ MOBIL: DEDIKERAD FRILAGD FLEX-YTA MELLAN TOPP & BOTTEN; PÅ DESKTOP: 100% HELSKÄRM) */}
      <div
        ref={mapContainerRef}
        style={{
          width: '100%',
          flex: isMobile ? 1 : undefined,
          height: isMobile ? 'auto' : '100%',
          minHeight: isMobile ? '150px' : undefined,
          zIndex: 1,
        }}
      />

      {/* 2 & 3. DESKTOP TOPP-OVERLAY: KONTROLLER TILL VÄNSTER & KOMPAKT LIVSRESA-HUD CENTRERAD PÅ KARTYTA (INGEN ÖVERLAPPNING!) */}
      {!isMobile && (
        <div
          style={{
            position: 'absolute',
            top: '14px',
            left: '14px',
            right: isSidebarOpen ? '413px' : '14px',
            zIndex: 1000,
            pointerEvents: 'none',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          {/* Vänster: Filter (i frispel) ELLER kompakt matchstatus (under pågående 5-ronders match) */}
          <div
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(12px)',
              padding: '6px 10px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            }}
          >
            {isMatchActive ? (
              <>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    color: '#1e3a8a',
                    fontWeight: 800,
                    fontSize: '0.8rem',
                  }}
                >
                  <Trophy size={14} style={{ color: '#d97706' }} />
                  <span>
                    {isSv ? `Match: Rond ${currentRoundIndex + 1} av 5` : `Match: Round ${currentRoundIndex + 1} of 5`}
                  </span>
                </div>
                <span
                  style={{
                    padding: '4px 9px',
                    borderRadius: '8px',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    color: '#92400e',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                  }}
                >
                  {matchResults.reduce((sum, r) => sum + r.score, 0)} p
                </span>
                <button
                  onClick={() => {
                    if (confirm(isSv ? 'Vill du avbryta den pågående matchen?' : 'Do you want to cancel the active match?')) {
                      cancelMatch();
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: '#fef2f2',
                    color: '#b91c1c',
                    border: '1px solid #fecaca',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                  title={isSv ? 'Avbryt pågående match' : 'Cancel active match'}
                >
                  <X size={13} />
                  {isSv ? 'Avbryt' : 'Cancel'}
                </button>
              </>
            ) : (
              <>
                {/* Svårighetsgrad (flerval utan "Alla"-knapp): Standard / Svår / Mycket svår */}
                <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                  <button
                    onClick={() => handleTierToggle('standard')}
                    style={{
                      padding: '5px 9px',
                      background: selectedTiers.includes('standard') ? 'var(--accent-blue)' : '#fff',
                      color: selectedTiers.includes('standard') ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      fontWeight: selectedTiers.includes('standard') ? 800 : 500,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Standard: Välkända personer & ikoner (flerval)' : 'Standard: Well-known icons & figures (multi-select)'}
                  >
                    ⭐ {isSv ? 'Standard' : 'Standard'}
                  </button>
                  <button
                    onClick={() => handleTierToggle('hard')}
                    style={{
                      padding: '5px 9px',
                      background: selectedTiers.includes('hard') ? 'var(--accent-blue)' : '#fff',
                      color: selectedTiers.includes('hard') ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      borderLeft: '1px solid var(--border-color)',
                      fontWeight: selectedTiers.includes('hard') ? 800 : 500,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Svår: God allmänbildning & historia (flerval)' : 'Hard: General knowledge & history (multi-select)'}
                  >
                    🔥 {isSv ? 'Svår' : 'Hard'}
                  </button>
                  <button
                    onClick={() => handleTierToggle('very_hard')}
                    style={{
                      padding: '5px 9px',
                      background: selectedTiers.includes('very_hard') ? 'var(--accent-blue)' : '#fff',
                      color: selectedTiers.includes('very_hard') ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      borderLeft: '1px solid var(--border-color)',
                      fontWeight: selectedTiers.includes('very_hard') ? 800 : 500,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Mycket svår: Fördjupad nisch & historia (väljer alla 3 från start, klicka för att avmarkera)' : 'Very Hard: In-depth niche & history'}
                  >
                    ⚡ {isSv ? 'Mycket svår' : 'Very Hard'}
                  </button>
                </div>

                {/* Livsstatus / Spelläge (flerval utan "Båda"-knapp): Historiska & Nu levande */}
                <div
                  style={{
                    display: 'inline-flex',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    overflow: 'hidden',
                    background: '#fff',
                  }}
                >
                  <button
                    onClick={() => handleLifeStatusToggle('historical')}
                    style={{
                      padding: '5px 9px',
                      background: lifeStatuses.includes('historical') ? '#7c2d12' : '#fff',
                      color: lifeStatuses.includes('historical') ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      fontWeight: lifeStatuses.includes('historical') ? 800 : 500,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Historiska (avlidna) personer – kan kombineras med Nu levande' : 'Historical (deceased) figures – can combine with Living'}
                  >
                    🏛️ {isSv ? 'Historiska' : 'Historical'}
                  </button>
                  <button
                    onClick={() => handleLifeStatusToggle('living')}
                    style={{
                      padding: '5px 9px',
                      background: lifeStatuses.includes('living') ? '#be123c' : '#fff',
                      color: lifeStatuses.includes('living') ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      borderLeft: '1px solid var(--border-color)',
                      fontWeight: lifeStatuses.includes('living') ? 800 : 500,
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Nu levande personer – kan kombineras med Historiska' : 'Living people – can combine with Historical'}
                  >
                    🌟 {isSv ? 'Nu levande' : 'Living'}
                  </button>
                </div>

                {/* Snabbknapp för Sverige + Fler epoker & länder */}
                <button
                  onClick={handleSwedishToggle}
                  style={{
                    padding: '5px 9px',
                    borderRadius: '6px',
                    border: selectedCountries.includes('Q34') ? '1px solid #137333' : '1px solid var(--border-color)',
                    background: selectedCountries.includes('Q34') ? '#e6f4ea' : '#fff',
                    color: selectedCountries.includes('Q34') ? '#137333' : 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                  }}
                  title={isSv ? 'Växla Sverige i landfiltret' : 'Toggle Sweden in country filter'}
                >
                  🇸🇪 {isSv ? 'Sverige' : 'Sweden'}
                </button>

                <button
                  onClick={() => setShowMobileFilterModal(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 9px',
                    borderRadius: '6px',
                    border:
                      selectedCenturies.length > 0 || selectedCountries.some((c) => c !== 'Q34') || selectedCountries.length > 1
                        ? '1.5px solid var(--accent-blue)'
                        : '1px solid var(--border-color)',
                    background:
                      selectedCenturies.length > 0 || selectedCountries.some((c) => c !== 'Q34') || selectedCountries.length > 1
                        ? '#eff6ff'
                        : '#fff',
                    color:
                      selectedCenturies.length > 0 || selectedCountries.some((c) => c !== 'Q34') || selectedCountries.length > 1
                        ? 'var(--accent-blue)'
                        : 'var(--text-primary)',
                    fontWeight: 700,
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                  }}
                  title={isSv ? 'Välj flera epoker (födelse-/dödsår) och länder' : 'Select multiple epochs and countries'}
                >
                  <SlidersHorizontal size={13} />
                  <span>
                    {selectedCenturies.length > 0
                      ? `${selectedCenturies.length} ${isSv ? 'epoker' : 'eras'}`
                      : isSv
                      ? 'Alla epoker'
                      : 'All eras'}
                    {selectedCountries.length > 0
                      ? ` · ${selectedCountries.length} ${isSv ? 'land' : 'country'}`
                      : ''}
                  </span>
                </button>

                {/* Hel resa filter-knapp (döljs om endast "Nu levande" är valt) */}
                {!(lifeStatuses.length === 1 && lifeStatuses[0] === 'living') && (
                  <button
                    onClick={() => {
                      const nextVal = !requireBothCoords;
                      setRequireBothCoords(nextVal);
                      if (nextVal && (!currentPerson.birthPlace?.coord || (!currentPerson.deathPlace?.coord && currentPerson.deathDate))) {
                        const candidates = filterPeopleWith(
                          selectedTiers,
                          selectedCenturies,
                          lifeStatuses,
                          selectedCountries,
                          countryMatchMode,
                          nextVal
                        );
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
                      cursor: 'pointer',
                    }}
                    title={isSv ? 'Kräver både födelse- och dödsort på kartan' : 'Require both coords on map'}
                  >
                    🗺️ {isSv ? 'Hel resa' : 'Full journey'}
                  </button>
                )}

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
                    setMatchCenturies(selectedCenturies);
                    setMatchTiers(selectedTiers);
                    setMatchLifeStatuses(lifeStatuses);
                    setMatchCountries(selectedCountries);
                    setMatchCountryMatchMode(countryMatchMode);
                    setShowMatchModal(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 11px',
                    borderRadius: '6px',
                    background: '#fff',
                    color: '#1e3a8a',
                    border: '1.5px solid #2563eb',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                  title={isSv ? 'Starta en match med 5 gåtor' : 'Start a 5-round match'}
                >
                  <Trophy size={13} style={{ color: '#2563eb' }} />
                  {isSv ? '🏆 Spela match (5 gåtor)' : '🏆 Play match (5 rounds)'}
                </button>
              </>
            )}
          </div>

          {/* Höger / Mitten: Kompakt Fakta-HUD (Född -> Död + Ålder/Avstånd) */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              margin: '0 auto',
            }}
          >
            <div
              style={{
                pointerEvents: 'auto',
                background: '#ffffff',
                padding: '7px 16px',
                borderRadius: '999px',
                border: '2px solid #cbd5e1',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                fontSize: '0.86rem',
                whiteSpace: 'nowrap',
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
                  padding: '4px 10px',
                  borderRadius: '999px',
                }}
              >
                <span style={{ fontSize: '0.92rem' }}>🐣</span>
                <strong style={{ color: '#166534', fontWeight: 900, fontSize: '0.92rem' }}>{birthYear}</strong>
                <span style={{ color: '#0f172a', fontWeight: 700 }}>{safeBirthPlaceLabel}</span>
              </div>

              <span style={{ color: '#94a3b8', fontWeight: 900, fontSize: '0.92rem' }}>➔</span>

              {/* Död */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  minWidth: 0,
                  background: isLiving ? '#fff1f2' : '#fef2f2',
                  border: isLiving ? '1px solid #fecdd3' : '1px solid #fecaca',
                  padding: '4px 10px',
                  borderRadius: '999px',
                }}
              >
                <span style={{ fontSize: '0.92rem' }}>{isLiving ? '❤️' : '🪦'}</span>
                <strong style={{ color: isLiving ? '#be123c' : '#991b1b', fontWeight: 900, fontSize: '0.92rem' }}>
                  {isLiving ? (isSv ? 'Levande' : 'Alive') : deathYear}
                </strong>
                {!isLiving && <span style={{ color: '#0f172a', fontWeight: 700 }}>{safeDeathPlaceLabel}</span>}
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
                    fontSize: '0.8rem',
                  }}
                >
                  {lifespan} {isSv ? 'år' : 'yr'}
                </span>
                {distanceKm !== null && (
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
                  padding: '4px 12px',
                  borderRadius: '999px',
                  fontSize: '0.74rem',
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
                    ? isSv
                      ? 'Inga koordinater'
                      : 'No coordinates'
                    : !birthCoord
                    ? isSv
                      ? `"${safeBirthPlaceLabel}" saknar koordinater`
                      : `"${safeBirthPlaceLabel}" lacks coords`
                    : isSv
                    ? `"${safeDeathPlaceLabel}" saknar koordinater`
                    : `"${safeDeathPlaceLabel}" lacks coords`}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MOBIL ZON 3: DOCKAD BOTTENBALK (POÄNG + SENASTE SPÅRJAKT + STOR LEDTRÅDSKNAPP) */}
      {isMobile && (
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            flexShrink: 0,
            background: '#ffffff',
            borderTop: '1.5px solid var(--border-color)',
            padding: '8px 12px calc(8px + env(safe-area-inset-bottom, 0px))',
            zIndex: 1100,
            boxShadow: '0 -3px 14px rgba(0, 0, 0, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* Om användaren gissat fel: visa senaste gissningens spårkort direkt i bottenbalken med läsbar text! */}
          {!isSolved && !isSurrendered && guessFeedbacks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569' }}>
                  {isSv ? `Senaste gissning (${guessFeedbacks.length}):` : `Latest guess (${guessFeedbacks.length}):`}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {guessFeedbacks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setIsMobileSheetExpanded(true)}
                      style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        color: '#1d4ed8',
                        borderRadius: '999px',
                        padding: '3px 9px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {isSv ? `Alla (${guessFeedbacks.length}) ▲` : `All (${guessFeedbacks.length}) ▲`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowGhostPins((v) => !v)}
                    style={{
                      background: showGhostPins ? '#f1f5f9' : '#fff',
                      border: '1px solid #cbd5e1',
                      color: showGhostPins ? '#334155' : '#94a3b8',
                      borderRadius: '999px',
                      padding: '3px 9px',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>👻</span>
                    <span>{showGhostPins ? (isSv ? 'Nålar: På' : 'Pins: On') : (isSv ? 'Nålar: Av' : 'Pins: Off')}</span>
                  </button>
                </div>
              </div>

              {guessFeedbacks.slice(0, 1).map((fb) => (
                <div
                  key={fb.guessed.id}
                  onClick={() => focusPersonOnMap(fb.guessed)}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderLeft: fb.positiveBadges.length > 0 ? '4px solid #16a34a' : '4px solid #ef4444',
                    borderRadius: '10px',
                    padding: '7px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span style={{ color: '#dc2626', fontWeight: 900, fontSize: '0.84rem' }}>✕</span>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '0.9rem',
                          color: '#0f172a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fb.name}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, flexShrink: 0 }}>
                        ({fb.lifespanText})
                      </span>
                    </div>
                    <span style={{ fontSize: '0.76rem', color: '#334155', fontWeight: 800, flexShrink: 0 }}>
                      {fb.eraText}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                    {fb.positiveBadges.length > 0 ? (
                      fb.positiveBadges.map((badge, bIdx) => (
                        <span
                          key={bIdx}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#dcfce7',
                            color: '#166534',
                            border: '1px solid #86efac',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '0.76rem',
                            fontWeight: 800,
                          }}
                        >
                          <span>{badge.icon}</span>
                          <span>{badge.label}</span>
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.76rem', color: '#64748b', fontStyle: 'italic' }}>
                        {isSv ? 'Ingen träff på kategori, yrke eller ort' : 'No match on category, occupation, or place'}
                      </span>
                    )}
                    {fb.birthDistanceKm !== null && !fb.sameBirthPlace && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: '0.75rem',
                          color: '#475569',
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        📍 {fb.birthDistanceKm} km
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Nedersta raden i dockade bottenbalken: Aktuell poäng + Stor tumvänlig knapp för Ledtrådar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '9px 13px',
                borderRadius: '12px',
                background: '#fff9e6',
                border: '1.5px solid #fbbf24',
                color: '#92400e',
                fontWeight: 900,
                fontSize: '0.92rem',
                flexShrink: 0,
              }}
            >
              <Sparkles size={15} style={{ color: '#d97706' }} />
              <span>{isSolved || isSurrendered ? `${score} p` : `${currentPotentialScore} p`}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsMobileSheetExpanded(true)}
              style={{
                flex: 1,
                minHeight: '44px',
                padding: '10px 14px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.92rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.28)',
                cursor: 'pointer',
              }}
            >
              <span>
                {isSolved || isSurrendered
                  ? isSv
                    ? '📖 Visa biografi & alla fakta'
                    : '📖 View biography & facts'
                  : isSv
                  ? `🧩 Visa ledtrådar (${purchasedClues.size}/${availableClues.length})`
                  : `🧩 View clues (${purchasedClues.size}/${availableClues.length})`}
              </span>
              {(deducedProfileHint || deducedOccupationHint) && !isSolved && !isSurrendered && (
                <span
                  style={{
                    background: '#4ade80',
                    color: '#064e3b',
                    fontSize: '0.72rem',
                    fontWeight: 900,
                    padding: '1px 6px',
                    borderRadius: '999px',
                  }}
                >
                  💡
                </span>
              )}
              <ChevronUp size={18} />
            </button>
          </div>
        </div>
      )}

      {/* MOBIL BACKDROP NÄR LEDTRÅDSPANELEN ÄR ÖPPEN (KLICK PÅ KARTAN STÄNGER PANELEN) */}
      {isMobile && isMobileSheetExpanded && (
        <div
          onClick={() => setIsMobileSheetExpanded(false)}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.3)',
            zIndex: 1250,
          }}
        />
      )}

      {/* 4. FLYTANDE SIDOPANEL PÅ DESKTOP / EXPANDERBAR LEDTRÅDS-DRAWER PÅ MOBIL */}
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
                  height: '80%',
                  maxHeight: '80%',
                  transform: isMobileSheetExpanded ? 'translateY(0)' : 'translateY(105%)',
                  pointerEvents: isMobileSheetExpanded ? 'auto' : 'none',
                  transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
                  willChange: 'transform',
                  width: '100%',
                  maxWidth: '100vw',
                  borderRadius: '22px 22px 0 0',
                  boxShadow: '0 -10px 36px rgba(0, 0, 0, 0.28)',
                  zIndex: 1300,
                }
              : {
                  top: '14px',
                  right: '14px',
                  bottom: '14px',
                  width: '385px',
                  maxWidth: 'calc(100vw - 28px)',
                  borderRadius: '16px',
                  boxShadow: '0 12px 36px rgba(0, 0, 0, 0.18)',
                  zIndex: 1000,
                }),
            background: 'rgba(255, 255, 255, 0.99)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Mobil drag handle */}
          {isMobile && (
            <div
              onClick={() => setIsMobileSheetExpanded(false)}
              style={{
                width: '100%',
                padding: '10px 0 4px',
                display: 'flex',
                justifyContent: 'center',
                cursor: 'pointer',
                background: '#faf6ed',
              }}
            >
              <div style={{ width: '48px', height: '5px', borderRadius: '3px', background: '#cbd5e1' }} />
            </div>
          )}

          {/* Header på panelen */}
          <div
            style={{
              padding: isMobile ? '10px 14px' : '12px 16px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#faf6ed',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
              <Compass size={18} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
              <span
                style={{
                  fontWeight: 800,
                  fontSize: isMobile ? '0.98rem' : '0.92rem',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {isSolved
                  ? isSv
                    ? '🎉 Rätt svar!'
                    : '🎉 Correct!'
                  : isSurrendered
                  ? isSv
                    ? 'Svar avslöjat'
                    : 'Answer'
                  : isSv
                  ? 'Ledtrådar & Spår'
                  : 'Clues & Trail'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {!isSolved && !isSurrendered ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '5px 10px',
                    borderRadius: '999px',
                    background: '#fff9e6',
                    border: '1.5px solid #fbbf24',
                    color: '#92400e',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    boxShadow: '0 1px 3px rgba(217,119,6,0.1)',
                  }}
                  title={isSv ? 'Aktuell vinst vid rätt svar' : 'Potential score'}
                >
                  <Sparkles size={13} style={{ color: '#d97706' }} />
                  <span>{currentPotentialScore} p</span>
                </div>
              ) : isSolved ? (
                <span className="badge badge-swedish" style={{ fontSize: '0.82rem', fontWeight: 800 }}>
                  +{score} p
                </span>
              ) : null}

              {isMobile ? (
                <button
                  onClick={() => setIsMobileSheetExpanded(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    minHeight: '36px',
                    background: 'var(--accent-blue)',
                    border: 'none',
                    color: '#ffffff',
                    padding: '6px 12px',
                    borderRadius: '10px',
                    fontSize: '0.86rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  <span>{isSv ? 'Visa karta' : 'Show map'}</span>
                  <ChevronDown size={16} />
                </button>
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

          {/* Desktop: Fast sökfält ovanför scrollen (på mobil ligger sökfältet redan dockat högst upp!) */}
          {!isMobile && !isSolved && !isSurrendered && (
            <div
              style={{
                padding: '10px 16px 8px',
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
                  placeholder={isSv ? 'Gissa vem personen är...' : 'Guess who it is...'}
                  style={{
                    width: '100%',
                    padding: '9px 36px 9px 36px',
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
                      right: '4px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      width: '32px',
                      height: '32px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* Autocomplete-dropdown på desktop */}
              {showSuggestions && suggestions.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: '16px',
                    right: '16px',
                    background: '#ffffff',
                    borderRadius: '12px',
                    border: '2px solid var(--accent-blue)',
                    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)',
                    zIndex: 9999,
                    maxHeight: '230px',
                    overflowY: 'auto',
                  }}
                >
                  {suggestions.map((p) => {
                    const pName = loc(p.name, lang, isSv ? 'Okänd' : 'Unknown');
                    const alreadyGuessed = wrongGuesses.some((wg) => wg.id === p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          if (!alreadyGuessed) handleSelectGuess(p);
                        }}
                        style={{
                          padding: '11px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid #f1f5f9',
                          cursor: alreadyGuessed ? 'not-allowed' : 'pointer',
                          background: alreadyGuessed ? '#f8fafc' : '#ffffff',
                          opacity: alreadyGuessed ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!alreadyGuessed) e.currentTarget.style.background = '#eff6ff';
                        }}
                        onMouseLeave={(e) => {
                          if (!alreadyGuessed) e.currentTarget.style.background = '#ffffff';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                          <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>{alreadyGuessed ? '👻' : '👤'}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>{pName}</div>
                          </div>
                        </div>
                        {alreadyGuessed ? (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, flexShrink: 0 }}>
                            {isSv ? 'Redan gissad' : 'Already guessed'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', fontWeight: 700, flexShrink: 0 }}>
                            {isSv ? 'Gissa (-100 p)' : 'Guess (-100 p)'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Spårjakten i fast header på desktop */}
              {guessFeedbacks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '7px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      {isSv ? `Dina gissningar (${guessFeedbacks.length}):` : `Your guesses (${guessFeedbacks.length}):`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowGhostPins((v) => !v)}
                      style={{
                        background: showGhostPins ? '#f1f5f9' : '#fff',
                        border: '1px solid #cbd5e1',
                        color: showGhostPins ? '#334155' : '#94a3b8',
                        borderRadius: '999px',
                        padding: '2px 8px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span>👻</span>
                      <span>
                        {showGhostPins
                          ? isSv
                            ? 'Kartnålar: På'
                            : 'Map pins: On'
                          : isSv
                          ? 'Kartnålar: Av'
                          : 'Map pins: Off'}
                      </span>
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '145px', overflowY: 'auto' }}>
                    {guessFeedbacks.map((fb) => (
                      <div
                        key={fb.guessed.id}
                        onClick={() => focusPersonOnMap(fb.guessed)}
                        title={isSv ? 'Klicka för att visa på kartan' : 'Click to pan to person on map'}
                        style={{
                          background: '#fff',
                          border: '1px solid #e2e8f0',
                          borderLeft: fb.positiveBadges.length > 0 ? '3.5px solid #16a34a' : '3.5px solid #ef4444',
                          borderRadius: '8px',
                          padding: '5px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                          cursor: 'pointer',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                            <span style={{ color: '#dc2626', fontWeight: 800, fontSize: '0.75rem' }}>✕</span>
                            <span style={{ fontWeight: 800, fontSize: '0.8rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {fb.name}
                            </span>
                            <span style={{ fontSize: '0.71rem', color: '#64748b', fontWeight: 600, flexShrink: 0 }}>
                              ({fb.lifespanText})
                            </span>
                          </div>
                          <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, flexShrink: 0 }}>
                            {fb.eraText}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {fb.positiveBadges.length > 0 ? (
                            fb.positiveBadges.map((badge, bIdx) => (
                              <span
                                key={bIdx}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  background: '#dcfce7',
                                  color: '#166534',
                                  border: '1px solid #86efac',
                                  padding: '1px 6px',
                                  borderRadius: '999px',
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                }}
                              >
                                <span>{badge.icon}</span>
                                <span>{badge.label}</span>
                              </span>
                            ))
                          ) : (
                            <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontStyle: 'italic' }}>
                              {isSv ? 'Ingen träff på kategori, yrke eller ort' : 'No match on category, occupation, or place'}
                            </span>
                          )}
                          {fb.birthDistanceKm !== null && !fb.sameBirthPlace && (
                            <span
                              style={{
                                marginLeft: 'auto',
                                fontSize: '0.67rem',
                                color: '#64748b',
                                fontWeight: 600,
                                flexShrink: 0,
                              }}
                            >
                              📍 {fb.birthDistanceKm} km {isSv ? 'bort' : 'away'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rullningsbar innehållsyta */}
          <div
            ref={sheetScrollRef}
            style={{
              padding: isMobile ? '14px 16px calc(28px + env(safe-area-inset-bottom, 0px))' : '14px 16px',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {/* På mobil i expanderat läge: Visa alla gissningar med stor, tydlig typografi */}
            {isMobile && !isSolved && !isSurrendered && guessFeedbacks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {isSv ? `Dina gissningar (${guessFeedbacks.length}):` : `Your guesses (${guessFeedbacks.length}):`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowGhostPins((v) => !v)}
                    style={{
                      background: showGhostPins ? '#f1f5f9' : '#fff',
                      border: '1px solid #cbd5e1',
                      color: showGhostPins ? '#334155' : '#94a3b8',
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>👻</span>
                    <span>
                      {showGhostPins
                        ? isSv
                          ? 'Kartnålar: På'
                          : 'Map pins: On'
                        : isSv
                        ? 'Kartnålar: Av'
                        : 'Map pins: Off'}
                    </span>
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {guessFeedbacks.map((fb) => (
                    <div
                      key={fb.guessed.id}
                      onClick={() => focusPersonOnMap(fb.guessed)}
                      style={{
                        background: '#fff',
                        border: '1px solid #cbd5e1',
                        borderLeft: fb.positiveBadges.length > 0 ? '4px solid #16a34a' : '4px solid #ef4444',
                        borderRadius: '10px',
                        padding: '9px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                          <span style={{ color: '#dc2626', fontWeight: 800, fontSize: '0.84rem' }}>✕</span>
                          <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {fb.name}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, flexShrink: 0 }}>
                            ({fb.lifespanText})
                          </span>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 800, flexShrink: 0 }}>
                          {fb.eraText}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                        {fb.positiveBadges.length > 0 ? (
                          fb.positiveBadges.map((badge, bIdx) => (
                            <span
                              key={bIdx}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: '#dcfce7',
                                color: '#166534',
                                border: '1px solid #86efac',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                              }}
                            >
                              <span>{badge.icon}</span>
                              <span>{badge.label}</span>
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic' }}>
                            {isSv ? 'Ingen träff på kategori, yrke eller ort' : 'No match on category, occupation, or place'}
                          </span>
                        )}
                        {fb.birthDistanceKm !== null && !fb.sameBirthPlace && (
                          <span
                            style={{
                              marginLeft: 'auto',
                              fontSize: '0.76rem',
                              color: '#475569',
                              fontWeight: 700,
                            }}
                          >
                            📍 {fb.birthDistanceKm} km {isSv ? 'bort' : 'away'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  <span style={{ fontWeight: 800, fontSize: '0.86rem' }}>
                    {isSv ? `Rond ${currentRoundIndex + 1} av 5` : `Round ${currentRoundIndex + 1} of 5`}
                  </span>
                </div>
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
                <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#fef08a' }}>
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
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  {currentPerson.image?.thumb && (
                    <img
                      src={currentPerson.image.thumb}
                      alt={name}
                      style={{
                        width: '58px',
                        height: '58px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: `2px solid ${isSolved ? '#4caf50' : '#ef5350'}`,
                      }}
                    />
                  )}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isSolved ? (
                        <CheckCircle2 size={20} style={{ color: '#2e7d32' }} />
                      ) : (
                        <XCircle size={20} style={{ color: '#c62828' }} />
                      )}
                      <strong style={{ fontSize: '1.15rem' }}>{name}</strong>
                    </div>
                    <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      {birthYear} – {deathYear || (isSv ? 'nu' : 'now')}
                    </div>
                  </div>
                </div>

                {desc && (
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.4, fontStyle: 'italic' }}>
                    "{desc}"
                  </p>
                )}

                {wikiSummary && (
                  <div
                    style={{
                      background: '#fff',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                      lineHeight: 1.5,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <p>{wikiSummary}</p>
                    {wikiUrl && (
                      <div style={{ marginTop: '6px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        {isSv ? 'Källa:' : 'Source:'}{' '}
                        <a href={wikiUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>
                          Wikipedia
                        </a>{' '}
                        (CC BY-SA 4.0)
                      </div>
                    )}
                  </div>
                )}

                {isSolved ? (
                  <div style={{ fontSize: '0.88rem', color: '#2e7d32', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.94rem' }}>
                      🎉 {isSv ? `Rätt svar! Du fick +${score} poäng!` : `Correct! +${score} points!`}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {(() => {
                        const base = getBasePoints(currentPerson.tier);
                        const cCost = deductionsAtEnd?.cluesCost ?? 0;
                        const wCost = deductionsAtEnd?.wrongCost ?? 0;
                        if (cCost === 0 && wCost === 0) {
                          return isSv
                            ? `Full pott! Inga ledtrådar använda (${base} p)`
                            : `Full score! No clues or wrong guesses used (${base} p)`;
                        }
                        const parts = [isSv ? `Bas: ${base} p` : `Base: ${base} p`];
                        if (cCost > 0) parts.push(isSv ? `Ledtrådar: -${cCost} p` : `Clues: -${cCost} p`);
                        if (wCost > 0) parts.push(isSv ? `Felgissningar: -${wCost} p` : `Wrong guesses: -${wCost} p`);
                        return parts.join(' · ');
                      })()}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#c62828' }}>
                    {isSv ? 'Du gav upp gåtan (0 poäng).' : 'You surrendered (0 points).'}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  {onInspectPerson && (
                    <button
                      onClick={() => onInspectPerson(currentPerson)}
                      style={{
                        flex: 1,
                        padding: '9px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-focus)',
                        background: '#fff',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        cursor: 'pointer',
                      }}
                    >
                      <Eye size={15} />
                      {isSv ? 'Inspektera' : 'Inspect'}
                    </button>
                  )}
                  {isMatchActive ? (
                    currentRoundIndex < 4 ? (
                      <button
                        onClick={handleNextMatchRound}
                        style={{
                          flex: 1.4,
                          padding: '9px',
                          borderRadius: '8px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                          color: '#fff',
                          fontSize: '0.85rem',
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '5px',
                          cursor: 'pointer',
                        }}
                      >
                        {isSv ? `Nästa rond (${currentRoundIndex + 2}/5)` : `Next round (${currentRoundIndex + 2}/5)`}
                        <ArrowRight size={15} />
                      </button>
                    ) : (
                      <button
                        onClick={() => setIsMatchSummaryOpen(true)}
                        style={{
                          flex: 1.4,
                          padding: '9px',
                          borderRadius: '8px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #b45309, #d97706)',
                          color: '#fff',
                          fontSize: '0.85rem',
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '5px',
                          cursor: 'pointer',
                        }}
                      >
                        <Trophy size={15} />
                        {isSv ? 'Se matchresultat 🏆' : 'Match summary 🏆'}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => handleNextPerson()}
                      style={{
                        flex: 1,
                        padding: '9px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'var(--accent-blue)',
                        color: '#fff',
                        fontSize: '0.85rem',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        cursor: 'pointer',
                      }}
                    >
                      {isSv ? 'Nästa gåta' : 'Next'}
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* C. Ledtrådar: Balanserad 6-stegsstege */}
            <div style={{ marginTop: '2px', position: 'relative', zIndex: 1 }}>
              <div
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Sparkles size={14} style={{ color: 'var(--accent-gold)' }} />
                  <span>
                    {isSv
                      ? `Ledtrådar (${purchasedClues.size}/${availableClues.length}):`
                      : `Clues (${purchasedClues.size}/${availableClues.length}):`}
                  </span>
                </div>
                {!isSolved && !isSurrendered && (
                  <span style={{ fontSize: '0.78rem', color: '#855700', fontWeight: 700, textTransform: 'none' }}>
                    {isSv ? 'Klicka på ett kort för att avslöja' : 'Tap card to reveal'}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* 1. Profil: Kategori, Kön & Land (-75 p) */}
                <ClueCard
                  title={isSv ? 'Profil: Kategori, Kön & Land' : 'Profile: Category, Gender & Country'}
                  subtitle={isSv ? 'Område, kön och nationalitet' : 'Domain, gender and nationality'}
                  cost={CLUE_COSTS.profile}
                  isPurchased={purchasedClues.has('profile') || freeClues.has('profile')}
                  freeLabel={
                    freeClues.has('profile')
                      ? isSv
                        ? 'Gratis – nu levande person'
                        : 'Free – person is alive'
                      : null
                  }
                  isExpanded={expandedClues.has('profile')}
                  isRoundEnded={isSolved || isSurrendered}
                  isSv={isSv}
                  borderColor="#0891b2"
                  shadowColor="rgba(8, 145, 178, 0.08)"
                  iconBg="#ecfeff"
                  icon={<UserCheck size={18} style={{ color: '#0891b2' }} />}
                  hintBadge={deducedProfileHint}
                  onToggle={() => toggleClue('profile')}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                    {(currentPerson.categories && currentPerson.categories.length > 0
                      ? currentPerson.categories
                      : (['other'] as const)
                    ).map((cat) => {
                      const info = QUIZ_CATEGORIES[cat] || QUIZ_CATEGORIES.other;
                      return (
                        <span
                          key={cat}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '5px 11px',
                            borderRadius: '999px',
                            background: '#ecfeff',
                            color: '#0e7490',
                            fontWeight: 800,
                            fontSize: '0.88rem',
                            border: '1.5px solid #a5f3fc',
                          }}
                        >
                          <span>{info.icon}</span>
                          <span>{info[lang] || info.sv}</span>
                        </span>
                      );
                    })}

                    {currentPerson.gender && (
                      <span
                        style={{
                          background: '#f5f3ff',
                          color: '#6d28d9',
                          border: '1px solid #ddd6fe',
                          padding: '5px 11px',
                          borderRadius: '999px',
                          fontSize: '0.88rem',
                          fontWeight: 800,
                        }}
                      >
                        {currentPerson.gender === 'female'
                          ? isSv
                            ? 'Kvinna ♀'
                            : 'Female ♀'
                          : currentPerson.gender === 'male'
                          ? isSv
                            ? 'Man ♂'
                            : 'Male ♂'
                          : isSv
                          ? 'Icke-binär / Annat'
                          : 'Non-binary / Other'}
                      </span>
                    )}

                    {citizenship.map((cit, i) => (
                      <span
                        key={i}
                        style={{
                          background: '#fef2f2',
                          color: '#991b1b',
                          border: '1px solid #fecaca',
                          padding: '5px 11px',
                          borderRadius: '999px',
                          fontSize: '0.88rem',
                          fontWeight: 700,
                        }}
                      >
                        🌍 {cit}
                      </span>
                    ))}
                  </div>
                </ClueCard>

                {/* 2. Yrke & Roll (-150 p, kombinerar yrken + kort Wikidata-beskrivning) */}
                {availableClues.includes('occupation') && (
                  <ClueCard
                    title={isSv ? 'Yrke & Roll' : 'Occupation & Role'}
                    subtitle={isSv ? 'Verksamhet och kort beskrivning' : 'Profession and short description'}
                    cost={CLUE_COSTS.occupation}
                    isPurchased={purchasedClues.has('occupation')}
                    isExpanded={expandedClues.has('occupation')}
                    isRoundEnded={isSolved || isSurrendered}
                    isSv={isSv}
                    borderColor="#16a34a"
                    shadowColor="rgba(22, 163, 74, 0.08)"
                    iconBg="#f0fdf4"
                    icon={<Briefcase size={18} style={{ color: '#16a34a' }} />}
                    hintBadge={deducedOccupationHint}
                    onToggle={() => toggleClue('occupation')}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {occupations.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {occupations.map((occ, i) => (
                            <span
                              key={i}
                              style={{
                                background: '#f0fdf4',
                                color: '#166534',
                                border: '1px solid #bbf7d0',
                                padding: '5px 11px',
                                borderRadius: '8px',
                                fontSize: '0.88rem',
                                fontWeight: 700,
                              }}
                            >
                              {occ}
                            </span>
                          ))}
                        </div>
                      )}
                      {desc && (
                        <div
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            padding: '9px 12px',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            color: '#334155',
                            fontStyle: 'italic',
                            lineHeight: 1.45,
                          }}
                        >
                          "{desc}"
                        </div>
                      )}
                    </div>
                  </ClueCard>
                )}

                {/* 4. Kända verk & Skapelser (-200 p) */}
                {availableClues.includes('works') && (
                  <ClueCard
                    title={isSv ? 'Kända verk & Skapelser' : 'Notable Works'}
                    subtitle={isSv ? 'Böcker, tavlor, uppfinningar m.m.' : 'Major works and creations'}
                    cost={CLUE_COSTS.works}
                    isPurchased={purchasedClues.has('works')}
                    isExpanded={expandedClues.has('works')}
                    isRoundEnded={isSolved || isSurrendered}
                    isSv={isSv}
                    borderColor="#d97706"
                    shadowColor="rgba(217, 119, 6, 0.08)"
                    iconBg="#fffbeb"
                    icon={<Award size={18} style={{ color: '#d97706' }} />}
                    onToggle={() => toggleClue('works')}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {works.map((w, i) => (
                        <span
                          key={i}
                          style={{
                            background: '#fffbeb',
                            color: '#92400e',
                            border: '1px solid #fde68a',
                            padding: '5px 11px',
                            borderRadius: '8px',
                            fontSize: '0.88rem',
                            fontWeight: 700,
                          }}
                        >
                          {w}
                        </span>
                      ))}
                    </div>
                  </ClueCard>
                )}

                {/* 5. Biografisk berättelse (Wikipedia) (-300 p) */}
                <ClueCard
                  title={isSv ? 'Biografisk berättelse (Wikipedia)' : 'Biographical summary (Wikipedia)'}
                  subtitle={isSv ? 'Ingress med personens historia' : 'Wikipedia intro narrative'}
                  cost={CLUE_COSTS.wikiSummary}
                  isPurchased={purchasedClues.has('wikiSummary')}
                  isExpanded={expandedClues.has('wikiSummary')}
                  isRoundEnded={isSolved || isSurrendered}
                  isSv={isSv}
                  borderColor="#3b82f6"
                  shadowColor="rgba(59, 130, 246, 0.08)"
                  iconBg="#eff6ff"
                  icon={<BookOpen size={18} style={{ color: '#2563eb' }} />}
                  onToggle={() => toggleClue('wikiSummary')}
                >
                  <div style={{ fontSize: '0.92rem', color: '#1e293b', lineHeight: 1.55 }}>
                    {wikiLoading ? (
                      <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                        {isSv ? 'Hämtar sammanfattning från Wikipedia...' : 'Loading summary from Wikipedia...'}
                      </div>
                    ) : sanitizedWikiSummary ? (
                      <>
                        <p style={{ margin: 0, fontStyle: 'italic' }}>"{sanitizedWikiSummary}"</p>
                        {wikiUrl && (
                          <div style={{ marginTop: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
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
                      <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                        {isSv ? 'Kunde inte hämta sammanfattning från Wikipedia för denna person.' : 'Could not fetch summary from Wikipedia.'}
                      </div>
                    )}
                  </div>
                </ClueCard>

                {/* 6. Porträtt (-350 p) */}
                {availableClues.includes('portrait') && currentPerson.image?.thumb && (
                  <ClueCard
                    title={isSv ? 'Porträttbild' : 'Portrait Image'}
                    subtitle={isSv ? 'Historiskt foto eller målning' : 'Historical photo or artwork'}
                    cost={CLUE_COSTS.portrait}
                    isPurchased={purchasedClues.has('portrait')}
                    isExpanded={expandedClues.has('portrait')}
                    isRoundEnded={isSolved || isSurrendered}
                    isSv={isSv}
                    borderColor="#c026d3"
                    shadowColor="rgba(192, 38, 211, 0.08)"
                    iconBg="#fdf4ff"
                    icon={<Eye size={18} style={{ color: '#c026d3' }} />}
                    onToggle={() => toggleClue('portrait')}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <img
                        src={currentPerson.image.thumb}
                        alt="Portrait"
                        style={{
                          width: '104px',
                          height: '104px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: '3px solid var(--accent-gold)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        }}
                      />
                    </div>
                  </ClueCard>
                )}

                {/* Mobil ge upp-knapp i botten av listan */}
                {!isSolved && !isSurrendered && isMobile && (
                  <button
                    onClick={() => {
                      if (confirm(isSv ? 'Ge upp gåtan och visa svaret?' : 'Give up and show answer?')) {
                        handleSurrender();
                      }
                    }}
                    style={{
                      marginTop: '8px',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid #fecaca',
                      background: '#fff5f5',
                      color: '#b91c1c',
                      fontSize: '0.88rem',
                      fontWeight: 800,
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
                onClick={handleSurrender}
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
              maxWidth: '500px',
              width: '100%',
              maxHeight: '92dvh',
              overflowY: 'auto',
              padding: '22px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
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
                    {isSv ? 'Gissa 5 personer och samla upp till 5 000–7 500 poäng' : 'Guess 5 figures and collect up to 5,000–7,500 points'}
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

            {/* Filter-sektion (Flerval i alla kategorier) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', background: '#fcfaf6', padding: '16px', borderRadius: '12px', border: '1px solid #f0e9dc' }}>
              {/* 1. Spelläge: Historiska / Nu levande (Flerval utan "Båda"-ruta) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    🏛️ {isSv ? 'Personkategori / Spelläge' : 'Figure Type / Game Mode'}
                  </label>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {isSv ? 'Välj en eller båda' : 'Select one or both'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {([
                    {
                      id: 'historical' as LifeStatusOption,
                      label: isSv ? 'Historiska' : 'Historical',
                      icon: '🏛️',
                      activeBorder: '#7c2d12',
                      activeBg: '#ffedd5',
                      activeColor: '#7c2d12',
                    },
                    {
                      id: 'living' as LifeStatusOption,
                      label: isSv ? 'Nu levande' : 'Living',
                      icon: '🌟',
                      activeBorder: '#be123c',
                      activeBg: '#ffe4e6',
                      activeColor: '#be123c',
                    },
                  ]).map((opt) => {
                    const active = matchLifeStatuses.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          const next = toggleLifeStatus(matchLifeStatuses, opt.id);
                          setMatchLifeStatuses(next);
                          const onlyLiving = next.length === 1 && next[0] === 'living';
                          if (onlyLiving && matchCenturies.length > 0 && !matchCenturies.some((c) => c === '1900' || c === '2000')) {
                            setMatchCenturies([]);
                          }
                        }}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: active ? `1.5px solid ${opt.activeBorder}` : '1px solid var(--border-color)',
                          background: active ? opt.activeBg : '#fff',
                          color: active ? opt.activeColor : 'var(--text-secondary)',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                        }}
                      >
                        <span>
                          {opt.icon} {opt.label}
                        </span>
                        <span
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '4px',
                            border: active ? `1.5px solid ${opt.activeBorder}` : '1px solid #cbd5e1',
                            background: active ? opt.activeBorder : '#fff',
                            color: '#fff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.66rem',
                            fontWeight: 900,
                          }}
                        >
                          {active ? '✓' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Epok / Århundrade (Flerval: födelseår ELLER dödsår) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    ⏳ {isSv ? 'Epok / Århundrade' : 'Epoch / Century'}
                  </label>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {isSv ? 'Födelse- eller dödsår (flerval)' : 'Birth or death year (multi-select)'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  <button
                    type="button"
                    onClick={() => setMatchCenturies([])}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '7px',
                      border: matchCenturies.length === 0 ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                      background: matchCenturies.length === 0 ? '#e0f2fe' : '#fff',
                      color: matchCenturies.length === 0 ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '0.73rem',
                      cursor: 'pointer',
                    }}
                  >
                    {isSv ? 'Alla epoker' : 'All eras'}
                  </button>
                  {CENTURY_OPTIONS.map((c) => {
                    const active = matchCenturies.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setMatchCenturies((prev) => toggleCentury(prev, c.value))}
                        style={{
                          padding: '5px 9px',
                          borderRadius: '7px',
                          border: active ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                          background: active ? '#e0f2fe' : '#fff',
                          color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                          fontWeight: 700,
                          fontSize: '0.73rem',
                          cursor: 'pointer',
                        }}
                        title={isSv ? c.label : c.labelEn}
                      >
                        {isSv ? c.shortLabel : c.shortLabelEn}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Svårighetsgrad (Flerval utan "Alla"-knapp; klick på Svår från Lätt väljer alla 3) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    🎯 {isSv ? 'Svårighetsgrad / Urval' : 'Difficulty / Tier'}
                  </label>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {isSv ? 'Flerval – klicka för att kombinera' : 'Multi-select'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                  {([
                    { id: 'standard' as Tier, label: isSv ? 'Standard' : 'Standard', icon: '⭐' },
                    { id: 'hard' as Tier, label: isSv ? 'Svår' : 'Hard', icon: '🔥' },
                    { id: 'very_hard' as Tier, label: isSv ? 'Mycket svår' : 'Very Hard', icon: '⚡' },
                  ]).map((t) => {
                    const active = matchTiers.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setMatchTiers((prev) => toggleTier(prev, t.id))}
                        style={{
                          padding: '8px 8px',
                          borderRadius: '8px',
                          border: active ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                          background: active ? '#e0f2fe' : '#fff',
                          color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                          fontWeight: 700,
                          fontSize: '0.76rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '4px',
                        }}
                      >
                        <span>
                          {t.icon} {t.label}
                        </span>
                        <span
                          style={{
                            width: '15px',
                            height: '15px',
                            borderRadius: '4px',
                            border: active ? '1.5px solid var(--accent-blue)' : '1px solid #cbd5e1',
                            background: active ? 'var(--accent-blue)' : '#fff',
                            color: '#fff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.64rem',
                            fontWeight: 900,
                          }}
                        >
                          {active ? '✓' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Länder & Geografisk koppling (Flerval + tydlig definition av vad land innebär) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                    🌍 {isSv ? 'Länder (Flerval)' : 'Countries (Multi-select)'}
                  </label>
                  {matchCountries.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMatchCountries([])}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-blue)',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {isSv ? `Rensa (${matchCountries.length})` : `Clear (${matchCountries.length})`}
                    </button>
                  )}
                </div>

                {/* Snabbval för länder */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  <button
                    type="button"
                    onClick={() => setMatchCountries([])}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '7px',
                      border: matchCountries.length === 0 ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                      background: matchCountries.length === 0 ? '#e0f2fe' : '#fff',
                      color: matchCountries.length === 0 ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontWeight: 700,
                      fontSize: '0.73rem',
                      cursor: 'pointer',
                    }}
                  >
                    🌍 {isSv ? 'Alla länder' : 'All countries'}
                  </button>

                  {(() => {
                    const quickSet = new Set<string>(QUICK_COUNTRY_IDS);
                    const displayed = availableMatchCountries.filter(
                      (c) => quickSet.has(c.id) || matchCountries.includes(c.id)
                    );
                    return displayed.map((c) => {
                      const active = matchCountries.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setMatchCountries((prev) => toggleCountry(prev, c.id))}
                          style={{
                            padding: '5px 9px',
                            borderRadius: '7px',
                            border: active ? '1.5px solid #137333' : '1px solid var(--border-color)',
                            background: active ? '#e6f4ea' : '#fff',
                            color: active ? '#137333' : 'var(--text-secondary)',
                            fontWeight: 700,
                            fontSize: '0.73rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span>{c.flag}</span>
                          <span>{c.label}</span>
                        </button>
                      );
                    });
                  })()}

                  <button
                    type="button"
                    onClick={() => setShowMoreCountries((v) => !v)}
                    style={{
                      padding: '5px 9px',
                      borderRadius: '7px',
                      border: '1px dashed var(--accent-blue)',
                      background: showMoreCountries ? '#eff6ff' : '#fff',
                      color: 'var(--accent-blue)',
                      fontWeight: 700,
                      fontSize: '0.73rem',
                      cursor: 'pointer',
                    }}
                  >
                    {showMoreCountries
                      ? isSv
                        ? '▲ Dölj landlista'
                        : '▲ Hide country list'
                      : isSv
                      ? `➕ Fler länder (${availableMatchCountries.length})...`
                      : `➕ More countries (${availableMatchCountries.length})...`}
                  </button>
                </div>

                {/* Expanderbar sökbar lista med alla länder i databasen */}
                {showMoreCountries && (
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '8px',
                      borderRadius: '8px',
                      background: '#fff',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <input
                      type="text"
                      value={countrySearch}
                      onChange={(e) => setCountrySearch(e.target.value)}
                      placeholder={isSv ? 'Sök bland alla länder/riken...' : 'Search all countries/empires...'}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.76rem',
                        outline: 'none',
                      }}
                    />
                    <div
                      style={{
                        maxHeight: '150px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4px',
                      }}
                    >
                      {availableMatchCountries
                        .filter((c) => !countrySearch.trim() || c.label.toLowerCase().includes(countrySearch.toLowerCase()))
                        .map((c) => {
                          const active = matchCountries.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setMatchCountries((prev) => toggleCountry(prev, c.id))}
                              style={{
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: active ? '1.5px solid #137333' : '1px solid #e2e8f0',
                                background: active ? '#e6f4ea' : '#f8fafc',
                                color: active ? '#137333' : 'var(--text-primary)',
                                fontWeight: active ? 700 : 600,
                                fontSize: '0.72rem',
                                cursor: 'pointer',
                              }}
                            >
                              {c.flag} {c.label} <span style={{ opacity: 0.65 }}>({c.count})</span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Tydlig förklaring och val av vad landkoppling betyder */}
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                    {isSv ? 'Vad innebär koppling till valt land?' : 'What does country connection mean?'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                    {([
                      { id: 'any' as CountryMatchMode, label: isSv ? 'Alla' : 'Any', icon: '🔗' },
                      { id: 'citizenship' as CountryMatchMode, label: isSv ? 'Medborgare' : 'Citizen', icon: '🪪' },
                      { id: 'birth' as CountryMatchMode, label: isSv ? 'Född i' : 'Born in', icon: '🐣' },
                      { id: 'death' as CountryMatchMode, label: isSv ? 'Död i' : 'Died in', icon: '🪦' },
                    ]).map((m) => {
                      const active = matchCountryMatchMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMatchCountryMatchMode(m.id)}
                          style={{
                            padding: '5px 4px',
                            borderRadius: '6px',
                            border: active ? '1.5px solid var(--accent-blue)' : '1px solid #cbd5e1',
                            background: active ? '#e0f2fe' : '#fff',
                            color: active ? 'var(--accent-blue)' : '#475569',
                            fontWeight: 700,
                            fontSize: '0.69rem',
                            cursor: 'pointer',
                          }}
                        >
                          {m.icon} {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: '0.69rem', color: '#64748b', lineHeight: 1.35 }}>
                    {matchCountryMatchMode === 'any' &&
                      (isSv
                        ? 'Träffar personer som var medborgare i landet, föddes där eller dog där (inkl. historiska riken).'
                        : 'Matches people who were citizens of, born in, or died in the country (incl. historical states).')}
                    {matchCountryMatchMode === 'citizenship' &&
                      (isSv
                        ? 'Träffar endast personer med registrerat medborgarskap/nationalitet i landet i Wikidata (så fungerade Sverige-valet tidigare).'
                        : 'Matches only people with recorded citizenship/nationality in the country in Wikidata.')}
                    {matchCountryMatchMode === 'birth' &&
                      (isSv
                        ? 'Träffar endast personer vars födelseort ligger i landet.'
                        : 'Matches only people whose birthplace is located in the country.')}
                    {matchCountryMatchMode === 'death' &&
                      (isSv
                        ? 'Träffar endast personer vars dödsort ligger i landet.'
                        : 'Matches only people whose place of death is located in the country.')}
                  </div>
                </div>
              </div>

              {/* Kandidaträknare */}
              <div style={{ fontSize: '0.74rem', color: matchCandidatesCount >= 5 ? 'var(--text-muted)' : '#c62828', fontWeight: 700 }}>
                {matchCandidatesCount >= 5
                  ? isSv
                    ? `✨ ${matchCandidatesCount} personer matchar dina val`
                    : `✨ ${matchCandidatesCount} people available`
                  : isSv
                  ? '⚠️ För få personer matchar (minst 5 krävs). Bredda dina val.'
                  : '⚠️ Less than 5 people match. Broaden filters.'}
              </div>
            </div>

            {/* Poänginfo */}
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              💡{' '}
              {isSv
                ? 'Varje gåta ger 1 000–1 500 baspoäng beroende på svårighetsgrad. Att öppna ledtrådar (-50 till -350p) eller gissa fel (-100p) ger avdrag.'
                : 'Each round awards 1,000–1,500 base points depending on difficulty. Clues and wrong guesses deduct points.'}
            </div>

            {/* Knappar */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
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
                onClick={() =>
                  startMatch(
                    matchCenturies,
                    matchTiers,
                    matchLifeStatuses,
                    matchCountries,
                    matchCountryMatchMode
                  )
                }
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
              const maxScore = matchRounds.reduce((sum, p) => sum + getBasePoints(p.tier), 0) || 5000;
              const pct = totalScore / maxScore;
              let title = isSv ? 'Karthistoriker' : 'Map Explorer';
              let badgeColor = '#b45309';
              let badgeBg = '#fef3c7';

              if (pct >= 0.9) {
                title = isSv ? '👑 Världsklass! En levande historisk atlas!' : '👑 World-Class! Living Historical Atlas!';
                badgeColor = '#92400e';
                badgeBg = '#fef08a';
              } else if (pct >= 0.7) {
                title = isSv ? '🧭 Mästerlig Kartspejare!' : '🧭 Master Cartographer!';
                badgeColor = '#15803d';
                badgeBg = '#dcfce7';
              } else if (pct >= 0.5) {
                title = isSv ? '📜 Skicklig Forskare!' : '📜 Skilled Researcher!';
                badgeColor = '#1d4ed8';
                badgeBg = '#dbeafe';
              } else if (pct >= 0.3) {
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
                const pName = loc(r.person.name, lang) || (isSv ? 'Okänd' : 'Unknown');
                const bYear = r.person.birthDate.year;
                const dYear = r.person.deathDate?.year;
                const bPlace = loc(r.person.birthPlace?.name, lang);
                const dPlace = loc(r.person.deathPlace?.name, lang);

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

      {/* 7. FILTER-MODAL (MOBIL & DESKTOP FRISPEL) */}
      {showMobileFilterModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: isMobile ? 'flex-end' : 'center',
            justifyContent: 'center',
            padding: isMobile ? 0 : '16px',
          }}
          onClick={() => setShowMobileFilterModal(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: isMobile ? '20px 20px 0 0' : '20px',
              width: '100%',
              maxWidth: '500px',
              padding: isMobile ? '20px 18px calc(20px + env(safe-area-inset-bottom, 0px))' : '22px',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              maxHeight: '88dvh',
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

            {/* 1. Livsstatus / Spelläge (Flerval utan Båda-ruta) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                  🏛️ {isSv ? 'Personkategori / Spelläge:' : 'Figure Type / Game Mode:'}
                </label>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {isSv ? 'Välj en eller båda' : 'Select one or both'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {([
                  {
                    id: 'historical' as LifeStatusOption,
                    label: isSv ? 'Historiska' : 'Historical',
                    icon: '🏛️',
                    activeBorder: '#7c2d12',
                    activeBg: '#ffedd5',
                    activeColor: '#7c2d12',
                  },
                  {
                    id: 'living' as LifeStatusOption,
                    label: isSv ? 'Nu levande' : 'Living',
                    icon: '🌟',
                    activeBorder: '#be123c',
                    activeBg: '#ffe4e6',
                    activeColor: '#be123c',
                  },
                ]).map((opt) => {
                  const active = lifeStatuses.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleLifeStatusToggle(opt.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: active ? `2px solid ${opt.activeBorder}` : '1px solid var(--border-color)',
                        background: active ? opt.activeBg : '#fff',
                        color: active ? opt.activeColor : 'var(--text-primary)',
                        fontWeight: 700,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        {opt.icon} {opt.label}
                      </span>
                      <span
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '4px',
                          border: active ? `1.5px solid ${opt.activeBorder}` : '1px solid #cbd5e1',
                          background: active ? opt.activeBorder : '#fff',
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.66rem',
                          fontWeight: 900,
                        }}
                      >
                        {active ? '✓' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Epok / Århundrade (Flerval: födelseår ELLER dödsår) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                  ⏳ {isSv ? 'Epok / Århundrade:' : 'Epoch / Century:'}
                </label>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {isSv ? 'Födelse- eller dödsår (flerval)' : 'Birth or death year (multi-select)'}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                <button
                  type="button"
                  onClick={() => handleCenturyToggle('all')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '7px',
                    border: selectedCenturies.length === 0 ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                    background: selectedCenturies.length === 0 ? '#e0f2fe' : '#fff',
                    color: selectedCenturies.length === 0 ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {isSv ? 'Alla epoker' : 'All eras'}
                </button>
                {CENTURY_OPTIONS.map((c) => {
                  const active = selectedCenturies.includes(c.value);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => handleCenturyToggle(c.value)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '7px',
                        border: active ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                        background: active ? '#e0f2fe' : '#fff',
                        color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      {isSv ? c.shortLabel : c.shortLabelEn}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Svårighetsgrad (Flerval utan Alla-knapp) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                  🎯 {isSv ? 'Svårighetsgrad:' : 'Difficulty tier:'}
                </label>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {isSv ? 'Flerval' : 'Multi-select'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {([
                  { id: 'standard' as Tier, label: isSv ? 'Standard' : 'Standard', icon: '⭐' },
                  { id: 'hard' as Tier, label: isSv ? 'Svår' : 'Hard', icon: '🔥' },
                  { id: 'very_hard' as Tier, label: isSv ? 'Mycket svår' : 'Very Hard', icon: '⚡' },
                ]).map((t) => {
                  const active = selectedTiers.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleTierToggle(t.id)}
                      style={{
                        padding: '8px 8px',
                        borderRadius: '8px',
                        border: active ? '2px solid var(--accent-blue)' : '1px solid var(--border-color)',
                        background: active ? 'var(--tag-bg)' : '#fff',
                        color: active ? 'var(--accent-blue)' : 'var(--text-primary)',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        {t.icon} {t.label}
                      </span>
                      <span
                        style={{
                          width: '15px',
                          height: '15px',
                          borderRadius: '4px',
                          border: active ? '1.5px solid var(--accent-blue)' : '1px solid #cbd5e1',
                          background: active ? 'var(--accent-blue)' : '#fff',
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.64rem',
                          fontWeight: 900,
                        }}
                      >
                        {active ? '✓' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Länder & Koppling */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                  🌍 {isSv ? 'Länder (Flerval):' : 'Countries (Multi-select):'}
                </label>
                {selectedCountries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCountryToggle('all')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-blue)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {isSv ? `Rensa (${selectedCountries.length})` : `Clear (${selectedCountries.length})`}
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                <button
                  type="button"
                  onClick={() => handleCountryToggle('all')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '7px',
                    border: selectedCountries.length === 0 ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-color)',
                    background: selectedCountries.length === 0 ? '#e0f2fe' : '#fff',
                    color: selectedCountries.length === 0 ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                  }}
                >
                  🌍 {isSv ? 'Alla länder' : 'All countries'}
                </button>

                {(() => {
                  const quickSet = new Set<string>(QUICK_COUNTRY_IDS);
                  const displayed = availableFreePlayCountries.filter(
                    (c) => quickSet.has(c.id) || selectedCountries.includes(c.id)
                  );
                  return displayed.map((c) => {
                    const active = selectedCountries.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleCountryToggle(c.id)}
                        style={{
                          padding: '6px 9px',
                          borderRadius: '7px',
                          border: active ? '1.5px solid #137333' : '1px solid var(--border-color)',
                          background: active ? '#e6f4ea' : '#fff',
                          color: active ? '#137333' : 'var(--text-secondary)',
                          fontWeight: 700,
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span>{c.flag}</span>
                        <span>{c.label}</span>
                      </button>
                    );
                  });
                })()}

                <button
                  type="button"
                  onClick={() => setShowMoreCountries((v) => !v)}
                  style={{
                    padding: '6px 9px',
                    borderRadius: '7px',
                    border: '1px dashed var(--accent-blue)',
                    background: showMoreCountries ? '#eff6ff' : '#fff',
                    color: 'var(--accent-blue)',
                    fontWeight: 700,
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                  }}
                >
                  {showMoreCountries
                    ? isSv
                      ? '▲ Dölj landlista'
                      : '▲ Hide country list'
                    : isSv
                    ? `➕ Fler länder (${availableFreePlayCountries.length})...`
                    : `➕ More countries (${availableFreePlayCountries.length})...`}
                </button>
              </div>

              {showMoreCountries && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <input
                    type="text"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    placeholder={isSv ? 'Sök bland alla länder/riken...' : 'Search all countries/empires...'}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.76rem',
                      background: '#fff',
                      outline: 'none',
                    }}
                  />
                  <div
                    style={{
                      maxHeight: '150px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px',
                    }}
                  >
                    {availableFreePlayCountries
                      .filter((c) => !countrySearch.trim() || c.label.toLowerCase().includes(countrySearch.toLowerCase()))
                      .map((c) => {
                        const active = selectedCountries.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleCountryToggle(c.id)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: active ? '1.5px solid #137333' : '1px solid #e2e8f0',
                              background: active ? '#e6f4ea' : '#fff',
                              color: active ? '#137333' : 'var(--text-primary)',
                              fontWeight: active ? 700 : 600,
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                            }}
                          >
                            {c.flag} {c.label} <span style={{ opacity: 0.65 }}>({c.count})</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Vad landkoppling innebär */}
              <div
                style={{
                  marginTop: '8px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ fontSize: '0.71rem', fontWeight: 700, color: '#475569' }}>
                  {isSv ? 'Vad innebär koppling till valt land?' : 'What does country connection mean?'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  {([
                    { id: 'any' as CountryMatchMode, label: isSv ? 'Alla' : 'Any', icon: '🔗' },
                    { id: 'citizenship' as CountryMatchMode, label: isSv ? 'Medborgare' : 'Citizen', icon: '🪪' },
                    { id: 'birth' as CountryMatchMode, label: isSv ? 'Född i' : 'Born in', icon: '🐣' },
                    { id: 'death' as CountryMatchMode, label: isSv ? 'Död i' : 'Died in', icon: '🪦' },
                  ]).map((m) => {
                    const active = countryMatchMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleCountryMatchModeChange(m.id)}
                        style={{
                          padding: '5px 4px',
                          borderRadius: '6px',
                          border: active ? '1.5px solid var(--accent-blue)' : '1px solid #cbd5e1',
                          background: active ? '#e0f2fe' : '#fff',
                          color: active ? 'var(--accent-blue)' : '#475569',
                          fontWeight: 700,
                          fontSize: '0.69rem',
                          cursor: 'pointer',
                        }}
                      >
                        {m.icon} {m.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: '0.69rem', color: '#64748b', lineHeight: 1.35 }}>
                  {countryMatchMode === 'any' &&
                    (isSv
                      ? 'Träffar personer som var medborgare i landet, föddes där eller dog där (inkl. historiska riken).'
                      : 'Matches people who were citizens of, born in, or died in the country (incl. historical states).')}
                  {countryMatchMode === 'citizenship' &&
                    (isSv
                      ? 'Träffar endast personer med registrerat medborgarskap/nationalitet i landet i Wikidata (så fungerade Sverige-valet tidigare).'
                      : 'Matches only people with recorded citizenship/nationality in the country in Wikidata.')}
                  {countryMatchMode === 'birth' &&
                    (isSv
                      ? 'Träffar endast personer vars födelseort ligger i landet.'
                      : 'Matches only people whose birthplace is located in the country.')}
                  {countryMatchMode === 'death' &&
                    (isSv
                      ? 'Träffar endast personer vars dödsort ligger i landet.'
                      : 'Matches only people whose place of death is located in the country.')}
                </div>
              </div>
            </div>

            {/* Hel resa toggle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  if (isMatchActive) return;
                  const nextVal = !requireBothCoords;
                  setRequireBothCoords(nextVal);
                  if (nextVal && (!currentPerson.birthPlace?.coord || (!currentPerson.deathPlace?.coord && currentPerson.deathDate))) {
                    const candidates = filterPeopleWith(
                      selectedTiers,
                      selectedCenturies,
                      lifeStatuses,
                      selectedCountries,
                      countryMatchMode,
                      nextVal
                    );
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
              {!isMatchActive && (
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
              )}

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

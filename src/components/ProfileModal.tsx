import React, { useState, useMemo, useRef } from 'react';
import { loc, type Person } from '../types/person.ts';
import {
  AVATAR_OPTIONS,
  getActiveProfile,
  exportProfileData,
  type ProfileState,
} from '../engine/profileStore.ts';
import {
  X,
  Trophy,
  Flame,
  Target,
  Award,
  Users,
  Download,
  Upload,
  Plus,
  Trash2,
  Check,
  Search,
  Sparkles,
  History,
  UserCheck,
  Settings,
} from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileState: ProfileState;
  allPeople: Person[];
  lang: 'sv' | 'en';
  onUpdateProfile: (updates: { name?: string; avatar?: string }) => void;
  onCreateProfile: (name: string, avatar: string) => void;
  onSwitchProfile: (profileId: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onImportProfile: (jsonStr: string) => boolean;
  onInspectPerson: (person: Person) => void;
}

type ModalTab = 'overview' | 'collection' | 'history' | 'settings';

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  profileState,
  allPeople,
  lang,
  onUpdateProfile,
  onCreateProfile,
  onSwitchProfile,
  onDeleteProfile,
  onImportProfile,
  onInspectPerson,
}) => {
  const isSv = lang === 'sv';
  const activeProfile = getActiveProfile(profileState);

  const [activeTab, setActiveTab] = useState<ModalTab>('overview');
  const [editName, setEditName] = useState(activeProfile.name);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileAvatar, setNewProfileAvatar] = useState<string>('👑');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync editName when switching profile
  React.useEffect(() => {
    setEditName(activeProfile.name);
  }, [activeProfile.id, activeProfile.name]);

  const peopleById = useMemo(() => {
    const map = new Map<string, Person>();
    for (const p of allPeople) {
      map.set(p.id, p);
    }
    return map;
  }, [allPeople]);

  const solvedPeople = useMemo(() => {
    return activeProfile.solvedPersonIds
      .map((id) => peopleById.get(id))
      .filter((p): p is Person => !!p);
  }, [activeProfile.solvedPersonIds, peopleById]);

  const filteredSolvedPeople = useMemo(() => {
    if (!collectionSearch.trim()) return solvedPeople;
    const q = collectionSearch.toLowerCase();
    return solvedPeople.filter((p) => {
      const name = loc(p.name, lang).toLowerCase();
      const desc = loc(p.description, lang).toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [solvedPeople, collectionSearch, lang]);

  const tierStats = useMemo(() => {
    const totals = { standard: 0, hard: 0, very_hard: 0, swedish: 0 };
    const solved = { standard: 0, hard: 0, very_hard: 0, swedish: 0 };
    const solvedSet = new Set(activeProfile.solvedPersonIds);

    for (const p of allPeople) {
      totals[p.tier]++;
      if (p.swedish) totals.swedish++;
      if (solvedSet.has(p.id)) {
        solved[p.tier]++;
        if (p.swedish) solved.swedish++;
      }
    }
    return { totals, solved };
  }, [allPeople, activeProfile.solvedPersonIds]);

  if (!isOpen) return null;

  const winRate =
    activeProfile.roundsPlayed > 0
      ? Math.round((activeProfile.roundsSolved / activeProfile.roundsPlayed) * 100)
      : 0;

  const avgScore =
    activeProfile.roundsPlayed > 0
      ? Math.round(activeProfile.totalRoundPoints / activeProfile.roundsPlayed)
      : 0;

  const bestMatchScore =
    activeProfile.matchHistory.length > 0
      ? Math.max(...activeProfile.matchHistory.map((m) => m.totalScore))
      : 0;

  const getRankTitle = (solvedCount: number) => {
    if (solvedCount >= 500) return isSv ? '🏛️ Stormästare i Historia' : '🏛️ Grandmaster of History';
    if (solvedCount >= 200) return isSv ? '👑 Kunglig Krönikör' : '👑 Royal Chronicler';
    if (solvedCount >= 100) return isSv ? '🔭 Världshistoriker' : '🔭 World Historian';
    if (solvedCount >= 50) return isSv ? '📜 Lärd Arkivarie' : '📜 Learned Archivist';
    if (solvedCount >= 15) return isSv ? '🧭 Tidsresenär' : '🧭 Time Traveler';
    if (solvedCount >= 5) return isSv ? '🔎 Historisk Detektiv' : '🔎 Historical Detective';
    return isSv ? '🌱 Nyfiken Upptäckare' : '🌱 Curious Explorer';
  };

  const handleExport = () => {
    const dataStr = exportProfileData(activeProfile);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = activeProfile.name.replace(/[^a-z0-9åäö_-]/gi, '_').toLowerCase();
    a.download = `livslinjen_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      const ok = onImportProfile(content);
      if (ok) {
        setImportStatus({
          type: 'success',
          msg: isSv ? 'Profilen lästes in!' : 'Profile imported successfully!',
        });
      } else {
        setImportStatus({
          type: 'error',
          msg: isSv ? 'Ogiltig profilfil.' : 'Invalid profile file.',
        });
      }
      setTimeout(() => setImportStatus(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 2500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '18px',
          maxWidth: '760px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 48px rgba(0,0,0,0.28)',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
        }}
      >
        {/* Topp-banner med aktiv spelare */}
        <div
          style={{
            padding: '1.15rem 1.4rem',
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '14px',
                background: 'rgba(255,255,255,0.12)',
                border: '2px solid rgba(245, 158, 11, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.75rem',
                flexShrink: 0,
              }}
            >
              {activeProfile.avatar}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2 className="serif-font" style={{ fontSize: '1.3rem', fontWeight: 900, margin: 0 }}>
                  {activeProfile.name}
                </h2>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                  }}
                >
                  {getRankTitle(solvedPeople.length)}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '3px' }}>
                {isSv
                  ? `${solvedPeople.length} upptäckta personer · ${activeProfile.totalRoundPoints.toLocaleString()} totalpoäng`
                  : `${solvedPeople.length} discovered figures · ${activeProfile.totalRoundPoints.toLocaleString()} total pts`}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            title={isSv ? 'Stäng' : 'Close'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Flikar */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-color)',
            background: '#f8fafc',
            overflowX: 'auto',
          }}
        >
          {[
            { id: 'overview' as ModalTab, icon: <Trophy size={15} />, label: isSv ? 'Statistik' : 'Statistics' },
            {
              id: 'collection' as ModalTab,
              icon: <UserCheck size={15} />,
              label: isSv ? `Samling (${solvedPeople.length})` : `Collection (${solvedPeople.length})`,
            },
            {
              id: 'history' as ModalTab,
              icon: <History size={15} />,
              label: isSv ? 'Matcher & Ronder' : 'Matches & Rounds',
            },
            { id: 'settings' as ModalTab, icon: <Settings size={15} />, label: isSv ? 'Profil & Backup' : 'Profile & Backup' },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  minWidth: '125px',
                  padding: '11px 14px',
                  border: 'none',
                  borderBottom: active ? '3px solid var(--accent-blue)' : '3px solid transparent',
                  background: active ? '#fff' : 'transparent',
                  color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  fontWeight: active ? 800 : 600,
                  fontSize: '0.84rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Innehållsyta */}
        <div style={{ padding: '1.25rem 1.4rem', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* 4 Nyckelkort */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '10px',
                }}
              >
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.76rem', fontWeight: 700 }}>
                    <Target size={14} color="#2563eb" />
                    {isSv ? 'LÖSTA GÅTOR' : 'SOLVED RIDDLES'}
                  </div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                    {activeProfile.roundsSolved}{' '}
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>
                      / {activeProfile.roundsPlayed} ({winRate}%)
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.76rem', fontWeight: 700 }}>
                    <Flame size={14} color="#ea580c" />
                    {isSv ? 'SVIT (STREAK)' : 'WIN STREAK'}
                  </div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                    {activeProfile.currentStreak}{' '}
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b' }}>
                      ({isSv ? 'bäst' : 'best'}: {activeProfile.bestStreak})
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '0.76rem', fontWeight: 700 }}>
                    <Sparkles size={14} color="#d97706" />
                    {isSv ? 'SNITTPOÄNG / ROND' : 'AVG SCORE / ROUND'}
                  </div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                    {avgScore}{' '}
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b' }}>p</span>
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: '12px',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#b45309', fontSize: '0.76rem', fontWeight: 700 }}>
                    <Trophy size={14} color="#d97706" />
                    {isSv ? 'BÄSTA 5-RONDSMATCH' : 'BEST 5-ROUND MATCH'}
                  </div>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: '#92400e', marginTop: '4px' }}>
                    {bestMatchScore}{' '}
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#b45309' }}>p</span>
                  </div>
                </div>
              </div>

              {/* Upptäckta historiska personer (Pokédex-framsteg) */}
              <div
                style={{
                  padding: '1.1rem',
                  borderRadius: '14px',
                  border: '1px solid var(--border-color)',
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                      {isSv ? '📖 Historisk Uppslagsbok (Upptäckta personer)' : '📖 Historical Compendium (Discovered Figures)'}
                    </h3>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                      {isSv
                        ? 'Nya gåtor prioriterar automatiskt personer du ännu inte har löst.'
                        : 'New riddles automatically prioritize people you have not solved yet.'}
                    </p>
                  </div>
                  <span style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--accent-blue)' }}>
                    {solvedPeople.length} / {allPeople.length}
                  </span>
                </div>

                {/* Progress bar total */}
                <div
                  style={{
                    height: '10px',
                    borderRadius: '999px',
                    background: '#f1f5f9',
                    overflow: 'hidden',
                    marginBottom: '14px',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (solvedPeople.length / Math.max(1, allPeople.length)) * 100)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #2563eb, #f59e0b)',
                      borderRadius: '999px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                {/* Breakdown by tier */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                  {[
                    {
                      label: isSv ? '⭐ Standard' : '⭐ Standard',
                      solved: tierStats.solved.standard,
                      total: tierStats.totals.standard,
                      color: '#16a34a',
                      bg: '#f0fdf4',
                    },
                    {
                      label: isSv ? '🔥 Svår' : '🔥 Hard',
                      solved: tierStats.solved.hard,
                      total: tierStats.totals.hard,
                      color: '#2563eb',
                      bg: '#eff6ff',
                    },
                    {
                      label: isSv ? '⚡ Mycket svår' : '⚡ Very Hard',
                      solved: tierStats.solved.very_hard,
                      total: tierStats.totals.very_hard,
                      color: '#dc2626',
                      bg: '#fef2f2',
                    },
                    {
                      label: isSv ? '🇸🇪 Svenska personer' : '🇸🇪 Swedish figures',
                      solved: tierStats.solved.swedish,
                      total: tierStats.totals.swedish,
                      color: '#0284c7',
                      bg: '#f0f9ff',
                    },
                  ].map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '9px 11px',
                        borderRadius: '10px',
                        background: item.bg,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>{item.label}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 900, color: item.color }}>{item.solved}</span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>/ {item.total}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'collection' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {solvedPeople.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-secondary)' }}>
                  <Award size={42} style={{ color: '#94a3b8', marginBottom: '0.5rem' }} />
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 4px' }}>
                    {isSv ? 'Inga upptäckta personer ännu' : 'No discovered people yet'}
                  </h3>
                  <p style={{ fontSize: '0.84rem', margin: 0 }}>
                    {isSv
                      ? 'När du gissar rätt på en historisk person i GeoGuesser läggs kortet till i din samling här!'
                      : 'When you solve a historical figure in GeoGuesser, their card is added to your collection here!'}
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ position: 'relative' }}>
                    <Search
                      size={16}
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                      }}
                    />
                    <input
                      type="text"
                      value={collectionSearch}
                      onChange={(e) => setCollectionSearch(e.target.value)}
                      placeholder={
                        isSv
                          ? `Sök bland dina ${solvedPeople.length} lösta personer...`
                          : `Search among your ${solvedPeople.length} solved figures...`
                      }
                      style={{
                        width: '100%',
                        padding: '8px 12px 8px 36px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: '10px',
                    }}
                  >
                    {filteredSolvedPeople.map((p) => {
                      const pName = loc(p.name, lang);
                      const by = p.birthDate.year;
                      const dy = p.deathDate?.year;
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            onInspectPerson(p);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 10px',
                            borderRadius: '10px',
                            border: '1px solid var(--border-color)',
                            background: '#fff',
                            textAlign: 'left',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                          }}
                        >
                          {p.image?.thumb ? (
                            <img
                              src={p.image.thumb}
                              alt={pName}
                              style={{
                                width: '42px',
                                height: '42px',
                                borderRadius: '8px',
                                objectFit: 'cover',
                                objectPosition: 'center 20%',
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '42px',
                                height: '42px',
                                borderRadius: '8px',
                                background: '#e2e8f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '1.1rem',
                                flexShrink: 0,
                              }}
                            >
                              👤
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: '0.84rem',
                                fontWeight: 800,
                                color: 'var(--text-primary)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {pName}
                            </div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                              {by < 0 ? `${Math.abs(by)} f.Kr.` : by}–
                              {dy ? (dy < 0 ? `${Math.abs(dy)} f.Kr.` : dy) : isSv ? 'nu' : 'now'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* 5-rondersmatcher */}
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                  🏆 {isSv ? 'Spelade 5-rondersmatcher' : 'Completed 5-Round Matches'} ({activeProfile.matchHistory.length})
                </h3>
                {activeProfile.matchHistory.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {isSv
                      ? 'Du har inte slutfört någon 5-rondersmatch ännu. Starta en match med "🏆 5 Ronder"-knappen i GeoGuesser!'
                      : 'You have not completed a 5-round match yet. Start one using the "🏆 5 Rounds" button in GeoGuesser!'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {activeProfile.matchHistory.slice(0, 15).map((m) => (
                      <div
                        key={m.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '10px',
                          border: '1px solid #e2e8f0',
                          background: '#f8fafc',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 900, fontSize: '0.95rem', color: '#b45309' }}>
                              🏆 {m.totalScore} p
                            </span>
                            <span
                              style={{
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: '6px',
                                background: '#dcfce7',
                                color: '#166534',
                              }}
                            >
                              {m.solvedCount}/5 {isSv ? 'rätt' : 'solved'}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.73rem', color: '#64748b' }}>
                            {new Date(m.date).toLocaleDateString(isSv ? 'sv-SE' : 'en-US')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                          {m.rounds.map((r, i) => (
                            <span
                              key={i}
                              onClick={() => {
                                const found = peopleById.get(r.personId);
                                if (found) onInspectPerson(found);
                              }}
                              style={{
                                fontSize: '0.74rem',
                                padding: '2px 7px',
                                borderRadius: '5px',
                                background: r.isSolved ? '#fff' : '#fef2f2',
                                border: r.isSolved ? '1px solid #cbd5e1' : '1px solid #fecaca',
                                color: r.isSolved ? '#1e293b' : '#991b1b',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              {r.isSolved ? '✓' : '✗'} {r.personName} ({r.score}p)
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Senaste ronder */}
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                  🧭 {isSv ? 'Senaste ronder' : 'Recent Rounds'} ({activeProfile.roundHistory.length})
                </h3>
                {activeProfile.roundHistory.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {isSv ? 'Inga ronder registrerade ännu.' : 'No rounds recorded yet.'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {activeProfile.roundHistory.slice(0, 25).map((r) => (
                      <div
                        key={r.id}
                        onClick={() => {
                          const found = peopleById.get(r.personId);
                          if (found) onInspectPerson(found);
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0',
                          background: '#fff',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span
                            style={{
                              fontWeight: 800,
                              color: r.isSolved ? '#16a34a' : '#dc2626',
                            }}
                          >
                            {r.isSolved ? '✓' : '✗'}
                          </span>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{r.personName}</span>
                          <span style={{ fontSize: '0.73rem', color: '#64748b' }}>
                            ({r.cluesUsedCount} {isSv ? 'ledtr.' : 'clues'}, {r.wrongGuessesCount} {isSv ? 'fel' : 'wrong'})
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                          <span style={{ fontWeight: 800, color: r.isSolved ? '#0f172a' : '#94a3b8' }}>
                            {r.score} p
                          </span>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            {new Date(r.date).toLocaleDateString(isSv ? 'sv-SE' : 'en-US')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.35rem' }}>
              {/* Redigera nuvarande profil */}
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  background: '#f8fafc',
                }}
              >
                <h3 style={{ fontSize: '0.92rem', fontWeight: 800, margin: '0 0 10px' }}>
                  {isSv ? 'Redigera aktiv profil' : 'Edit Active Profile'}
                </h3>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {AVATAR_OPTIONS.map((av) => (
                    <button
                      key={av}
                      onClick={() => onUpdateProfile({ avatar: av })}
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '10px',
                        border: activeProfile.avatar === av ? '2px solid var(--accent-blue)' : '1px solid #cbd5e1',
                        background: activeProfile.avatar === av ? '#eff6ff' : '#fff',
                        fontSize: '1.2rem',
                        cursor: 'pointer',
                      }}
                    >
                      {av}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={isSv ? 'Spelarnamn...' : 'Player name...'}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <button
                    onClick={() => onUpdateProfile({ name: editName })}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'var(--accent-blue)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.84rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      cursor: 'pointer',
                    }}
                  >
                    <Check size={15} />
                    {isSv ? 'Spara namn' : 'Save Name'}
                  </button>
                </div>
              </div>

              {/* Växla eller skapa lokal profil */}
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  background: '#fff',
                }}
              >
                <h3 style={{ fontSize: '0.92rem', fontWeight: 800, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Users size={16} />
                  {isSv ? 'Lokala spelarprofiler på denna enhet' : 'Local Player Profiles on This Device'}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                  {profileState.profiles.map((p) => {
                    const isCurrent = p.id === profileState.activeProfileId;
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: isCurrent ? '2px solid var(--accent-blue)' : '1px solid #e2e8f0',
                          background: isCurrent ? '#eff6ff' : '#f8fafc',
                        }}
                      >
                        <div
                          onClick={() => onSwitchProfile(p.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1 }}
                        >
                          <span style={{ fontSize: '1.25rem' }}>{p.avatar}</span>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '0.86rem' }}>
                              {p.name}{' '}
                              {isCurrent && (
                                <span style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', fontWeight: 700 }}>
                                  ({isSv ? 'Aktiv' : 'Active'})
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
                              {p.solvedPersonIds.length} {isSv ? 'lösta personer' : 'solved'} · {p.totalRoundPoints} p
                            </div>
                          </div>
                        </div>
                        {profileState.profiles.length > 1 && (
                          <button
                            onClick={() => onDeleteProfile(p.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '4px',
                            }}
                            title={isSv ? 'Ta bort profil' : 'Delete profile'}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Skapa ny profil */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <select
                    value={newProfileAvatar}
                    onChange={(e) => setNewProfileAvatar(e.target.value)}
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      fontSize: '1rem',
                    }}
                  >
                    {AVATAR_OPTIONS.map((av) => (
                      <option key={av} value={av}>
                        {av}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder={isSv ? 'Nytt profilnamn (t.ex. familjemedlem)...' : 'New profile name...'}
                    style={{
                      flex: 1,
                      minWidth: '160px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <button
                    onClick={() => {
                      if (!newProfileName.trim()) return;
                      onCreateProfile(newProfileName.trim(), newProfileAvatar);
                      setNewProfileName('');
                    }}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: '#0f172a',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={15} />
                    {isSv ? 'Ny profil' : 'Add Profile'}
                  </button>
                </div>
              </div>

              {/* Exportera / Importera JSON-backup */}
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  background: '#f8fafc',
                }}
              >
                <h3 style={{ fontSize: '0.92rem', fontWeight: 800, margin: '0 0 4px' }}>
                  {isSv ? 'Säkerhetskopia & Flytta mellan enheter' : 'Backup & Transfer Between Devices'}
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                  {isSv
                    ? 'Ladda ner din profil som en JSON-fil för att spara dina poäng eller flytta dem mellan mobil och dator.'
                    : 'Download your profile as a JSON file to back up your scores or move them between mobile and desktop.'}
                </p>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleExport}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: '#fff',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <Download size={15} />
                    {isSv ? 'Exportera profil (.json)' : 'Export profile (.json)'}
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileImport}
                    style={{ display: 'none' }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: '#fff',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <Upload size={15} />
                    {isSv ? 'Importera profil (.json)' : 'Import profile (.json)'}
                  </button>
                </div>

                {importStatus && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      background: importStatus.type === 'success' ? '#dcfce7' : '#fef2f2',
                      color: importStatus.type === 'success' ? '#166534' : '#991b1b',
                    }}
                  >
                    {importStatus.msg}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

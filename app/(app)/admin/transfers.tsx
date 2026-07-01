import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, Modal, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { colors, fonts, spacing, radius } from '../../../src/lib/theme';
import { teamLogos, getPlayerAvatar } from '../../../src/lib/assets';

interface Team { id: string; name: string; accent_color: string; logo_url: string | null; logo_key: string | null; }
interface Player {
  id: string; display_name: string; handicap_index: number;
  avatar_url: string | null; team_id: string | null; comp_player_id: string | null;
}

function getTeamLogo(team: Team) {
  if (team.logo_url) return { uri: team.logo_url };
  const key = Object.keys(teamLogos).find(k => team.name.includes(k) || k.includes(team.name));
  return key ? teamLogos[key] : null;
}

export default function TransferWindowScreen() {
  const router = useRouter();
  const { societyId } = useAdminSociety();

  const [teams, setTeams]           = useState<Team[]>([]);
  const [players, setPlayers]       = useState<Player[]>([]);
  const [freeAgents, setFreeAgents] = useState<Player[]>([]);
  const [compId, setCompId]         = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isDraft, setIsDraft]               = useState(false);
  const [targetTeam, setTargetTeam]         = useState<Team | 'dropout' | null>(null);
  const [phase, setPhase]                   = useState<'pick' | 'confirm' | 'done'>('pick');
  const [saving, setSaving]                 = useState(false);

  const oldLogoX    = useRef(new Animated.Value(0)).current;
  const oldLogoOp   = useRef(new Animated.Value(1)).current;
  const newLogoX    = useRef(new Animated.Value(160)).current;
  const newLogoOp   = useRef(new Animated.Value(0)).current;
  const playerScale = useRef(new Animated.Value(1)).current;
  const doneOp      = useRef(new Animated.Value(0)).current;

  useEffect(() => { if (societyId) load(); }, [societyId]);

  async function load() {
    setLoading(true);
    const { data: comp } = await supabase
      .from('competitions').select('id')
      .eq('society_id', societyId).neq('format', 'casual')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!comp) { setLoading(false); return; }
    setCompId(comp.id);

    const [{ data: teamsData }, { data: cpData }, { data: membersData }] = await Promise.all([
      supabase.from('teams').select('id,name,accent_color,logo_url,logo_key').eq('society_id', societyId).order('sort_order'),
      supabase.from('competition_players').select('id,player_id,team_id,handicap_index').eq('competition_id', comp.id),
      supabase.from('society_members').select('player_id').eq('society_id', societyId),
    ]);

    if (!teamsData) { setLoading(false); return; }
    setTeams(teamsData as Team[]);

    const cpRows = (cpData ?? []) as any[];
    const memberIds = (membersData ?? []).map((m: any) => m.player_id) as string[];
    const cpPlayerIds = cpRows.map(cp => cp.player_id) as string[];
    const freeAgentIds = memberIds.filter(id => !cpPlayerIds.includes(id));

    // Load competition players
    if (cpPlayerIds.length > 0) {
      const { data: playersData } = await supabase.from('players')
        .select('id,display_name,handicap_index,avatar_url').in('id', cpPlayerIds);
      if (playersData) {
        setPlayers(cpRows.map(cp => {
          const p = (playersData as any[]).find(pl => pl.id === cp.player_id);
          return {
            id: cp.player_id,
            display_name: p?.display_name ?? 'Unknown',
            handicap_index: cp.handicap_index ?? p?.handicap_index ?? 0,
            avatar_url: p?.avatar_url ?? null,
            team_id: cp.team_id,
            comp_player_id: cp.id,
          };
        }));
      }
    }

    // Load free agents (society members not in this competition)
    if (freeAgentIds.length > 0) {
      const { data: faData } = await supabase.from('players')
        .select('id,display_name,handicap_index,avatar_url').in('id', freeAgentIds);
      if (faData) {
        setFreeAgents((faData as any[]).map(p => ({
          id: p.id,
          display_name: p.display_name,
          handicap_index: p.handicap_index ?? 0,
          avatar_url: p.avatar_url ?? null,
          team_id: null,
          comp_player_id: null,
        })));
      }
    } else {
      setFreeAgents([]);
    }

    setLoading(false);
  }

  function resetAnimations() {
    oldLogoX.setValue(0); oldLogoOp.setValue(1);
    newLogoX.setValue(160); newLogoOp.setValue(0);
    playerScale.setValue(1); doneOp.setValue(0);
  }

  function openTransfer(player: Player) {
    setSelectedPlayer(player); setIsDraft(false);
    setTargetTeam(null); setPhase('pick'); setSaving(false);
    resetAnimations();
  }

  function openDraft(player: Player) {
    setSelectedPlayer(player); setIsDraft(true);
    setTargetTeam(null); setPhase('pick'); setSaving(false);
    resetAnimations();
  }

  function selectTarget(t: Team | 'dropout') {
    setTargetTeam(t);
    setPhase('confirm');
  }

  async function confirmAction() {
    if (!selectedPlayer || saving || !compId) return;
    setSaving(true);

    const targetTeamObj = targetTeam !== 'dropout' ? targetTeam as Team : null;

    Animated.parallel([
      ...(!isDraft ? [
        Animated.parallel([
          Animated.timing(oldLogoX,  { toValue: -160, duration: 450, useNativeDriver: true }),
          Animated.timing(oldLogoOp, { toValue: 0,    duration: 350, useNativeDriver: true }),
        ]),
      ] : []),
      Animated.sequence([
        Animated.delay(isDraft ? 0 : 120),
        Animated.parallel([
          Animated.timing(newLogoX,  { toValue: 0, duration: 450, useNativeDriver: true }),
          Animated.timing(newLogoOp, { toValue: 1, duration: 450, useNativeDriver: true }),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(250),
        Animated.spring(playerScale, { toValue: 1.18, useNativeDriver: true, tension: 120, friction: 4 }),
        Animated.spring(playerScale, { toValue: 1,    useNativeDriver: true }),
      ]),
    ]).start();

    if (isDraft) {
      // Insert new competition_players row
      const { data: newCp } = await supabase.from('competition_players').insert({
        competition_id: compId,
        player_id: selectedPlayer.id,
        team_id: targetTeamObj?.id ?? null,
        handicap_index: selectedPlayer.handicap_index,
      }).select().single();

      const updatedPlayer: Player = { ...selectedPlayer, team_id: targetTeamObj?.id ?? null, comp_player_id: (newCp as any)?.id ?? null };
      setPlayers(prev => [...prev, updatedPlayer]);
      setFreeAgents(prev => prev.filter(p => p.id !== selectedPlayer.id));
    } else if (targetTeam === 'dropout') {
      await supabase.from('competition_players').delete().eq('id', selectedPlayer.comp_player_id);
      setPlayers(prev => prev.filter(p => p.id !== selectedPlayer.id));
      setFreeAgents(prev => [...prev, { ...selectedPlayer, team_id: null, comp_player_id: null }]);
    } else {
      await supabase.from('competition_players')
        .update({ team_id: targetTeamObj?.id ?? null }).eq('id', selectedPlayer.comp_player_id);
      setPlayers(prev => prev.map(p =>
        p.id === selectedPlayer.id ? { ...p, team_id: targetTeamObj?.id ?? null } : p,
      ));
    }

    setTimeout(() => {
      setPhase('done');
      Animated.timing(doneOp, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      setSaving(false);
    }, 900);
  }

  const currentTeam = selectedPlayer ? teams.find(t => t.id === selectedPlayer.team_id) ?? null : null;
  const targetTeamObj = targetTeam !== null && targetTeam !== 'dropout' ? targetTeam as Team : null;
  const playersByTeam = teams.map(t => ({ team: t, members: players.filter(p => p.team_id === t.id) }));
  const unassigned = players.filter(p => !p.team_id);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>TRANSFER WINDOW</Text>
          <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>OPEN</Text></View>
        </View>
        <Text style={styles.headerSub}>Tap a player to move, release, or draft them</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>

          {/* ── Free Agents — draft section ── */}
          {freeAgents.length > 0 && (
            <View style={[styles.teamSection, styles.draftSection]}>
              <View style={[styles.teamHeader, styles.draftHeader]}>
                <Text style={styles.draftIcon}>⚡</Text>
                <Text style={[styles.teamName, { color: colors.gold }]}>FREE AGENTS</Text>
                <Text style={styles.teamCount}>{freeAgents.length} available</Text>
              </View>
              {freeAgents.map(player => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  teamColor={colors.gold}
                  actionLabel="DRAFT"
                  onPress={() => openDraft(player)}
                />
              ))}
            </View>
          )}

          {/* ── Teams ── */}
          {playersByTeam.map(({ team, members }) => (
            <View key={team.id} style={styles.teamSection}>
              <TeamHeader team={team} count={members.length} />
              {members.map(player => (
                <PlayerRow key={player.id} player={player} teamColor={team.accent_color} onPress={() => openTransfer(player)} />
              ))}
              {members.length === 0 && <Text style={styles.emptyTeam}>No players assigned</Text>}
            </View>
          ))}

          {unassigned.length > 0 && (
            <View style={styles.teamSection}>
              <View style={styles.teamHeader}>
                <Text style={[styles.teamName, { color: colors.textMuted }]}>UNASSIGNED</Text>
                <Text style={styles.teamCount}>{unassigned.length}</Text>
              </View>
              {unassigned.map(player => (
                <PlayerRow key={player.id} player={player} teamColor={colors.textMuted} onPress={() => openTransfer(player)} />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* Transfer / Draft Modal */}
      <Modal visible={!!selectedPlayer} transparent animationType="slide" onRequestClose={() => setSelectedPlayer(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>

            {phase === 'pick' && selectedPlayer && (
              <>
                <Text style={styles.modalHeading}>{isDraft ? 'DRAFT PLAYER' : 'MOVE PLAYER'}</Text>
                <Text style={styles.modalSub}>
                  {selectedPlayer.display_name.split(' ')[0]}
                  {isDraft ? ' is a free agent — pick their team' : (
                    <> is currently in <Text style={{ color: colors.gold }}>{currentTeam?.name ?? 'No Team'}</Text></>
                  )}
                </Text>

                <View style={styles.playerPreviewRow}>
                  <PlayerAvatar player={selectedPlayer} size={72} />
                  <Text style={styles.playerPreviewName}>{selectedPlayer.display_name}</Text>
                  <Text style={styles.playerPreviewHcp}>Hcp {selectedPlayer.handicap_index}</Text>
                </View>

                <Text style={styles.pickLabel}>{isDraft ? 'ASSIGN TO TEAM' : 'MOVE TO'}</Text>
                <View style={styles.teamGrid}>
                  {teams.filter(t => isDraft || t.id !== selectedPlayer.team_id).map(t => {
                    const logo = getTeamLogo(t);
                    return (
                      <TouchableOpacity key={t.id} style={[styles.teamTile, { borderColor: t.accent_color + '55' }]}
                        onPress={() => selectTarget(t)} activeOpacity={0.8}>
                        {logo
                          ? <Image source={logo} style={styles.teamTileLogo} resizeMode="contain" />
                          : <View style={[styles.teamTileLogoFallback, { backgroundColor: t.accent_color + '22' }]}>
                              <Text style={[styles.teamTileInitial, { color: t.accent_color }]}>{t.name[0]}</Text>
                            </View>
                        }
                        <Text style={styles.teamTileName} numberOfLines={2}>{t.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {!isDraft && (
                  <TouchableOpacity style={styles.dropoutBtn} onPress={() => selectTarget('dropout')} activeOpacity={0.8}>
                    <Text style={styles.dropoutBtnText}>Remove from Competition</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedPlayer(null)} activeOpacity={0.7}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}

            {phase === 'confirm' && selectedPlayer && (
              <>
                <Text style={styles.modalHeading}>
                  {isDraft ? 'CONFIRM SIGNING' : targetTeam === 'dropout' ? 'RELEASE PLAYER' : 'OFFICIAL TRANSFER'}
                </Text>

                <View style={styles.swapRow}>
                  {/* From logo — hidden for draft */}
                  {!isDraft && (
                    <Animated.View style={[styles.swapLogoWrap, { transform: [{ translateX: oldLogoX }], opacity: oldLogoOp }]}>
                      {currentTeam ? (() => {
                        const logo = getTeamLogo(currentTeam);
                        return logo
                          ? <Image source={logo} style={styles.swapLogo} resizeMode="contain" />
                          : <View style={[styles.swapLogoFallback, { backgroundColor: currentTeam.accent_color + '33' }]}>
                              <Text style={[styles.swapLogoInitial, { color: currentTeam.accent_color }]}>{currentTeam.name[0]}</Text>
                            </View>;
                      })() : <View style={styles.swapLogoFallback} />}
                      <Text style={styles.swapTeamLabel} numberOfLines={1}>{currentTeam?.name ?? 'No Team'}</Text>
                    </Animated.View>
                  )}

                  {/* Player avatar */}
                  <Animated.View style={[styles.swapPlayerWrap, { transform: [{ scale: playerScale }] }]}>
                    <PlayerAvatar player={selectedPlayer} size={80} ring />
                  </Animated.View>

                  {/* To logo */}
                  <Animated.View style={[styles.swapLogoWrap, { transform: [{ translateX: newLogoX }], opacity: newLogoOp }]}>
                    {targetTeam === 'dropout' ? (
                      <>
                        <View style={styles.releasedBadge}><Text style={styles.releasedBadgeText}>RELEASED</Text></View>
                        <Text style={styles.swapTeamLabel}>Released</Text>
                      </>
                    ) : targetTeamObj ? (() => {
                      const logo = getTeamLogo(targetTeamObj);
                      return <>
                        {logo
                          ? <Image source={logo} style={styles.swapLogo} resizeMode="contain" />
                          : <View style={[styles.swapLogoFallback, { backgroundColor: targetTeamObj.accent_color + '33' }]}>
                              <Text style={[styles.swapLogoInitial, { color: targetTeamObj.accent_color }]}>{targetTeamObj.name[0]}</Text>
                            </View>
                        }
                        <Text style={styles.swapTeamLabel} numberOfLines={1}>{targetTeamObj.name}</Text>
                      </>;
                    })() : null}
                  </Animated.View>
                </View>

                <Text style={styles.confirmPlayerName}>{selectedPlayer.display_name}</Text>
                <Text style={styles.confirmArrow}>
                  {isDraft ? 'Free Agent' : (currentTeam?.name ?? 'Unassigned')}
                  {'  →  '}
                  {targetTeam === 'dropout' ? 'Released' : targetTeamObj?.name}
                </Text>

                <TouchableOpacity
                  style={[styles.confirmBtn, saving && styles.confirmBtnDisabled]}
                  onPress={confirmAction} disabled={saving} activeOpacity={0.85}
                >
                  {saving
                    ? <ActivityIndicator color={colors.bg} />
                    : <Text style={styles.confirmBtnText}>
                        {isDraft ? 'Confirm Signing' : targetTeam === 'dropout' ? 'Confirm Release' : 'Confirm Transfer'}
                      </Text>
                  }
                </TouchableOpacity>

                {!saving && (
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setPhase('pick')} activeOpacity={0.7}>
                    <Text style={styles.cancelBtnText}>← Back</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {phase === 'done' && selectedPlayer && (
              <Animated.View style={[styles.doneWrap, { opacity: doneOp }]}>
                <Text style={styles.doneTick}>✓</Text>
                <Text style={styles.doneTitle}>
                  {isDraft ? 'PLAYER SIGNED' : targetTeam === 'dropout' ? 'PLAYER RELEASED' : 'TRANSFER COMPLETE'}
                </Text>
                <Text style={styles.doneSub}>
                  {selectedPlayer.display_name.split(' ')[0]}{' '}
                  {isDraft
                    ? `has been signed to ${targetTeamObj?.name}`
                    : targetTeam === 'dropout'
                    ? 'has been removed from the competition'
                    : `is now part of ${targetTeamObj?.name}`}
                </Text>
                <TouchableOpacity style={styles.doneBtn} onPress={() => setSelectedPlayer(null)} activeOpacity={0.85}>
                  <Text style={styles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              </Animated.View>
            )}

          </View>
        </View>
      </Modal>
    </View>
  );
}

function TeamHeader({ team, count }: { team: Team; count: number }) {
  const logo = getTeamLogo(team);
  return (
    <View style={styles.teamHeader}>
      {logo
        ? <Image source={logo} style={styles.teamHeaderLogo} resizeMode="contain" />
        : <View style={[styles.teamHeaderLogoFallback, { backgroundColor: team.accent_color + '22' }]}>
            <Text style={[styles.teamHeaderInitial, { color: team.accent_color }]}>{team.name[0]}</Text>
          </View>
      }
      <Text style={[styles.teamName, { color: team.accent_color }]}>{team.name.toUpperCase()}</Text>
      <Text style={styles.teamCount}>{count} players</Text>
    </View>
  );
}

function PlayerRow({ player, teamColor, actionLabel = 'TRANSFER', onPress }: {
  player: Player; teamColor: string; actionLabel?: string; onPress: () => void;
}) {
  const avatar = player.avatar_url ?? getPlayerAvatar(player.id, 'normal');
  return (
    <TouchableOpacity style={styles.playerRow} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.playerRowAvatarWrap, { borderColor: teamColor }]}>
        {avatar
          ? <Image source={typeof avatar === 'string' ? { uri: avatar } : avatar} style={styles.playerRowAvatar} />
          : <View style={[styles.playerRowAvatar, styles.playerRowAvatarFallback]}>
              <Text style={styles.playerRowInitial}>{player.display_name[0]}</Text>
            </View>
        }
      </View>
      <View style={styles.playerRowInfo}>
        <Text style={styles.playerRowName}>{player.display_name}</Text>
        <Text style={styles.playerRowHcp}>Hcp {player.handicap_index}</Text>
      </View>
      <View style={[styles.transferChip, actionLabel === 'DRAFT' && styles.draftChip]}>
        <Text style={[styles.transferChipText, actionLabel === 'DRAFT' && styles.draftChipText]}>{actionLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

function PlayerAvatar({ player, size, ring }: { player: Player; size: number; ring?: boolean }) {
  const avatar = player.avatar_url ?? getPlayerAvatar(player.id, 'normal');
  return (
    <View style={[styles.avatarRing, ring && styles.avatarRingGold, { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 }]}>
      {avatar
        ? <Image source={typeof avatar === 'string' ? { uri: avatar } : avatar} style={{ width: size, height: size, borderRadius: size / 2 }} />
        : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: colors.white }}>{player.display_name[0]}</Text>
          </View>
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingTop: 60, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { marginBottom: spacing.sm },
  backText: { fontSize: fonts.md, color: colors.gold, fontWeight: '600' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  headerTitle: { fontSize: fonts.xl, fontWeight: '900', color: colors.white, letterSpacing: 2 },
  liveBadge: { backgroundColor: colors.green, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  liveBadgeText: { fontSize: 9, fontWeight: '900', color: colors.white, letterSpacing: 1.5 },
  headerSub: { fontSize: fonts.xs, color: colors.textMuted },
  scroll: { padding: spacing.lg, paddingBottom: 60 },

  teamSection: {
    marginBottom: spacing.xl, backgroundColor: colors.card,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  draftSection: { borderColor: colors.goldBorder },
  teamHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.cardAlt,
  },
  draftHeader: { backgroundColor: colors.goldDim },
  draftIcon: { fontSize: 18 },
  teamHeaderLogo: { width: 32, height: 32 },
  teamHeaderLogoFallback: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  teamHeaderInitial: { fontSize: fonts.md, fontWeight: '900' },
  teamName: { flex: 1, fontSize: fonts.sm, fontWeight: '800', letterSpacing: 1 },
  teamCount: { fontSize: fonts.xs, color: colors.textMuted, fontWeight: '600' },
  emptyTeam: { fontSize: fonts.sm, color: colors.textMuted, padding: spacing.md, textAlign: 'center', fontStyle: 'italic' },

  playerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm,
  },
  playerRowAvatarWrap: { borderRadius: 22, borderWidth: 1.5, overflow: 'hidden' },
  playerRowAvatar: { width: 40, height: 40 },
  playerRowAvatarFallback: { backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  playerRowInitial: { fontSize: fonts.md, fontWeight: '700', color: colors.white },
  playerRowInfo: { flex: 1 },
  playerRowName: { fontSize: fonts.sm, fontWeight: '700', color: colors.white },
  playerRowHcp: { fontSize: fonts.xs, color: colors.textMuted, marginTop: 1 },
  transferChip: {
    backgroundColor: colors.cardAlt, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.border,
  },
  draftChip: { backgroundColor: colors.goldDim, borderColor: colors.goldBorder },
  transferChipText: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },
  draftChipText: { color: colors.gold },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: spacing.xl, paddingBottom: 48, paddingHorizontal: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center', minHeight: 500,
  },
  modalHeading: { fontSize: fonts.sm, fontWeight: '900', color: colors.gold, letterSpacing: 2, marginBottom: spacing.xs },
  modalSub: { fontSize: fonts.sm, color: colors.textMuted, marginBottom: spacing.lg, textAlign: 'center' },
  playerPreviewRow: { alignItems: 'center', marginBottom: spacing.lg },
  playerPreviewName: { fontSize: fonts.lg, fontWeight: '800', color: colors.white, marginTop: spacing.sm },
  playerPreviewHcp: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },
  pickLabel: { fontSize: 9, fontWeight: '800', color: colors.textMuted, letterSpacing: 2, alignSelf: 'flex-start', marginBottom: spacing.sm },
  teamGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, width: '100%', marginBottom: spacing.md },
  teamTile: {
    width: '30%', alignItems: 'center', padding: spacing.sm,
    backgroundColor: colors.cardAlt, borderRadius: radius.md, borderWidth: 1.5, gap: 4,
  },
  teamTileLogo: { width: 44, height: 44 },
  teamTileLogoFallback: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  teamTileInitial: { fontSize: fonts.xl, fontWeight: '900' },
  teamTileName: { fontSize: 9, fontWeight: '700', color: colors.textSecondary, textAlign: 'center', letterSpacing: 0.5 },
  dropoutBtn: {
    width: '100%', paddingVertical: spacing.sm + 2, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.red + '55', backgroundColor: 'rgba(248,113,113,0.08)',
    alignItems: 'center', marginBottom: spacing.sm,
  },
  dropoutBtnText: { fontSize: fonts.sm, fontWeight: '700', color: colors.red },
  cancelBtn: { paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  cancelBtnText: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600' },

  swapRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginVertical: spacing.xl, overflow: 'hidden',
  },
  swapLogoWrap: { width: 90, alignItems: 'center', gap: 6 },
  swapLogo: { width: 64, height: 64 },
  swapLogoFallback: { width: 64, height: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swapLogoInitial: { fontSize: 28, fontWeight: '900' },
  swapTeamLabel: { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textAlign: 'center' },
  swapPlayerWrap: { alignItems: 'center' },
  releasedBadge: {
    width: 64, height: 64, borderRadius: 12,
    backgroundColor: 'rgba(248,113,113,0.15)', borderWidth: 1.5, borderColor: colors.red + '55',
    alignItems: 'center', justifyContent: 'center',
  },
  releasedBadgeText: { fontSize: 9, fontWeight: '900', color: colors.red, letterSpacing: 1 },
  confirmPlayerName: { fontSize: fonts.xl, fontWeight: '900', color: colors.white, marginBottom: 4 },
  confirmArrow: { fontSize: fonts.sm, color: colors.textMuted, fontWeight: '600', marginBottom: spacing.xl },
  confirmBtn: {
    width: '100%', backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm,
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },

  doneWrap: { alignItems: 'center', paddingTop: spacing.xl },
  doneTick: { fontSize: 64, color: colors.gold, marginBottom: spacing.md },
  doneTitle: { fontSize: fonts.lg, fontWeight: '900', color: colors.white, letterSpacing: 2, marginBottom: spacing.sm },
  doneSub: { fontSize: fonts.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: spacing.xl },
  doneBtn: {
    backgroundColor: colors.gold, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, alignItems: 'center',
  },
  doneBtnText: { fontSize: fonts.md, fontWeight: '800', color: colors.bg, letterSpacing: 1 },
  avatarRing: { borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  avatarRingGold: { borderColor: colors.gold },
});

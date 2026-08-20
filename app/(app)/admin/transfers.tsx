import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, ScrollView, Modal, Animated, Platform,
  TextInput, KeyboardAvoidingView, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAdminSociety } from '../../../src/lib/useAdminSociety';
import { uploadImage } from '../../../src/lib/uploadImage';
import { teamLogos, getPlayerAvatar } from '../../../src/lib/assets';
import { goBack } from '../../../src/lib/navigation';

const GOLD   = '#D4AF37';
const GREEN  = '#4ade80';
const RED    = '#f87171';
const PURPLE = '#a78bfa';
const FF     = 'JUSTSans';
const FFB    = 'JUSTSans-ExBold';
const titanLogo = require('../../../assets/TitanAppLogo.png');

const SWATCHES = [
  '#D4AF37', '#1B3A5C', '#2D6A4F', '#9B2335',
  '#6B3FA0', '#4A5568', '#2B8A8A', '#C2611F',
  '#0284C7', '#BE185D', '#059669', '#312e81',
];

interface Team { id: string; name: string; accent_color: string; logo_url: string | null; logo_key: string | null; sort_order?: number; }
interface Player {
  id: string; display_name: string; handicap_index: number;
  avatar_url: string | null; team_id: string | null;
}
interface TeamEditState {
  id: string | null;
  name: string;
  color: string;
  logoUrl: string | null;
  localUri: string | null;
}
const BLANK_TEAM: TeamEditState = { id: null, name: '', color: SWATCHES[0], logoUrl: null, localUri: null };

function getTeamLogo(team: Team) {
  if (team.logo_url) return { uri: team.logo_url };
  const key = Object.keys(teamLogos).find(k => team.name.includes(k) || k.includes(team.name));
  return key ? teamLogos[key] : null;
}

export default function TransferWindowScreen() {
  const router = useRouter();
  const { societyId } = useAdminSociety();

  const [fontsLoaded] = useFonts({
    'JUSTSans': require('../../../assets/fonts/JUSTSans-Regular.otf'),
    'JUSTSans-ExBold': require('../../../assets/fonts/JUSTSans-ExBold.otf'),
  });

  const [teams, setTeams]           = useState<Team[]>([]);
  const [players, setPlayers]       = useState<Player[]>([]);
  const [freeAgents, setFreeAgents] = useState<Player[]>([]);
  const [loading, setLoading]       = useState(true);

  const [teamModal, setTeamModal] = useState(false);
  const [teamEdit,  setTeamEdit]  = useState<TeamEditState>(BLANK_TEAM);
  const [savingTeam, setSavingTeam] = useState(false);

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

  // Operates on the permanent roster (society_members.team_id) — the same
  // data Admin > Teams builds — not a specific tournament's competition_players.
  // Team Admin populates a team at creation; this is purely for moving
  // players around afterwards (or benching someone who's dropped out).
  async function load() {
    setLoading(true);
    const [{ data: teamsData }, { data: membersData }] = await Promise.all([
      supabase.from('teams').select('id,name,accent_color,logo_url,logo_key,sort_order').eq('society_id', societyId).order('sort_order'),
      supabase.from('society_members').select('player_id,team_id,players(display_name,handicap_index,avatar_url)').eq('society_id', societyId),
    ]);

    if (!teamsData) { setLoading(false); return; }
    setTeams(teamsData as Team[]);

    const rows = (membersData ?? []) as any[];
    const toPlayer = (r: any): Player => ({
      id: r.player_id,
      display_name: r.players?.display_name ?? 'Unknown',
      handicap_index: r.players?.handicap_index ?? 0,
      avatar_url: r.players?.avatar_url ?? null,
      team_id: r.team_id,
    });
    setPlayers(rows.filter(r => r.team_id).map(toPlayer));
    setFreeAgents(rows.filter(r => !r.team_id).map(toPlayer));

    setLoading(false);
  }

  function resetAnimations() {
    oldLogoX.setValue(0); oldLogoOp.setValue(1);
    newLogoX.setValue(160); newLogoOp.setValue(0);
    playerScale.setValue(1); doneOp.setValue(0);
  }

  function openNewTeam() {
    setTeamEdit(BLANK_TEAM);
    setTeamModal(true);
  }

  function openEditTeam(team: Team) {
    setTeamEdit({ id: team.id, name: team.name, color: team.accent_color, logoUrl: team.logo_url, localUri: null });
    setTeamModal(true);
  }

  async function pickTeamLogo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled) {
      setTeamEdit(e => ({ ...e, localUri: result.assets[0].uri }));
    }
  }

  async function uploadTeamLogo(teamId: string, localUri: string): Promise<string> {
    return uploadImage(localUri, 'society-assets', `${societyId}/teams/${teamId}.jpg`);
  }

  // Create and edit both land back on this same screen — the player pool
  // and every roster are right here, so there's no "create team, then go
  // find somewhere else to populate it" hop.
  async function saveTeamDetails() {
    if (!teamEdit.name.trim()) { Alert.alert('Required', 'Team name is required.'); return; }
    if (!societyId) return;
    setSavingTeam(true);
    try {
      let teamId = teamEdit.id;

      if (!teamId) {
        const { data, error } = await supabase
          .from('teams')
          .insert({
            society_id: societyId,
            name: teamEdit.name.trim(),
            accent_color: teamEdit.color,
            sort_order: teams.length,
          })
          .select('id')
          .single();
        if (error) throw error;
        teamId = (data as any).id;
      } else {
        const { error } = await supabase
          .from('teams')
          .update({ name: teamEdit.name.trim(), accent_color: teamEdit.color } as any)
          .eq('id', teamId);
        if (error) throw error;
      }

      if (teamEdit.localUri && teamId) {
        const url = await uploadTeamLogo(teamId, teamEdit.localUri);
        await supabase.from('teams').update({ logo_url: url } as any).eq('id', teamId);
      }

      setTeamModal(false);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save team.');
    } finally {
      setSavingTeam(false);
    }
  }

  function confirmDeleteTeam() {
    if (!teamEdit.id) return;
    Alert.alert(
      `Delete "${teamEdit.name}"?`,
      'This will remove the team and unassign all players from it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setSavingTeam(true);
            const { error } = await supabase.from('teams').delete().eq('id', teamEdit.id!);
            setSavingTeam(false);
            if (error) { Alert.alert('Error', error.message); return; }
            setTeamModal(false);
            await load();
          },
        },
      ],
    );
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
    if (!selectedPlayer || saving) return;
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

    // Draft, move, and dropout are all the same underlying write — the
    // permanent roster only has one field to change (team_id). Dropout just
    // means "bench them" (team_id null), not removing their membership.
    await supabase.from('society_members')
      .update({ team_id: targetTeamObj?.id ?? null } as any)
      .eq('society_id', societyId).eq('player_id', selectedPlayer.id);

    if (isDraft) {
      const updatedPlayer: Player = { ...selectedPlayer, team_id: targetTeamObj?.id ?? null };
      setPlayers(prev => [...prev, updatedPlayer]);
      setFreeAgents(prev => prev.filter(p => p.id !== selectedPlayer.id));
    } else if (targetTeam === 'dropout') {
      setPlayers(prev => prev.filter(p => p.id !== selectedPlayer.id));
      setFreeAgents(prev => [...prev, { ...selectedPlayer, team_id: null }]);
    } else {
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

  if (loading || !fontsLoaded) return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <StatusBar style="light" /><ActivityIndicator color={GOLD} size="large" />
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header — three-column */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack(router, '/(app)/admin/hub-tournament')} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>‹ Admin</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image source={titanLogo} style={styles.logo} resizeMode="contain" />
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>TEAMS/PLAYERS</Text>
            <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>OPEN</Text></View>
          </View>
          <Text style={styles.headerSub}>tap a player to move · tap a team to edit</Text>
        </View>
        <TouchableOpacity onPress={openNewTeam} style={styles.headerAddBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.headerAddBtnText}>+ Team</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {teams.length === 0 && (
          <TouchableOpacity style={styles.createFirstTeamBtn} onPress={openNewTeam} activeOpacity={0.85}>
            <Text style={styles.createFirstTeamBtnText}>+ Create Your First Team</Text>
          </TouchableOpacity>
        )}

        {/* Free Agents */}
        {freeAgents.length > 0 && (
          <View style={[styles.teamSection, styles.draftSection]}>
            <View style={[styles.teamHeader, styles.draftHeader]}>
              <Text style={styles.draftIcon}>⚡</Text>
              <Text style={[styles.teamName, { color: GOLD }]}>FREE AGENTS</Text>
              <Text style={styles.teamCount}>{freeAgents.length} available</Text>
            </View>
            {freeAgents.map(player => (
              <PlayerRow
                key={player.id}
                player={player}
                teamColor={GOLD}
                actionLabel="DRAFT"
                onPress={() => openDraft(player)}
              />
            ))}
          </View>
        )}

        {/* Teams */}
        {playersByTeam.map(({ team, members }) => (
          <View key={team.id} style={styles.teamSection}>
            <TeamHeader team={team} count={members.length} onPress={() => openEditTeam(team)} />
            {members.map(player => (
              <PlayerRow key={player.id} player={player} teamColor={team.accent_color} onPress={() => openTransfer(player)} />
            ))}
            {members.length === 0 && <Text style={styles.emptyTeam}>No players assigned</Text>}
          </View>
        ))}

      </ScrollView>

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
                    <> is currently in <Text style={{ color: GOLD, fontFamily: FFB }}>{currentTeam?.name ?? 'No Team'}</Text></>
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
                    <Text style={styles.dropoutBtnText}>Drop From Team</Text>
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

                  {/* GOLD transfer arrow in the middle */}
                  <View style={styles.transferArrowWrap}>
                    <Animated.View style={[styles.swapPlayerWrap, { transform: [{ scale: playerScale }] }]}>
                      <PlayerAvatar player={selectedPlayer} size={80} ring />
                    </Animated.View>
                    <Text style={styles.transferArrow}>→</Text>
                  </View>

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
                    ? <ActivityIndicator color="#000" />
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
                    ? 'has been dropped from the team'
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

      {/* Create / Edit Team modal — same build system as the old Teams
          screen, just landing back on this screen (not a separate menu) so
          a freshly created team's roster can be filled straight from the
          player pool below. */}
      <Modal
        visible={teamModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTeamModal(false)}
      >
        <KeyboardAvoidingView style={styles.teamModal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.teamModalHeader}>
            <TouchableOpacity onPress={() => setTeamModal(false)} hitSlop={hit}>
              <Text style={styles.teamModalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.teamModalTitle}>{teamEdit.id ? 'Edit Team' : 'New Team'}</Text>
            <TouchableOpacity onPress={saveTeamDetails} disabled={savingTeam} hitSlop={hit}>
              <Text style={[styles.teamModalSave, savingTeam && { opacity: 0.4 }]}>
                {savingTeam ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.teamModalScroll} keyboardShouldPersistTaps="handled">

            <TouchableOpacity style={styles.logoArea} onPress={pickTeamLogo} activeOpacity={0.8}>
              <View style={[styles.logoCircle, { borderColor: teamEdit.color }]}>
                {(teamEdit.localUri ?? teamEdit.logoUrl)
                  ? <Image source={{ uri: (teamEdit.localUri ?? teamEdit.logoUrl)! }} style={styles.logoImg} />
                  : teamLogos[teamEdit.name]
                  ? <Image source={teamLogos[teamEdit.name]} style={styles.logoImg} />
                  : (
                    <View style={[styles.logoFallback, { backgroundColor: teamEdit.color + '22' }]}>
                      <Text style={styles.logoFallbackIcon}>⛳</Text>
                    </View>
                  )
                }
              </View>
              <Text style={[styles.logoTapHint, { color: teamEdit.color }]}>
                {(teamEdit.localUri ?? teamEdit.logoUrl) ? 'Change Crest' : 'Add Team Crest'}
              </Text>
              <Text style={styles.logoSubHint}>Square · PNG or JPEG</Text>
            </TouchableOpacity>

            <View style={styles.teamModalSection}>
              <Text style={styles.teamModalSectionLabel}>TEAM NAME</Text>
              <TextInput
                style={styles.teamModalInput}
                value={teamEdit.name}
                onChangeText={v => setTeamEdit(e => ({ ...e, name: v }))}
                placeholder="e.g. The Elite"
                placeholderTextColor="#444"
                autoFocus={!teamEdit.id}
              />
            </View>

            <View style={styles.teamModalSection}>
              <Text style={styles.teamModalSectionLabel}>TEAM COLOUR</Text>
              <View style={styles.swatchGrid}>
                {SWATCHES.map(hex => (
                  <TouchableOpacity
                    key={hex}
                    style={[styles.swatch, { backgroundColor: hex }, teamEdit.color === hex && styles.swatchOn]}
                    onPress={() => setTeamEdit(e => ({ ...e, color: hex }))}
                    activeOpacity={0.8}
                  >
                    {teamEdit.color === hex && <Text style={styles.swatchTick}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {teamEdit.id && (
              <TouchableOpacity style={styles.teamDeleteBtn} onPress={confirmDeleteTeam} disabled={savingTeam} activeOpacity={0.8}>
                <Text style={styles.teamDeleteBtnText}>Delete Team</Text>
              </TouchableOpacity>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const hit = { top: 12, bottom: 12, left: 12, right: 12 };

function TeamHeader({ team, count, onPress }: { team: Team; count: number; onPress: () => void }) {
  const logo = getTeamLogo(team);
  return (
    <TouchableOpacity style={styles.teamHeader} onPress={onPress} activeOpacity={0.75}>
      {logo
        ? <Image source={logo} style={styles.teamHeaderLogo} resizeMode="contain" />
        : <View style={[styles.teamHeaderLogoFallback, { backgroundColor: team.accent_color + '22' }]}>
            <Text style={[styles.teamHeaderInitial, { color: team.accent_color }]}>{team.name[0]}</Text>
          </View>
      }
      <Text style={[styles.teamName, { color: team.accent_color }]}>{team.name.toUpperCase()}</Text>
      <Text style={styles.teamCount}>{count} players</Text>
      <Text style={styles.teamEditIcon}>✎</Text>
    </TouchableOpacity>
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
        : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: size * 0.4, fontFamily: FFB, color: '#fff' }}>{player.display_name[0]}</Text>
          </View>
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { width: 70 },
  backText: { fontSize: 15, fontFamily: FFB, color: GOLD },
  headerCenter: { alignItems: 'center', gap: 2 },
  logo: { width: 28, height: 28, marginBottom: 2 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 14, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },
  liveBadge: { backgroundColor: GREEN, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  liveBadgeText: { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1.5 },
  headerSub: { fontSize: 9, fontFamily: FFB, color: '#fff' },

  scroll: { padding: 20, paddingBottom: 60 },

  teamSection: {
    marginBottom: 20, backgroundColor: '#111',
    borderRadius: 14, borderWidth: 1, borderColor: '#1c1c1c', overflow: 'hidden',
  },
  draftSection: { borderColor: `${GOLD}44` },
  teamHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c', backgroundColor: '#1a1a1a',
  },
  draftHeader: { backgroundColor: `${GOLD}11` },
  draftIcon: { fontSize: 18 },
  teamHeaderLogo: { width: 32, height: 32 },
  teamHeaderLogoFallback: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  teamHeaderInitial: { fontSize: 14, fontFamily: FFB },
  teamName: { flex: 1, fontSize: 13, fontFamily: FFB, letterSpacing: 1 },
  teamCount: { fontSize: 11, fontFamily: FFB, color: '#fff' },
  emptyTeam: { fontSize: 13, fontFamily: FFB, color: '#fff', padding: 16, textAlign: 'center', fontStyle: 'italic' },

  playerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c', gap: 12,
  },
  playerRowAvatarWrap: { borderRadius: 22, borderWidth: 1.5, overflow: 'hidden' },
  playerRowAvatar: { width: 40, height: 40 },
  playerRowAvatarFallback: { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' },
  playerRowInitial: { fontSize: 14, fontFamily: FFB, color: '#fff' },
  playerRowInfo: { flex: 1 },
  playerRowName: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  playerRowHcp: { fontSize: 11, fontFamily: FFB, color: '#fff', marginTop: 1 },
  transferChip: {
    backgroundColor: '#1a1a1a', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: '#1c1c1c',
  },
  draftChip: { backgroundColor: `${GOLD}18`, borderColor: `${GOLD}55` },
  transferChipText: { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 1 },
  draftChipText: { color: GOLD },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 28, paddingBottom: 48, paddingHorizontal: 24,
    borderTopWidth: 1, borderTopColor: '#1c1c1c', alignItems: 'center', minHeight: 500,
  },
  modalHeading: { fontSize: 13, fontFamily: FFB, color: GOLD, letterSpacing: 2, marginBottom: 6 },
  modalSub: { fontSize: 13, fontFamily: FFB, color: '#fff', marginBottom: 20, textAlign: 'center' },
  playerPreviewRow: { alignItems: 'center', marginBottom: 20 },
  playerPreviewName: { fontSize: 17, fontFamily: FFB, color: '#fff', marginTop: 10 },
  playerPreviewHcp: { fontSize: 13, fontFamily: FFB, color: '#fff' },
  pickLabel: { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 2, alignSelf: 'flex-start', marginBottom: 10 },
  teamGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', marginBottom: 16 },
  teamTile: {
    width: '30%', alignItems: 'center', padding: 10,
    backgroundColor: '#1a1a1a', borderRadius: 12, borderWidth: 1.5, gap: 4,
  },
  teamTileLogo: { width: 44, height: 44 },
  teamTileLogoFallback: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  teamTileInitial: { fontSize: 18, fontFamily: FFB },
  teamTileName: { fontSize: 9, fontFamily: FFB, color: '#fff', textAlign: 'center', letterSpacing: 0.5 },
  dropoutBtn: {
    width: '100%', paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: `${RED}55`, backgroundColor: 'rgba(248,113,113,0.08)',
    alignItems: 'center', marginBottom: 10,
  },
  dropoutBtnText: { fontSize: 13, fontFamily: FFB, color: RED },
  cancelBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 6 },
  cancelBtnText: { fontSize: 13, fontFamily: FFB, color: '#fff' },

  swapRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginVertical: 24, overflow: 'hidden',
  },
  transferArrowWrap: { alignItems: 'center', gap: 4 },
  transferArrow: { fontSize: 22, fontFamily: FFB, color: GOLD },
  swapLogoWrap: { width: 90, alignItems: 'center', gap: 6 },
  swapLogo: { width: 64, height: 64 },
  swapLogoFallback: { width: 64, height: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swapLogoInitial: { fontSize: 28, fontFamily: FFB },
  swapTeamLabel: { fontSize: 9, fontFamily: FFB, color: '#fff', letterSpacing: 0.5, textAlign: 'center' },
  swapPlayerWrap: { alignItems: 'center' },
  releasedBadge: {
    width: 64, height: 64, borderRadius: 12,
    backgroundColor: 'rgba(248,113,113,0.15)', borderWidth: 1.5, borderColor: `${RED}55`,
    alignItems: 'center', justifyContent: 'center',
  },
  releasedBadgeText: { fontSize: 9, fontFamily: FFB, color: RED, letterSpacing: 1 },
  confirmPlayerName: { fontSize: 18, fontFamily: FFB, color: '#fff', marginBottom: 4 },
  confirmArrow: { fontSize: 13, fontFamily: FFB, color: '#fff', marginBottom: 24 },
  confirmBtn: {
    width: '100%', backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginBottom: 10,
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 1 },

  doneWrap: { alignItems: 'center', paddingTop: 28 },
  doneTick: { fontSize: 64, color: GOLD, marginBottom: 16 },
  doneTitle: { fontSize: 17, fontFamily: FFB, color: '#fff', letterSpacing: 2, marginBottom: 10 },
  doneSub: { fontSize: 13, fontFamily: FFB, color: '#fff', textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  doneBtn: {
    backgroundColor: GOLD, borderRadius: 12,
    paddingVertical: 16, paddingHorizontal: 40, alignItems: 'center',
  },
  doneBtnText: { fontSize: 15, fontFamily: FFB, color: '#000', letterSpacing: 1 },
  avatarRing: { borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  avatarRingGold: { borderColor: GOLD },

  // Header "+ Team" button
  headerAddBtn: { width: 70, alignItems: 'flex-end' },
  headerAddBtnText: { fontSize: 14, fontFamily: FFB, color: GOLD },

  // Empty-state create-team prompt
  createFirstTeamBtn: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: GOLD, borderStyle: 'dashed',
    paddingVertical: 16, alignItems: 'center', marginBottom: 20,
  },
  createFirstTeamBtnText: { fontFamily: FFB, fontSize: 15, color: GOLD },

  // Team header edit affordance
  teamEditIcon: { fontSize: 13, color: '#666', marginLeft: 8 },

  // Team create/edit modal
  teamModal: { flex: 1, backgroundColor: '#000' },
  teamModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1c1c1c',
  },
  teamModalCancel: { fontFamily: FFB, fontSize: 14, color: '#fff' },
  teamModalTitle:  { fontFamily: FFB, fontSize: 16, color: '#fff' },
  teamModalSave:   { fontFamily: FFB, fontSize: 14, color: GOLD },
  teamModalScroll: { padding: 20, paddingBottom: 60 },

  logoArea:         { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 3, overflow: 'hidden', marginBottom: 10,
  },
  logoImg:          { width: '100%', height: '100%' },
  logoFallback:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoFallbackIcon: { fontSize: 44 },
  logoTapHint:      { fontFamily: FFB, fontSize: 14, marginBottom: 4 },
  logoSubHint:      { fontFamily: FFB, fontSize: 11, color: '#fff' },

  teamModalSection:      { marginBottom: 24 },
  teamModalSectionLabel: {
    fontFamily: FFB, fontSize: 10, color: '#fff',
    letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase',
  },
  teamModalInput: {
    backgroundColor: '#111', borderRadius: 12,
    borderWidth: 1, borderColor: '#1c1c1c',
    paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: FFB, fontSize: 16, color: '#fff',
  },

  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  swatchOn:   { borderColor: '#fff', transform: [{ scale: 1.12 }] },
  swatchTick: { color: '#fff', fontSize: 18, fontFamily: FFB },

  teamDeleteBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    paddingVertical: 14, alignItems: 'center',
  },
  teamDeleteBtnText: { fontFamily: FFB, fontSize: 14, color: RED },
});

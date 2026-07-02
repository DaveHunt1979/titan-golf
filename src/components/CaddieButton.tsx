import { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated,
  PanResponder, ActivityIndicator,
} from 'react-native';
import { startRecording, stopAndSendCommand, cancelRecording, VoiceCommandContext, VoiceCommandResult } from '../lib/voiceCommand';
import { colors, fonts, radius, spacing } from '../lib/theme';

interface Props {
  context: VoiceCommandContext;
  onAction?: (result: VoiceCommandResult) => void;
}

type State = 'idle' | 'recording' | 'processing';

export default function CaddieButton({ context, onAction }: Props) {
  const [state, setState] = useState<State>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const didRelease = useRef(false);

  function startPulse() {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  }

  function stopPulse() {
    pulseLoop.current?.stop();
    Animated.timing(pulse, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: async () => {
      didRelease.current = false;
      setState('recording');
      startPulse();
      try { await startRecording(); } catch { setState('idle'); stopPulse(); }
    },
    onPanResponderRelease: async () => {
      if (didRelease.current) return;
      didRelease.current = true;
      stopPulse();
      setState('processing');
      const result = await stopAndSendCommand(context);
      if (result) {
        setLastTranscript(result.transcript);
        onAction?.(result);
      }
      setState('idle');
    },
    onPanResponderTerminate: () => {
      if (didRelease.current) return;
      didRelease.current = true;
      stopPulse();
      cancelRecording();
      setState('idle');
    },
  })).current;

  const isRecording  = state === 'recording';
  const isProcessing = state === 'processing';

  return (
    <View style={styles.wrapper}>
      <View {...panResponder.panHandlers} style={styles.hitArea}>
        <Animated.View style={[
          styles.ring,
          isRecording && styles.ringActive,
          { transform: [{ scale: pulse }] },
        ]}>
          <View style={[styles.btn, isRecording && styles.btnActive, isProcessing && styles.btnProcessing]}>
            {isProcessing
              ? <ActivityIndicator color={colors.bg} size="small" />
              : <Text style={styles.mic}>{isRecording ? '🎙️' : '🎤'}</Text>
            }
          </View>
        </Animated.View>
      </View>

      <Text style={styles.label}>
        {isRecording ? 'Listening…' : isProcessing ? 'Chip is thinking…' : 'Hold to speak'}
      </Text>

      {lastTranscript && state === 'idle' && (
        <Text style={styles.transcript} numberOfLines={2}>"{lastTranscript}"</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:  { alignItems: 'center', gap: spacing.xs },
  hitArea:  { padding: spacing.sm },
  ring: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  ringActive: { borderColor: colors.gold },
  btn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnActive:     { backgroundColor: colors.gold, borderColor: colors.gold },
  btnProcessing: { backgroundColor: colors.cardAlt, borderColor: colors.goldBorder },
  mic:   { fontSize: 26 },
  label: { fontSize: fonts.xs, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5 },
  transcript: {
    fontSize: fonts.xs, color: colors.textSecondary,
    fontStyle: 'italic', textAlign: 'center',
    paddingHorizontal: spacing.lg, marginTop: 2,
  },
});

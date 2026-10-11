import { StyleSheet } from 'react-native';

export const GOLD = '#D4AF37';
export const RED = '#ef4444';
export const GREEN = '#4ade80';
export const FF = 'JUSTSans';
export const FFB = 'JUSTSans-ExBold';

// Tokens copied from app/(app)/swindle/create.tsx so Social 18 looks identical to the rest of the app.
export const st = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#000', paddingTop: 56 },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c', marginBottom: 8 },
  backBtn:     { flex: 1 },
  backText:    { color: GOLD, fontSize: 15, fontFamily: FFB },
  headerTitle: { color: '#fff', fontSize: 16, fontFamily: FFB },
  headerSpacer:{ flex: 1 },
  scroll:      { paddingHorizontal: 16, paddingBottom: 60, gap: 14 },
  label:       { color: '#9ca3af', fontSize: 11, fontFamily: FFB, letterSpacing: 1.5, marginBottom: 6 },
  input:       { backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15, fontFamily: FFB },
  card:        { backgroundColor: '#111', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 14, padding: 14, gap: 8 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowName:     { flex: 1, color: '#fff', fontSize: 15, fontFamily: FFB },
  sub:         { color: '#9ca3af', fontSize: 13, fontFamily: FF, lineHeight: 18 },
  chip:        { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#2a2a2a' },
  chipText:    { fontSize: 10, fontFamily: FFB, letterSpacing: 0.5, color: '#9ca3af' },
  primaryBtn:  { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#000', fontSize: 16, fontFamily: FFB, letterSpacing: 0.5 },
  redBtn:      { backgroundColor: RED, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  redText:     { color: '#fff', fontSize: 16, fontFamily: FFB, letterSpacing: 0.5 },
  ghostBtn:    { borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ghostText:   { color: '#fff', fontSize: 14, fontFamily: FFB },
  disabled:    { opacity: 0.4 },
  empty:       { color: '#9ca3af', textAlign: 'center', paddingVertical: 32, fontFamily: FFB, fontSize: 14 },
  pickerOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerSheet:        { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: '92%' },
  pickerHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1c1c1c' },
  pickerTitle:        { fontSize: 16, fontFamily: FFB, color: '#fff' },
  pickerClose:        { fontSize: 16, fontFamily: FFB, color: '#fff', paddingHorizontal: 8 },
  pickerSearch:       { margin: 16, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#1c1c1c', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: '#fff', fontFamily: FFB, fontSize: 15 },
  pickerItem:         { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1c1c1c', flexDirection: 'row', alignItems: 'center' },
  pickerItemActive:   { backgroundColor: 'rgba(212,175,55,0.1)' },
  pickerItemText:     { flex: 1, fontSize: 15, fontFamily: FFB, color: '#fff' },
  pickerItemTextActive: { color: GOLD },
  pickerChevron:      { color: GOLD, fontFamily: FFB, fontSize: 16 },
  pickerEmpty:        { color: '#fff', fontFamily: FFB, textAlign: 'center', paddingVertical: 32, fontSize: 14 },
  pickerClear:        { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  pickerClearText:    { color: '#fff', fontFamily: FFB, fontSize: 14 },
});

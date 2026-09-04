/**
 * Global Dynamic Type cap — imported once from app/_layout.tsx, before anything renders.
 *
 * Rick's report: with iOS accessibility text size turned right up, short button labels
 * ("Back", "Cancel", "Admin") wrapped onto a second line and broke button / nav-bar
 * layouts that were only ever sized for one line of text. We cap how far Dynamic Type
 * can scale text app-wide rather than switching scaling off — users still get noticeably
 * larger text, just not unbounded.
 *
 * Why not `Text.defaultProps` (the classic React Native way to do this)? It no longer
 * works here: React 19 dropped defaultProps for function components, and the automatic
 * JSX runtime this project compiles to (`react/jsx-dev-runtime`) never reads defaultProps
 * at all — so setting it would silently do nothing.
 *
 * Instead we swap the `Text` / `TextInput` exports on the `react-native` module for thin
 * wrappers that supply `maxFontSizeMultiplier` as a default. Every screen does
 * `import { Text } from 'react-native'`, which Metro compiles to a live property read
 * (`_reactNative.Text`) at render time, so replacing the export here reaches the whole app
 * without touching a single screen. An explicit `maxFontSizeMultiplier` or
 * `allowFontScaling` on a component still wins, because props spread after the default.
 */
import { createElement, forwardRef } from 'react';

/** Text may grow to 1.25x its designed size, no further. */
export const MAX_FONT_SIZE_MULTIPLIER = 1.25;

// Deliberately `require` rather than `import * as`: we need the real react-native module
// object that every other file reads from, not the interop copy `import * as` would give us.
const RN: Record<string, any> = require('react-native');

function capFontScaling(name: 'Text' | 'TextInput') {
  const Original = RN[name];
  if (typeof Original !== 'function' || Original.__titanFontCapped) return;

  const Capped = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    createElement(Original, { maxFontSizeMultiplier: MAX_FONT_SIZE_MULTIPLIER, ...props, ref }),
  );
  Object.assign(Capped, Original); // keep statics such as TextInput.State
  Capped.displayName = name;
  (Capped as any).__titanFontCapped = true;

  Object.defineProperty(RN, name, { configurable: true, enumerable: true, get: () => Capped });
}

capFontScaling('Text');
capFontScaling('TextInput');

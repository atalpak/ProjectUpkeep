import { Platform } from 'react-native';
import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type * as React from 'react';
import type { ViewProps } from 'react-native';
import type { TextEvidence } from '@upkeep/scan-core';
interface VisionModule {
  readText(uri: string): Promise<TextEvidence>;
  compareArtwork(uri: string, references: string[]): Promise<{index: number; confident: boolean}>;
}
const native = requireOptionalNativeModule<VisionModule>('UpkeepVision');
export const visionAvailable = !!native;
export async function readText(uri: string) {
  if (!native) throw new Error('On-device scanning requires an Upkeep development build. Manual search is available.');
  return native.readText(uri);
}
export async function compareArtwork(uri: string, references: string[]) {
  if (!native) return null;
  const result = await native.compareArtwork(uri, references);
  return result.confident && result.index >= 0 && result.index < references.length ? result.index : null;
}

/**
 * One finished read of one physical card, straightened and OCR'd natively.
 * `source` says which path produced it: `outline` is the automatic lock on a
 * detected card edge, `guide` is the manual "Scan card" button's read of the
 * corner-marked area (the full-art fallback, where Vision finds no edge).
 */
export type CardReadEvent = {
  title: string;
  lines: string[];
  printingLines: string[];
  /** Absent only if the straightened frame could not be written to disk. */
  source: 'outline' | 'guide';
};

export type ScannerViewProps = ViewProps & {
  /** Drives the capture session. The view never runs while this is false. */
  active: boolean;
  onCardRead?(event: { nativeEvent: CardReadEvent }): void;
  onCardLost?(event: { nativeEvent: Record<string, never> }): void;
  onOutlineChange?(event: { nativeEvent: { found: boolean } }): void;
  onScannerError?(event: { nativeEvent: { message: string } }): void;
};

export type ScannerViewHandle = { captureNow(): Promise<void> };

/**
 * Live scanning is iOS-only for now (owner decision: iPhone first), and the
 * view only exists in a native build — Expo Go and the Android build have no
 * `UpkeepVision` module at all, so callers must branch on this rather than
 * render a view that would throw at require time.
 */
export const scannerViewAvailable = Platform.OS === 'ios' && !!native;

export const UpkeepScannerView: React.ComponentType<ScannerViewProps & React.RefAttributes<ScannerViewHandle>> =
  scannerViewAvailable ? requireNativeViewManager('UpkeepVision') : (null as never);

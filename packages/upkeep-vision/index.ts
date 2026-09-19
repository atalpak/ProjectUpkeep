import { Platform } from 'react-native';
import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type * as React from 'react';
import type { ViewProps } from 'react-native';
import type { ScanStatus, TextEvidence } from '@upkeep/scan-core';
interface VisionModule {
  readText(uri: string): Promise<TextEvidence>;
  compareArtwork(uri: string, references: string[]): Promise<{index: number; confident: boolean}>;
  /** Added with the alternate-art work; an older native build lacks it. */
  rankCardImage?(uri: string, references: string[]): Promise<{ distances: number[] }>;
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

/** True when this build can compare a card photo with candidate pictures (`rankCardImage`). */
export const cardImageRankingAvailable = !!native && typeof native.rankCardImage === 'function';

/**
 * How far the photo of a whole, straightened card is from each reference
 * picture (local file URIs), in the references' order, lower = closer.
 * A reference that could not be read comes back as `null`. Returns null when
 * the build has no such function (older native build) or the photo could not
 * be read at all, so callers fall back to asking the person.
 */
export async function rankCardImage(uri: string, references: string[]): Promise<(number | null)[] | null> {
  if (!native?.rankCardImage) return null;
  const { distances } = await native.rankCardImage(uri, references);
  if (!Array.isArray(distances) || distances.length !== references.length) return null;
  return distances.map(d => (Number.isFinite(d) && d >= 0 ? d : null));
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
  /** Which path produced this read -- see the type's own comment. */
  source: 'outline' | 'guide';
  /** file:// URI of the straightened card as a JPEG in the temp directory (only
   *  the newest few are kept). Absent on a native build from before this field
   *  existed, or if the write failed: callers must not assume it. */
  imageUri?: string;
};

export type ScannerViewProps = ViewProps & {
  /** Drives the capture session. The view never runs while this is false. */
  active: boolean;
  /** Quick scan: detect on every frame, show no outline while searching, and
   *  capture the sharpest frame of a hand-held burst instead of waiting for the
   *  card to hold still. Native prop: needs a native rebuild, ignored by an
   *  older build. */
  fastDetection?: boolean;
  onCardRead?(event: { nativeEvent: CardReadEvent }): void;
  onCardLost?(event: { nativeEvent: Record<string, never> }): void;
  onOutlineChange?(event: { nativeEvent: { found: boolean } }): void;
  onScannerError?(event: { nativeEvent: { message: string } }): void;
  /** Quick scan only: what the scanner currently sees, sent when it changes, for
   *  live coaching. Absent on an older native build, so callers must treat the
   *  silence as "no information" and keep a static hint. */
  onScanStatus?(event: { nativeEvent: { status: ScanStatus } }): void;
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

import { requireOptionalNativeModule } from 'expo-modules-core';
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

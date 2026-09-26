import { stubModule } from './stubs';

// expo-secure-store as a Map: enough for the small "last checked" records the
// app keeps on the device.

export const secureStore = new Map<string, string>();

stubModule('expo-secure-store', {
  getItemAsync: async (key: string) => secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { secureStore.set(key, value); },
  deleteItemAsync: async (key: string) => { secureStore.delete(key); },
});

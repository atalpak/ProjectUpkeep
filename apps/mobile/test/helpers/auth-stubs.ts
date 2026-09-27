import { stubModule } from './stubs';
export const authTest = {
  user: { id: 'u1', email: 'one@example.com', identities: [{ provider: 'email' }] },
  reauthError: null as { status: number; code?: string; message: string } | null,
  reauthId: 'u1', updateError: null as { message: string } | null,
  calls: [] as { kind: string; value?: unknown }[],
  onReauth: null as (() => void) | null,
};
stubModule('./backend', {
  backend: { auth: { getUser: async () => ({ data: { user: authTest.user }, error: null }) } },
  createPasswordClient: () => ({ auth: {
    signInWithPassword: async (value: unknown) => { authTest.calls.push({ kind: 'reauth', value }); authTest.onReauth?.(); return { data: { user: { id: authTest.reauthId } }, error: authTest.reauthError }; },
    updateUser: async (value: unknown) => { authTest.calls.push({ kind: 'update', value }); return { error: authTest.updateError }; },
  } }),
});
stubModule('./errors', { errorMessage: (error: { message: string }) => error.message });

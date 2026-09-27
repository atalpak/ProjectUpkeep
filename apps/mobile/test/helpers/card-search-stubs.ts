import { stubModule } from './stubs';
let token: string | null = 'mobile-token';
export function setSearchToken(value: string | null) { token = value; }
stubModule('./backend', { backend: { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null }, error: null }) } } });
stubModule('./auth', { WEB_URL: 'https://upkeep.example' });

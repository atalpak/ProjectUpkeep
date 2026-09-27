/** A supplied Authorization header must never fall back to a cookie session. */
export async function authenticateRequest<T>(
  authorization: string | null,
  cookieClient: () => Promise<T>,
  bearerClient: (token: string) => T,
  validate: (client: T, token?: string) => Promise<boolean>,
): Promise<T | null> {
  if (authorization !== null) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) return null;
    const client = bearerClient(match[1]);
    return await validate(client, match[1]) ? client : null;
  }
  const client = await cookieClient();
  return await validate(client) ? client : null;
}

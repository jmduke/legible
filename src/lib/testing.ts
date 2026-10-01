/**
 * Test-only helper: wrap a URL-based route handler as a `typeof fetch`,
 * sparing every suite the same cast-and-parse boilerplate.
 */
export function routeFetch(
  handler: (url: URL) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: string | URL | Request) =>
    handler(new URL(String(input)))) as typeof fetch;
}

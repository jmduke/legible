import robotsParser from "robots-parser";
import { USER_AGENT } from "./constants";

export type RobotsChecker = (url: string) => boolean;

/**
 * Fetch and parse robots.txt for an origin. If robots.txt is missing or
 * unreachable we allow everything, matching standard crawler convention.
 */
export async function loadRobots(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RobotsChecker> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  try {
    const res = await fetchImpl(robotsUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return () => true;
    const body = await res.text();
    const robots = robotsParser(robotsUrl, body);
    return (url: string) => robots.isAllowed(url, USER_AGENT) !== false;
  } catch {
    return () => true;
  }
}

export function mayShowFieldFixtures(environment: string | undefined, configured: boolean): boolean {
  return environment !== "production" && !configured;
}

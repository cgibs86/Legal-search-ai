// Minimal stand-in for next/headers in unit tests.
const jar = new Map<string, string>();
export async function cookies() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
  };
}
export async function headers() {
  return new Headers();
}
export function __setCookie(name: string, value: string | null) {
  if (value === null) jar.delete(name);
  else jar.set(name, value);
}

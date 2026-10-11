/** Bounded, exact-input memoization for pure text parsers, never recommendations. */
export function researchTextCache<T>(
  parse: (text: string) => T,
  capacity = 128,
) {
  const cache = new Map<string, T>();
  return (text: string): T => {
    if (cache.has(text)) return cache.get(text)!;
    const result = parse(text);
    if (cache.size >= capacity) cache.delete(cache.keys().next().value!);
    cache.set(text, result);
    return result;
  };
}

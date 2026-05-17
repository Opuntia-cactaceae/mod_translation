/**
 * Run async tasks with a concurrency limit.
 * Each task should handle its own errors internally.
 */
export async function runWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit = 5,
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch {
        // Task should handle its own errors; if it doesn't,
        // we just leave a gap and move on
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

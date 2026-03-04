interface ScanCapableRedisClient {
  scan(cursor: string, option: "MATCH", pattern: string, countOption: "COUNT", count: number): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
}

export const deleteRedisKeysByPrefix = async (
  redis: ScanCapableRedisClient,
  prefixes: readonly string[]
): Promise<void> => {
  for (const prefix of prefixes) {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  }
};

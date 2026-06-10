import { existsSync } from "node:fs";
import path from "node:path";

// The repo-local .env MUST take precedence over a parent ../.env. process.loadEnvFile
// does not override already-set keys, so the local file is loaded first. This stops
// tests from inheriting a production deploy env (e.g. a parent ../.env on the VPS that
// points DATABASE_URL/REDIS_URL at production Supabase/Render) and running against it.
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env")
];

for (const envPath of envCandidates) {
  if (!existsSync(envPath)) {
    continue;
  }

  process.loadEnvFile(envPath);
}

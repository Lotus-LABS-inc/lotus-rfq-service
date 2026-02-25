import { existsSync } from "node:fs";
import path from "node:path";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env")
];

for (const envPath of envCandidates) {
  if (!existsSync(envPath)) {
    continue;
  }

  process.loadEnvFile(envPath);
  break;
}

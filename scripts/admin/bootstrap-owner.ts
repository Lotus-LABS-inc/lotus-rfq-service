import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { AdminAuthService } from "../../src/api/admin/admin-auth-service.js";
import { AdminAuthRepository } from "../../src/repositories/admin-auth.repository.js";

loadDotenv();

const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
const keyPepper = process.env.ADMIN_AUTH_KEY_PEPPER;

if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL, DATABASE_URL, or TEST_DATABASE_URL is required.");
}
if (!bootstrapEmail) {
  throw new Error("ADMIN_BOOTSTRAP_EMAIL is required.");
}
if (!keyPepper || keyPepper.length < 32) {
  throw new Error("ADMIN_AUTH_KEY_PEPPER must be at least 32 characters.");
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  const repository = new AdminAuthRepository(pool);
  const service = new AdminAuthService(repository, {
    keyPepper,
    allowedEmailDomains: process.env.ADMIN_ALLOWED_EMAIL_DOMAINS
  });
  const owner = await service.createMember({
    email: bootstrapEmail,
    role: "OWNER",
    actorId: null
  });
  const key = await service.createKey({
    memberId: owner.id,
    actorId: owner.id
  });
  console.log(JSON.stringify({
    status: "OWNER_BOOTSTRAPPED",
    email: owner.email,
    memberId: owner.id,
    keyId: key.key.keyId,
    loginKey: key.loginKey,
    warning: "This loginKey is shown once. Store it in the operator password manager, then rotate it from the admin UI if needed."
  }, null, 2));
} finally {
  await pool.end();
}

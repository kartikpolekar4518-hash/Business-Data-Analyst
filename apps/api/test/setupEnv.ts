// vitest setupFiles: runs before each integration test file's imports resolve
// env.ts, guaranteeing DATABASE_URL/JWT_SECRET are present.
import "./loadTestEnv.js";

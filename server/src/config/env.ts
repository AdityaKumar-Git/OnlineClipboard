import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// The single .env file lives at the repo root (next to docker-compose.yml).
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_SECRET: optionalString,

  DATABASE_URL: z.string().min(1).default('postgresql://clipboard:clipboard@localhost:5432/clipboard'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // Required from Phase 1/3 onwards; optional until those features exist.
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  GOOGLE_DRIVE_REDIRECT_URI: optionalString,
  TOKEN_ENC_KEY: optionalString,
  // Empty = production mode (no known refresh-token expiry).
  DRIVE_REFRESH_TOKEN_TTL_DAYS: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),

  MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(100),
  MAX_TEXT_KB: z.coerce.number().int().positive().default(100),
  PIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  PIN_TTL_MIN_MINUTES: z.coerce.number().int().positive().default(5),
  PIN_TTL_MAX_MINUTES: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names and issues are printed — never values.
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

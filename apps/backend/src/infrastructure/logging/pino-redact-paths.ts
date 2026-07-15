/**
 * Fields Pino must strip from every log line, regardless of nesting depth.
 * Required by CODING_STANDARDS.md: "Never log: Passwords, Tokens, Secrets,
 * Personal sensitive information."
 */
export const PINO_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.refreshToken',
  'req.body.accessToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.apiKey',
];

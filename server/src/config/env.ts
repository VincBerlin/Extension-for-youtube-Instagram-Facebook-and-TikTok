// Tiny env helper. Replaces `process.env.X!` non-null assertions with calls
// that fail explicitly at boot when a required value is missing, instead of
// emitting a cryptic runtime error several requests later.

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function optionalEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback
}

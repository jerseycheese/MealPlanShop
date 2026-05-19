export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in environment (.env file)`);
    process.exit(1);
  }
  return v;
}

import { z } from 'zod';

const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(rawEnv: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: rawEnv.NEXT_PUBLIC_API_URL,
  });

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid web environment configuration: ${details}`);
  }

  return result.data;
}

export function getWebEnv(): WebEnv {
  return parseWebEnv({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });
}

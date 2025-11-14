import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4101),
  HOST: z.string().default('0.0.0.0'),
  SERVICE_NAME: z.string().default('authoring-api'),
  DATABASE_URL: z.string(),
  PUBLICATION_SERVICE_URL: z.string().url().default('http://localhost:4103'),
  API_KEY: z.string().optional(),
  PUBLICATION_SERVICE_API_KEY: z.string().optional()
});

export type ServiceConfig = z.infer<typeof schema>;

export const loadConfig = (): ServiceConfig => schema.parse(process.env);

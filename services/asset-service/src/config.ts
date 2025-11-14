import path from 'path';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4102),
  HOST: z.string().default('0.0.0.0'),
  SERVICE_NAME: z.string().default('asset-service'),
  DATA_DIR: z.string().default('../../data'),
  API_KEY: z.string().optional()
});

type RawConfig = z.infer<typeof schema>;
export type ServiceConfig = RawConfig & { DATA_DIR: string };

export const loadConfig = (): ServiceConfig => {
  const raw = schema.parse(process.env);
  return {
    ...raw,
    DATA_DIR: path.resolve(process.cwd(), raw.DATA_DIR)
  };
};

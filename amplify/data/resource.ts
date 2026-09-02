import { type ClientSchema, defineData } from '@aws-amplify/backend';
import { schema as sqlSchema } from './schema.sql';

export type Schema = ClientSchema<typeof sqlSchema>;

export const data = defineData({
  schema: sqlSchema,
});

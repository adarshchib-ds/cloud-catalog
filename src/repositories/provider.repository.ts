import { prisma } from '../config/database';
import { Provider } from '@prisma/client';

export async function upsertProvider(id: string, name: string): Promise<Provider> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return prisma.provider.upsert({
    where: { id },
    update: { name, slug },
    create: { id, name, slug },
  });
}

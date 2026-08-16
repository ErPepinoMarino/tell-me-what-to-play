import { prisma } from "../lib/prisma.js";

export const prismaUserRepository = {
  async findByIdentity(provider: string, providerSub: string) {
    const identity = await prisma.user_identities.findUnique({
      where: {
        provider_provider_sub: {
          provider,
          provider_sub: providerSub,
        },
      },
      include: {
        users: true,
      },
    });

    if (!identity) return undefined;

    return {
      id: identity.users.id,
      email: identity.users.email,
    };
  },

  async create(email: string, provider: string, providerSub: string) {
    const user = await prisma.users.create({
      data: {
        email,
        identities: {
          create: {
            provider,
            provider_sub: providerSub,
          },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
    };
  },
};

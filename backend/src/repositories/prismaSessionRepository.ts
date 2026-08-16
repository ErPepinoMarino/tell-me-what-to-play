import { prisma } from "../lib/prisma.js";

export const prismaSessionRepository = {
  async getByUserId(userId: number) {
    const session = await prisma.sessions.findUnique({
      where: {
        user_id: userId,
      },
    });

    if (!session) return undefined;

    return {
      id: session.id,
      userId: session.user_id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      revokedAt: session.revoked_at,
    };
  },

  async create(userId: number, expiresAt: Date) {
    const session = await prisma.sessions.create({
      data: {
        user_id: userId,
        expires_at: expiresAt,
      },
    });

    return {
      id: session.id,
      userId: session.user_id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      revokedAt: session.revoked_at,
    };
  },
  async revokeSession(id: number): Promise<void> {
    await prisma.sessions.update({
      where: { id },
      data: {
        revoked_at: new Date(),
      },
    });
  },

  async revokeRefreshToken(id: number): Promise<void> {
    await prisma.refresh_tokens.update({
      where: { id },
      data: {
        revoked_at: new Date(),
      },
    });
  },
  async updateExpiresAt(id: number, expiresAt: Date): Promise<void> {
    await prisma.sessions.update({
      where: { id },
      data: {
        expires_at: expiresAt,
      },
    });
  },
  async saveRefreshToken(sessionId: number, tokenHash: string): Promise<void> {
    await prisma.refresh_tokens.create({
      data: {
        session_id: sessionId,
        token_hash: tokenHash,
      },
    });
  },

  async findRefreshToken(tokenHash: string) {
    return prisma.refresh_tokens.findUnique({
      where: {
        token_hash: tokenHash,
      },
      include: {
        sessions: true,
      },
    });
  },
  async updateSession(id: number, expiresAt: Date) {
    const session = await prisma.sessions.update({
      where: {
        id,
      },
      data: {
        expires_at: expiresAt,
        revoked_at: null,
      },
    });

    return {
      id: session.id,
      userId: session.user_id,
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      revokedAt: session.revoked_at,
    };
  },
  async revokeRefreshTokens(sessionId: number): Promise<void> {
    await prisma.refresh_tokens.updateMany({
      where: {
        session_id: sessionId,
        revoked_at: null,
      },
      data: {
        revoked_at: new Date(),
      },
    });
  },
};

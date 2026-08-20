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
  //Este metodo esta mejorado para evitar race conditions. IMPORTANTE.
  async rotateRefreshToken(
    tokenHash: string,
    newTokenHash: string,
    now: Date,
    newSessionExpiresAt: Date,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Lock nos sirve como una especie de flag para evitar race conditions.
          // Si otro proceso ya tiene el lock, no podemos continuar
          // y devolvemos un status de concurrent_conflict.
          const lock = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${tokenHash})) AS locked
          `;
          if (!lock[0]?.locked) {
            return { status: "concurrent_conflict" as const };
          }

          // Si llegamos aqui es porque tenemos el lock
          // y podemos continuar con la rotacion del refresh token.
          const refreshToken = await tx.refresh_tokens.findUnique({
            where: { token_hash: tokenHash },
            include: { sessions: true },
          });

          // A partir de aquí la lógica es bastante normal.
          // Si no existe el refresh token, devolvemos un status de not_found.
          if (!refreshToken) {
            return { status: "not_found" as const };
          }

          // Si la sesión ya ha sido revocada, devolvemos un status de session_revoked.
          if (refreshToken.sessions.revoked_at) {
            await tx.refresh_tokens.updateMany({
              where: {
                session_id: refreshToken.session_id,
                revoked_at: null,
              },
              data: { revoked_at: now },
            });

            return { status: "session_revoked" as const };
          }

          // Comprobamos si el refresh token ya ha sido revocado.
          if (refreshToken.revoked_at) {
            if (refreshToken.revoked_at > now) {
              // Parece una contradiccion pero chequeamos si el refresh token ya ha sido revocado pero con una fecha futura.
              // Podria ocurrir si hay un proceso que ha revocado el refresh token y otro proceso que esta intentando rotarlo al mismo tiempo.
              return { status: "concurrent_conflict" as const };
            }
            // Si llegamos aqui es porque el refresh token ya ha sido revocado,
            // asi que devolvemos un status de token_revoked.
            await tx.sessions.update({
              where: { id: refreshToken.session_id },
              data: { revoked_at: now },
            });

            return { status: "token_revoked" as const };
          }

          //Comprobamos la expiracion:
          // SI expiró o acaba de expirar, revocamos la sesión y devolvemos un status de session_expired.
          if (refreshToken.sessions.expires_at <= now) {
            await tx.sessions.update({
              where: { id: refreshToken.session_id },
              data: { revoked_at: now },
            });

            return { status: "session_expired" as const };
          }

          // Si llegamos aqui es porque el refresh token es valido y podemos rotarlo.
          // no obstante nos guardamos "consumed"
          // para comprobar que solo se ha actualizado un registro.
          const consumed = await tx.refresh_tokens.updateMany({
            where: {
              id: refreshToken.id,
              revoked_at: null,
            },
            data: { revoked_at: now },
          });

          // Si hay varios consumidos, es porque hay un race condition
          // y teniamos varios refresh tokens en la tabla con el mismo hash.
          if (consumed.count !== 1) {
            return { status: "concurrent_conflict" as const };
          }

          // Si llegamos aqui solo hemmos consumido un refresh token y podemos crear uno nuevo.
          await tx.refresh_tokens.create({
            data: {
              session_id: refreshToken.session_id,
              token_hash: newTokenHash,
            },
          });

          // Por fin hemos rotado en token y le asignamos una nueva fecha de expiracion a la sesion
          if (
            now.getTime() >=
            refreshToken.created_at.getTime() + 60 * 60 * 1000
          ) {
            await tx.sessions.update({
              where: { id: refreshToken.session_id },
              data: { expires_at: newSessionExpiresAt },
            });
          }

          return {
            status: "rotated" as const,
            userId: refreshToken.sessions.user_id,
          };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2034"
      ) {
        return { status: "concurrent_conflict" as const };
      }

      throw error;
    }
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

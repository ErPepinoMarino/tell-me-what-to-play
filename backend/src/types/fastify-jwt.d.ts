import "@fastify/jwt";
// Extiendo la interfaz FastifyJWT para incluir los tipos de payload y user que estoy usando en mi aplicación
// Más que naada para acceder a request.user.sub en server.ts
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      iss: string;
      aud: string;
    };
    user: {
      sub: string;
      iss: string;
      aud: string;
      iat: number;
      exp: number;
    };
  }
}

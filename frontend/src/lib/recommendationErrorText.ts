/*
 * Mapeo del código de error canónico a texto de presentación.
 * Único punto de migración cuando llegue la localización ES/EN.
 */
export function describeRecommendationFailure(status: number): string {
  if (status === 502) {
    return "El intérprete no está disponible ahora mismo. Inténtalo de nuevo en un momento.";
  }
  if (status === 503) {
    return "El motor de recomendación no está configurado todavía.";
  }
  if (status === 0) {
    return "No he podido contactar con el servidor. Revisa tu conexión.";
  }
  return "Algo ha ido mal. Inténtalo de nuevo.";
}

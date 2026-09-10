/*
 * Frases del estado inicial del chat (animación de demostración).
 * Únicamente frontend: nunca se envían al backend (no pasan por send()).
 * Versión EN preparada para la fase de localización ES/EN.
 */

export const INTRO_PHRASES_ES: string[] = [
  "Quiero un juego de carreras en 2D.",
  "Me gustaría un juego de piratas con mucha acción.",
  "Quiero un juego terrorífico de zombies.",
  "Busco un RPG por turnos con historia profunda.",
  "Quiero un metroidvania muy difícil.",
  "¿Algún juego de gestión muy tranquilo tipo granja?",
  "Me van los juegos de sigilo con atmósfera tensa.",
  "Pásame un roguelike rápido con mucha acción.",
  "Busco un juego de estrategia en tiempo real de los 90.",
];

export const INTRO_PHRASES_EN: string[] = [
  "I want a 2D racing game.",
  "I'd like a pirate game with lots of action.",
  "I want a terrifying zombie game.",
  "I'm looking for a turn-based RPG with a deep story.",
  "I want a challenging but fair metroidvania.",
  "Something cozy like a farming game?",
  "I love stealth games with a tense atmosphere.",
  "Give me a roguelike to get hooked tonight.",
  "Looking for classic real-time strategy.",
];

// Idioma activo mientras no exista el mecanismo de localización.
export const introPhrases = INTRO_PHRASES_ES;

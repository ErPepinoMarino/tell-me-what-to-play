import { useEffect, useRef } from "react";
import type { TranscriptMessage } from "@/types/Conversation";
import type { ChatStatus } from "@/types/Conversation";

const FOLLOW_THRESHOLD_PX = 80;

function scrollToBottom(el: HTMLElement) {
  // En reduced-motion el salto es instantáneo.
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
}

/*
 * Auto-scroll del chat: si el usuario está siguiendo la cola, cada mensaje
 * nuevo ancla al final; si se desplazó hacia arriba a leer, NO se roba el
 * scroll. Al iniciar un turno nuevo (status → "searching", momento en el
 * que el mensaje del usuario ya está en el transcript optimista) se
 * re-ancla la cola. El ciclo de vida reset/continue del protocolo no
 * interviene: cualquier turno re-ancla igual.
 */
export function useChatAutoScroll(status: ChatStatus, transcript: TranscriptMessage[]) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const followTail = useRef(true);
  const previousStatus = useRef(status);
  const previousLength = useRef(transcript.length);

  // Detector de "siguiendo la cola": distancia al fondo bajo umbral.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      followTail.current = distance < FOLLOW_THRESHOLD_PX;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Mensaje nuevo: solo scroll si el usuario seguía la cola.
  useEffect(() => {
    if (transcript.length === previousLength.current) return;
    previousLength.current = transcript.length;
    const container = containerRef.current;
    if (container && followTail.current) scrollToBottom(container);
  }, [transcript]);

  // Turno nuevo: re-ancla aunque el usuario hubiera subido a leer.
  useEffect(() => {
    if (status === "searching" && previousStatus.current !== "searching") {
      followTail.current = true;
      const container = containerRef.current;
      if (container) scrollToBottom(container);
    }
    previousStatus.current = status;
  }, [status]);

  return containerRef;
}

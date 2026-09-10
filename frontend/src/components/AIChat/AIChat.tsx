"use client";

import type { GameSearchIntent, NoticeCode } from "@/types/Recommendation";
import type { ChatStatus, TranscriptMessage } from "@/types/Conversation";
import { intentSummaryChips } from "@/lib/reasons";
import {
  NOTICE_MESSAGES,
  relaxedFiltersMessage,
  visibleNotices,
} from "@/lib/notices";
import { useChatAutoScroll } from "@/lib/useChatAutoScroll";

// Retrocompatible: los consumidores siguen importándolos desde AIChat.
export type { ChatStatus, TranscriptMessage } from "@/types/Conversation";

type AIChatProps = {
  status: ChatStatus;
  transcript: TranscriptMessage[];
  intent: GameSearchIntent | null;
  notices: NoticeCode[];
  demoMode: boolean;
  relaxedFilters?: string[];
};

/*
 * La zona conversacional: muestra qué entendimos (resumen de la intención),
 * la explicación global redactada por el LLM a partir de los datos
 * deterministas del matcher, y los avisos de producto.
 * No recalcula nada: solo presenta.
 */
export default function AIChat({
  status,
  transcript,
  intent,
  notices,
  demoMode,
  relaxedFilters = [],
}: AIChatProps) {
  const shownNotices = visibleNotices(notices, demoMode).filter(
    (notice) => notice !== "EMPTY_INTENT"
  );
  /*
   * Con INTENT_UNCHANGED el intent mostrado es el de sesión reutilizado
   * (no algo "entendido" de este mensaje): los chips no aplican.
   */
  const summary =
    intent && !notices.includes("INTENT_UNCHANGED")
      ? intentSummaryChips(intent)
      : [];

  // Auto-scroll: sigue la cola salvo que el usuario haya subido a leer;
  // cada turno nuevo re-ancla (ver useChatAutoScroll).
  const transcriptRef = useChatAutoScroll(status, transcript);

  return (
    <section
      className={`chat${status === "searching" ? " searching" : ""}`}
      aria-live="polite"
    >
      <div className="chat-transcript" ref={transcriptRef}>
        {transcript.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user" ? "bubble-user" : "bubble-assistant"
            }
          >
            {message.text}
            {message.role === "assistant" &&
            index === transcript.length - 1 &&
            summary.length > 0 ? (
              <p className="intent-summary">
                He entendido:{" "}
                {summary.map((chip, chipIndex) => (
                  <span
                    key={chipIndex}
                    className={`intent-chip intent-chip-${chip.tone}`}
                  >
                    {chip.label}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        ))}

        {status === "searching" ? (
          <div className="bubble-assistant bubble-searching">
            Buscando resultados...
          </div>
        ) : null}

        {shownNotices.map((notice) => (
          <p key={notice} className="notice">
            {notice === "RELAXED_FILTERS"
              ? relaxedFiltersMessage(relaxedFilters)
              : NOTICE_MESSAGES[notice]}
          </p>
        ))}
      </div>
    </section>
  );
}

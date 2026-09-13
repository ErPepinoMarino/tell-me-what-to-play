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
      className={`chat relative min-h-32 ${
        status === "searching" ? "searching" : ""
      }`}
      aria-live="polite"
    >
      <div
        className="max-h-[420px] overflow-y-auto scroll-smooth pr-1"
        ref={transcriptRef}
      >
        {transcript.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "my-2 ml-auto max-w-[85%] rounded-[10px] bg-accent-purple px-4 py-3 leading-[1.45] text-white"
                : "my-2 max-w-[85%] rounded-[10px] bg-[#262626] px-4 py-3 leading-[1.45]"
            }
          >
            {message.text}
            {message.role === "assistant" &&
            index === transcript.length - 1 &&
            summary.length > 0 ? (
              <p className="mt-2 text-[0.85rem] text-[#a5b4fc]">
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
          <div className="bubble-searching my-2 max-w-[85%] rounded-[10px] bg-[#262626] px-4 py-3 leading-[1.45]">
            Buscando resultados...
          </div>
        ) : null}

        {shownNotices.map((notice) => (
          <p key={notice} className="py-1 text-[0.9rem] text-[#fbbf24]">
            {notice === "RELAXED_FILTERS"
              ? relaxedFiltersMessage(relaxedFilters)
              : NOTICE_MESSAGES[notice]}
          </p>
        ))}
      </div>
    </section>
  );
}

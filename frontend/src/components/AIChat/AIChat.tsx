"use client";

import type { GameSearchIntent, NoticeCode } from "@/types/Recommendation";
import { intentSummaryChips } from "@/lib/reasons";
import { NOTICE_MESSAGES, visibleNotices } from "@/lib/notices";

export type ChatStatus = "idle" | "searching" | "ready" | "error";

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

type AIChatProps = {
  status: ChatStatus;
  transcript: TranscriptMessage[];
  intent: GameSearchIntent | null;
  notices: NoticeCode[];
  demoMode: boolean;
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
}: AIChatProps) {
  const shownNotices = visibleNotices(notices, demoMode).filter(
    (notice) => notice !== "EMPTY_INTENT",
  );
  /*
   * Con INTENT_UNCHANGED el intent mostrado es el de sesión reutilizado
   * (no algo "entendido" de este mensaje): los chips no aplican.
   */
  const summary =
    intent && !notices.includes("INTENT_UNCHANGED")
      ? intentSummaryChips(intent)
      : [];

  return (
    <section className="chat" aria-live="polite">
      <h2>AI Chat</h2>

      {transcript.length === 0 && status === "idle" ? (
        <p className="chat-empty">
          Cuéntame qué te apetece jugar: género, ambiente, referencias...
          Yo buscaré juegos que probablemente no conozcas.
        </p>
      ) : null}

      <div className="chat-transcript">

      {transcript.map((message, index) => (
        <div
          key={index}
          className={message.role === "user" ? "bubble-user" : "bubble-assistant"}
        >
          {message.text}
          {message.role === "assistant" && index === transcript.length - 1 && summary.length > 0 ? (
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
              {NOTICE_MESSAGES[notice]}
            </p>
          ))}
        </div>
      </section>
  );
}

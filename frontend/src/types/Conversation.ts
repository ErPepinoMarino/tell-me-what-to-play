export type ChatStatus = "idle" | "searching" | "ready" | "error";

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

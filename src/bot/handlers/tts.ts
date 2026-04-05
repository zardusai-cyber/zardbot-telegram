import type { Api, RawApi } from "grammy";
import { InputFile } from "grammy";
import { isTtsConfigured, synthesizeSpeech } from "../../tts/client.js";
import { isTtsEnabled, getCurrentTtsVoice } from "../../settings/manager.js";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const MAX_TTS_TEXT_LENGTH = 4000; // Telegram voice message limit

/**
 * Sends a voice message using TTS if configured and enabled.
 * Called after the assistant text response is sent.
 *
 * @param api - Telegram API instance
 * @param chatId - Chat ID to send to
 * @param text - Text to speak
 * @returns true if TTS was attempted, false if not configured/disabled
 */
export async function sendTtsVoiceMessage(
  api: Api<RawApi>,
  chatId: number,
  text: string,
): Promise<boolean> {
  // Check if TTS is enabled at all
  if (!isTtsEnabled()) {
    return false;
  }

  // Check if TTS is configured
  if (!isTtsConfigured()) {
    return false;
  }

  // Get current voice
  const voice = getCurrentTtsVoice() || config.tts.voice || "david-attenborough-original";

  // Truncate text if too long
  const truncatedText = text.length > MAX_TTS_TEXT_LENGTH 
    ? text.slice(0, MAX_TTS_TEXT_LENGTH) + "..."
    : text;

  // Skip empty text
  if (!truncatedText.trim()) {
    return false;
  }

  logger.debug(`[TTS] Synthesizing speech for ${truncatedText.length} chars with voice ${voice}`);

  try {
    const result = await synthesizeSpeech(truncatedText, voice);

    // Send as voice message using InputFile with Buffer
    await api.sendVoice(chatId, new InputFile(result.audio, "voice.ogg"), {
      disable_notification: true,
    });

    logger.debug(`[TTS] Voice message sent: ${result.audio.length} bytes`);
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`[TTS] Failed to synthesize or send voice: ${errorMessage}`);
    
    // Notify user of TTS failure (but don't interrupt flow)
    try {
      await api.sendMessage(chatId, t("tts.synthesis_error", { error: errorMessage }), {
        disable_notification: true,
      });
    } catch {
      // Ignore send errors
    }
    
    return false;
  }
}

/**
 * Processes text response for TTS.
 * Strips markdown, code blocks, and other non-speech content.
 *
 * @param text - Original text
 * @returns Cleaned text suitable for TTS
 */
export function cleanTextForTts(text: string): string {
  // Remove code blocks
  let cleaned = text.replace(/```[\s\S]*?```/g, "");
  
  // Remove inline code
  cleaned = cleaned.replace(/`[^`]+`/g, "");
  
  // Remove markdown headers
  cleaned = cleaned.replace(/^#+\s.*$/gm, "");
  
  // Remove markdown links but keep text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  
  // Remove markdown bold/italic
  cleaned = cleaned.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1");
  
  // Remove markdown lists markers
  cleaned = cleaned.replace(/^[\s]*[-*+]\s/gm, "");
  cleaned = cleaned.replace(/^[\s]*\d+\.\s/gm, "");
  
  // Remove HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  
  // Collapse multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  
  // Collapse multiple spaces
  cleaned = cleaned.replace(/ {2,}/g, " ");
  
  return cleaned.trim();
}
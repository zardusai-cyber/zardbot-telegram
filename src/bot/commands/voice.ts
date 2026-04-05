import { CommandContext, Context } from "grammy";
import { isTtsConfigured, getAvailableVoices } from "../../tts/client.js";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { setCurrentTtsVoice, clearTtsVoice, setTtsEnabled, isTtsEnabled, getCurrentTtsVoice } from "../../settings/manager.js";

const VOICE_MENU_PAGE_SIZE = 8;

interface VoiceCallbackData {
  action: "select" | "off" | "page";
  voice?: string;
  page?: number;
}

function parseCallbackData(data: string): VoiceCallbackData | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.action === "select" && parsed.voice) {
      return { action: "select", voice: parsed.voice };
    }
    if (parsed.action === "off") {
      return { action: "off" };
    }
    if (parsed.action === "page" && typeof parsed.page === "number") {
      return { action: "page", page: parsed.page };
    }
    return null;
  } catch {
    return null;
  }
}

function buildVoiceKeyboard(voices: { id: string; name: string }[], currentPage: number, currentVoice?: string) {
  const totalPages = Math.ceil(voices.length / VOICE_MENU_PAGE_SIZE);
  const startIdx = currentPage * VOICE_MENU_PAGE_SIZE;
  const pageVoices = voices.slice(startIdx, startIdx + VOICE_MENU_PAGE_SIZE);

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  // Voice buttons
  for (const voice of pageVoices) {
    const isSelected = voice.id === currentVoice;
    const text = isSelected ? `✅ ${voice.name}` : voice.name;
    keyboard.push([{
      text,
      callback_data: JSON.stringify({ action: "select", voice: voice.id }),
    }]);
  }

  // Navigation row
  const navRow: Array<{ text: string; callback_data: string }> = [];
  
  if (currentPage > 0) {
    navRow.push({
      text: t("tts.button.prev_page"),
      callback_data: JSON.stringify({ action: "page", page: currentPage - 1 }),
    });
  }
  
  if (currentPage < totalPages - 1) {
    navRow.push({
      text: t("tts.button.next_page"),
      callback_data: JSON.stringify({ action: "page", page: currentPage + 1 }),
    });
  }

  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  // TTS Off button
  keyboard.push([{
    text: t("tts.button.off"),
    callback_data: JSON.stringify({ action: "off" }),
  }]);

  return keyboard;
}

export async function voiceCommand(ctx: CommandContext<Context>) {
  try {
    // Check if TTS is configured
    if (!isTtsConfigured()) {
      await ctx.reply(t("tts.not_configured"));
      return;
    }

    // Show loading message
    const loadingMsg = await ctx.reply(t("tts.menu_loading"));

    // Fetch available voices
    const voices = await getAvailableVoices();

    if (voices.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        t("tts.menu_empty"),
      );
      return;
    }

    const currentVoice = getCurrentTtsVoice() || config.tts.voice || voices[0]?.id;

    // Edit loading message with voice selection menu
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      t("tts.menu_current", { voice: currentVoice || "default" }),
      {
        reply_markup: {
          inline_keyboard: buildVoiceKeyboard(voices, 0, currentVoice),
        },
      },
    );
  } catch (error) {
    logger.error("[VoiceCommand] Error:", error);
    await ctx.reply(t("tts.menu_error"));
  }
}

export async function handleVoiceCallback(ctx: Context): Promise<boolean> {
  if (!ctx.callbackQuery || !ctx.callbackQuery.data) {
    return false;
  }

  const callbackData = parseCallbackData(ctx.callbackQuery.data);
  if (!callbackData) {
    await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
    return false;
  }

  try {
    if (callbackData.action === "off") {
      setTtsEnabled(false);
      clearTtsVoice();
      await ctx.answerCallbackQuery({ text: t("tts.off_success") });
      await ctx.editMessageText(t("tts.off_success"));
      return true;
    }

    if (callbackData.action === "select" && callbackData.voice) {
      setCurrentTtsVoice(callbackData.voice);
      setTtsEnabled(true);
      await ctx.answerCallbackQuery({ text: t("tts.voice_changed", { voice: callbackData.voice }) });
      
      // Update the menu to show selection
      const voices = await getAvailableVoices();
      const currentVoice = getCurrentTtsVoice();
      await ctx.editMessageText(
        t("tts.menu_current", { voice: currentVoice || "default" }),
        {
          reply_markup: {
            inline_keyboard: buildVoiceKeyboard(voices, 0, currentVoice),
          },
        },
      );
      return true;
    }

    if (callbackData.action === "page" && typeof callbackData.page === "number") {
      const voices = await getAvailableVoices();
      const currentVoice = getCurrentTtsVoice();
      await ctx.editMessageText(
        t("tts.menu_current", { voice: currentVoice || "default" }),
        {
          reply_markup: {
            inline_keyboard: buildVoiceKeyboard(voices, callbackData.page, currentVoice),
          },
        },
      );
      await ctx.answerCallbackQuery();
      return true;
    }
  } catch (error) {
    logger.error("[VoiceCallback] Error:", error);
    await ctx.answerCallbackQuery({ text: t("tts.voice_error", { error: String(error) }) });
    return true;
  }
  
  return false;
}

// Add navigation button translations
// These need to be added to en.ts if not present
export function initTtsButtons() {
  // This is just a marker - button translations are in en.ts
}
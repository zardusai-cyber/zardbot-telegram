import { Context, InlineKeyboard } from "grammy";
import { selectModel, fetchCurrentModel, getModelSelectionLists, getAllProviderIDs, getModelsForProvider } from "../../model/manager.js";
import { formatModelForDisplay } from "../../model/types.js";
import type { FavoriteModel, ModelInfo, ModelSelectionLists } from "../../model/types.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { logger } from "../../utils/logger.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getStoredAgent } from "../../agent/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import {
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "./inline-menu.js";
import { t } from "../../i18n/index.js";

function buildModelSelectionMenuText(modelLists: ModelSelectionLists): string {
  const lines = [t("model.menu.select"), t("model.menu.favorites_title")];

  if (modelLists.favorites.length === 0) {
    lines.push(t("model.menu.favorites_empty"));
  }

  lines.push(t("model.menu.recent_title"));

  if (modelLists.recent.length === 0) {
    lines.push(t("model.menu.recent_empty"));
  }

  return lines.join("\n");
}

function buildProviderSelectionMenuText(): string {
  return t("model.menu.select_provider");
}

function buildProviderModelSelectionMenuText(providerID: string): string {
  return t("model.menu.select_model_for_provider", { provider: providerID });
}

/**
 * Handle model selection callback
 * @param ctx grammY context
 * @returns true if handled, false otherwise
 */
/**
 * Build inline keyboard with all available providers
 * @returns InlineKeyboard with provider selection buttons
 */
export async function buildProviderSelectionMenu(): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  
  try {
    const providerIDs = await getAllProviderIDs();
    
    if (!providerIDs || providerIDs.length === 0) {
      logger.warn("[ModelHandler] No providers found from any source");
      return keyboard;
    }
    
    // Sort providers alphabetically
    providerIDs.sort();
    
    // Add provider buttons
    for (const providerID of providerIDs) {
      keyboard.text(providerID, `model:provider:${providerID}`).row();
    }
    
    return keyboard;
  } catch (err) {
    logger.error("[ModelHandler] Error building provider selection menu:", err);
    return keyboard;
  }
}

/**
 * Build inline keyboard with models for a specific provider
 * @param providerID Provider ID to show models for
 * @returns InlineKeyboard with model selection buttons
 */
export async function buildProviderModelSelectionMenu(providerID: string): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  
  try {
    const models = await getModelsForProvider(providerID);
    
    if (!models || models.length === 0) {
      logger.warn(`[ModelHandler] No models found for provider ${providerID}`);
      return keyboard;
    }
    
    // Sort models alphabetically
    models.sort();
    
    // Add model buttons
    for (const modelID of models) {
      keyboard.text(modelID, `model:model:${providerID}:${modelID}`).row();
    }
    
    return keyboard;
     } catch (err) {
    logger.error("[ModelHandler] Error building model selection menu for provider " + providerID + ":", err);
    return keyboard;
  }
}

export async function handleModelSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("model:")) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "model");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[ModelHandler] Received callback: ${callbackQuery.data}`);

  try {
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    const parts = callbackQuery.data.split(":");
    const secondPart = parts[1];

    // Handle "model:provider:list" - show all providers
    if (secondPart === "provider" && parts[2] === "list") {
      const keyboard = await buildProviderSelectionMenu();
      
      if (keyboard.inline_keyboard.length === 0) {
        await ctx.answerCallbackQuery({ text: t("model.menu.empty") }).catch(() => {});
        return true;
      }

      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => {});
      return true;
    }

    // Handle "model:provider:providerID" - show models for specific provider
    if (secondPart === "provider" && parts.length >= 3) {
      const providerID = parts.slice(2).join(":");
      const keyboard = await buildProviderModelSelectionMenu(providerID);
      
      if (keyboard.inline_keyboard.length === 0) {
        await ctx.answerCallbackQuery({ text: t("model.menu.empty") }).catch(() => {});
        return true;
      }

      // Add back button
      keyboard.row();
      keyboard.text(t("model.menu.back_to_providers"), "model:provider:list");

      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => {});
      return true;
    }

    // Handle "model:model:providerID:modelID" - select a specific model
    if (secondPart === "model" && parts.length >= 4) {
      const providerID = parts[2];
      const modelID = parts.slice(3).join(":"); // Handle model IDs that may contain ":"

      const modelInfo: ModelInfo = {
        providerID,
        modelID,
        variant: "default", // Reset to default when switching models
      };

      // Select model and persist
      selectModel(modelInfo);

      // Update keyboard manager state (may not be initialized if no session selected)
      keyboardManager.updateModel(modelInfo);

      // Refresh context limit for new model
      await pinnedMessageManager.refreshContextLimit();

      // Update Reply Keyboard with new model and context
      const currentAgent = getStoredAgent();
      const contextInfo =
        pinnedMessageManager.getContextInfo() ??
        (pinnedMessageManager.getContextLimit() > 0
          ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
          : null);

      if (contextInfo) {
        keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
      }

      const variantName = formatVariantForButton(modelInfo.variant || "default");
      const keyboard = createMainKeyboard(
        currentAgent,
        modelInfo,
        contextInfo ?? undefined,
        variantName,
      );
      const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

      clearActiveInlineMenu("model_selected");

      // Send confirmation message with updated keyboard
      await ctx.answerCallbackQuery({ text: t("model.changed_callback", { name: displayName }) });
      await ctx.reply(t("model.changed_message", { name: displayName }), {
        reply_markup: keyboard,
      });

      // Delete the inline menu message
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    // Handle legacy format "model:providerID:modelID"
    if (parts.length >= 3) {
      const providerID = parts[1];
      const modelID = parts.slice(2).join(":"); // Handle model IDs that may contain ":"

      const modelInfo: ModelInfo = {
        providerID,
        modelID,
        variant: "default", // Reset to default when switching models
      };

      // Select model and persist
      selectModel(modelInfo);

      // Update keyboard manager state (may not be initialized if no session selected)
      keyboardManager.updateModel(modelInfo);

      // Refresh context limit for new model
      await pinnedMessageManager.refreshContextLimit();

      // Update Reply Keyboard with new model and context
      const currentAgent = getStoredAgent();
      const contextInfo =
        pinnedMessageManager.getContextInfo() ??
        (pinnedMessageManager.getContextLimit() > 0
          ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
          : null);

      if (contextInfo) {
        keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
      }

      const variantName = formatVariantForButton(modelInfo.variant || "default");
      const keyboard = createMainKeyboard(
        currentAgent,
        modelInfo,
        contextInfo ?? undefined,
        variantName,
      );
      const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

      clearActiveInlineMenu("model_selected");

      // Send confirmation message with updated keyboard
      await ctx.answerCallbackQuery({ text: t("model.changed_callback", { name: displayName }) });
      await ctx.reply(t("model.changed_message", { name: displayName }), {
        reply_markup: keyboard,
      });

      // Delete the inline menu message
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    logger.error(`[ModelHandler] Invalid callback data format: ${callbackQuery.data}`);
    clearActiveInlineMenu("model_select_invalid_callback");
    await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
    return true;
  } catch (err) {
    clearActiveInlineMenu("model_select_error");
    logger.error("[ModelHandler] Error handling model select:", err);
    await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
    return false;
  }
}

/**
 * Build inline keyboard with favorite and recent models
 * @param currentModel Current model for highlighting
 * @returns InlineKeyboard with model selection buttons
 */
export async function buildModelSelectionMenu(
  currentModel?: ModelInfo,
  modelLists?: ModelSelectionLists,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const lists = modelLists ?? (await getModelSelectionLists());
  const favorites = lists.favorites;
  const recent = lists.recent;

  // Add "All Providers" button at the top
  keyboard.text(t("model.menu.all_providers"), "model:provider:list").row();
  
  if (favorites.length === 0 && recent.length === 0) {
    logger.warn("[ModelHandler] No model choices found in favorites/recent");
    return keyboard;
  }

  const addButton = (model: FavoriteModel, prefix: string): void => {
    const isActive =
      currentModel &&
      model.providerID === currentModel.providerID &&
      model.modelID === currentModel.modelID;

    // Inline buttons use full model ID without truncation
    const label = `${prefix} ${model.providerID}/${model.modelID}`;
    const labelWithCheck = isActive ? `✅ ${label}` : label;

    keyboard.text(labelWithCheck, `model:${model.providerID}:${model.modelID}`).row();
  };

  favorites.forEach((model) => addButton(model, "⭐"));
  recent.forEach((model) => addButton(model, "🕘"));

  return keyboard;
}

/**
 * Show model selection menu
 * @param ctx grammY context
 */
export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    const currentModel = fetchCurrentModel();
    const modelLists = await getModelSelectionLists();
    const keyboard = await buildModelSelectionMenu(currentModel, modelLists);

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("model.menu.empty"));
      return;
    }

    const text = buildModelSelectionMenuText(modelLists);

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}

/**
 * Show provider selection menu
 * @param ctx grammY context
 */
export async function showProviderSelectionMenu(ctx: Context): Promise<void> {
  try {
    const keyboard = await buildProviderSelectionMenu();

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("model.menu.empty"));
      return;
    }

    const text = buildProviderSelectionMenuText();

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing provider selection menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}

/**
 * Show model selection menu for a specific provider
 * @param ctx grammY context
 * @param providerID Provider ID to show models for
 */
export async function showProviderModelSelectionMenu(ctx: Context, providerID: string): Promise<void> {
  try {
    const keyboard = await buildProviderModelSelectionMenu(providerID);

    if (keyboard.inline_keyboard.length === 0) {
      await ctx.reply(t("model.menu.empty"));
      return;
    }

    const text = buildProviderModelSelectionMenuText(providerID);

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text,
      keyboard,
    });
  } catch (err) {
    logger.error(`[ModelHandler] Error showing model selection menu for provider ${providerID}:`, err);
    await ctx.reply(t("model.menu.error"));
  }
}

import { getCurrentModel, setCurrentModel } from "../settings/manager.js";
import { config } from "../config.js";
import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";
import type { ModelInfo, FavoriteModel, ModelSelectionLists } from "./types.js";
import path from "node:path";
import os from "node:os";

interface OpenCodeModelState {
  favorite?: Array<{ providerID?: string; modelID?: string }>;
  recent?: Array<{ providerID?: string; modelID?: string }>;
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedValidModelKeys: Set<string> | null = null;
let modelCatalogCacheExpiresAt = 0;
let modelCatalogFetchInFlight: Promise<Set<string> | null> | null = null;

// Cache for full provider/model data (API + JSONC config)
let cachedProviderModelData: Array<{ providerID: string; models: string[]; source: "api" | "config" }> | null = null;
let providerModelDataCacheExpiresAt = 0;
let providerModelDataFetchInFlight: Promise<Array<{ providerID: string; models: string[]; source: "api" | "config" }> | null> | null = null;

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function getOpenCodeConfigFilePaths(): string[] {
  const paths: string[] = [];
  
  // Standard XDG config locations
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  
  if (xdgConfigHome) {
    paths.push(path.join(xdgConfigHome, "opencode", "opencode.jsonc"));
  }
  
  if (homeDir) {
    paths.push(path.join(homeDir, ".config", "opencode", "opencode.jsonc"));
  }
  
  // Add common alternative locations
  paths.push("/root/.config/opencode/opencode.jsonc");
  
  return paths;
}

async function readJsoncConfigFiles(): Promise<Array<{ providerID: string; models: string[] }> | null> {
  try {
    const fs = await import("fs/promises");
    const configPaths = getOpenCodeConfigFilePaths();
    const providers = new Map<string, Set<string>>();
    
    for (const configPath of configPaths) {
      try {
        const content = await fs.readFile(configPath, "utf-8");
        
        // Remove JSON comments (simple implementation for JSONC)
        const cleanContent = content
          .replace(/\/\/.*$/gm, "")  // Remove single-line comments
          .replace(/\/\*[\s\S]*?\*\//g, ""); // Remove multi-line comments
        
        const configData = JSON.parse(cleanContent);
        
        if (configData?.provider && typeof configData.provider === "object") {
          for (const [providerID, providerConfig] of Object.entries(configData.provider)) {
            const typedProviderConfig = providerConfig as { models?: Record<string, unknown> };
            if (typedProviderConfig?.models && typeof typedProviderConfig.models === "object") {
              const models = Object.keys(typedProviderConfig.models);
              
              if (!providers.has(providerID)) {
                providers.set(providerID, new Set());
              }
              
              const providerModels = providers.get(providerID)!;
              models.forEach(modelID => providerModels.add(modelID));
            }
          }
        }
      } catch (err) {
        // Ignore individual file errors and continue with others
        logger.debug(`[ModelManager] Ignoring config file ${configPath}:`, err);
      }
    }
    
    if (providers.size === 0) {
      return null;
    }
    
    const result: Array<{ providerID: string; models: string[] }> = [];
    providers.forEach((models, providerID) => {
      result.push({
        providerID,
        models: Array.from(models)
      });
    });
    
    return result;
  } catch (err) {
    logger.warn("[ModelManager] Error reading JSONC config files:", err);
    return null;
  }
}

function getEnvDefaultModel(): FavoriteModel | null {
  const providerID = config.opencode.model.provider;
  const modelID = config.opencode.model.modelId;

  if (!providerID || !modelID) {
    return null;
  }

  return { providerID, modelID };
}

function dedupeModels(models: FavoriteModel[]): FavoriteModel[] {
  const unique = new Map<string, FavoriteModel>();

  for (const model of models) {
    const key = `${model.providerID}/${model.modelID}`;
    if (!unique.has(key)) {
      unique.set(key, model);
    }
  }

  return Array.from(unique.values());
}

function filterModelsByCatalog(
  models: FavoriteModel[],
  validModelKeys: Set<string> | null,
): FavoriteModel[] {
  if (!validModelKeys) {
    return models;
  }

  return models.filter((model) => validModelKeys.has(getModelKey(model.providerID, model.modelID)));
}

async function getAllProvidersAndModels(): Promise<Array<{ providerID: string; models: string[]; source: "api" | "config" }> | null> {
  // Check cache first
  if (cachedProviderModelData && Date.now() < providerModelDataCacheExpiresAt) {
    logger.debug(
      `[ModelManager] Provider/model data cache hit: providers=${cachedProviderModelData.length}, ttlMs=${providerModelDataCacheExpiresAt - Date.now()}`,
    );
    return cachedProviderModelData;
  }
  
  // If there's already a fetch in flight, wait for it
  if (providerModelDataFetchInFlight) {
    logger.debug("[ModelManager] Awaiting in-flight provider/model data refresh");
    return providerModelDataFetchInFlight;
  }
  
  providerModelDataFetchInFlight = (async () => {
    try {
      logger.debug("[ModelManager] Refreshing provider/model data from all sources");
      
      // Fetch from API
      const apiResponse = await opencodeClient.config.providers();
      let apiProviders: Array<{ providerID: string; models: string[]; source: "api" }> = [];
      
      if (!apiResponse.error && apiResponse.data) {
        apiProviders = apiResponse.data.providers.map(provider => ({
          providerID: provider.id,
          models: Object.keys(provider.models),
          source: "api" as const
        }));
        
        logger.debug(`[ModelManager] Loaded ${apiProviders.length} providers from API`);
      } else {
        logger.warn("[ModelManager] Failed to load providers from API:", apiResponse.error);
      }
      
      // Fetch from JSONC config files
      const configProviders = await readJsoncConfigFiles();
      const configProvidersWithSource = configProviders?.map(config => ({
        ...config,
        source: "config" as const
      })) || [];
      
      if (configProvidersWithSource.length > 0) {
        logger.debug(`[ModelManager] Loaded ${configProvidersWithSource.length} providers from config files`);
      }
      
      // Merge providers from both sources, API takes precedence for duplicates
      const mergedProviders = new Map<string, { providerID: string; models: string[]; source: "api" | "config" }>();
      
      // Add API providers first (they take precedence)
      apiProviders.forEach(provider => {
        mergedProviders.set(provider.providerID, provider);
      });
      
      // Add config providers (only if not already present from API)
      configProvidersWithSource.forEach(provider => {
        if (!mergedProviders.has(provider.providerID)) {
          mergedProviders.set(provider.providerID, provider);
        }
      });
      
      const result = Array.from(mergedProviders.values());
      
      // Cache the result
      cachedProviderModelData = result;
      providerModelDataCacheExpiresAt = Date.now() + MODEL_CATALOG_CACHE_TTL_MS;
      
      logger.debug(
        `[ModelManager] Provider/model data refreshed: totalProviders=${result.length}, apiProviders=${apiProviders.length}, configProviders=${configProvidersWithSource.length}`,
      );
      
      return result;
    } catch (err) {
      logger.warn("[ModelManager] Error refreshing provider/model data:", err);
      
      // Return cached data if available
      if (cachedProviderModelData) {
        logger.warn("[ModelManager] Using stale provider/model data cache after refresh exception");
        return cachedProviderModelData;
      }
      
      return null;
    } finally {
      providerModelDataFetchInFlight = null;
    }
  })();
  
  return providerModelDataFetchInFlight;
}

async function getValidModelKeys(): Promise<Set<string> | null> {
  if (cachedValidModelKeys && Date.now() < modelCatalogCacheExpiresAt) {
    logger.debug(
      `[ModelManager] Model catalog cache hit: models=${cachedValidModelKeys.size}, ttlMs=${modelCatalogCacheExpiresAt - Date.now()}`,
    );
    return cachedValidModelKeys;
  }

  if (modelCatalogFetchInFlight) {
    logger.debug("[ModelManager] Awaiting in-flight model catalog refresh");
    return modelCatalogFetchInFlight;
  }

  modelCatalogFetchInFlight = (async () => {
    try {
      logger.debug("[ModelManager] Refreshing model catalog from OpenCode API");
      const response = await opencodeClient.config.providers();

      if (response.error || !response.data) {
        logger.warn("[ModelManager] Failed to refresh model catalog:", response.error);

        if (cachedValidModelKeys) {
          logger.warn("[ModelManager] Using stale model catalog cache after refresh failure");
          return cachedValidModelKeys;
        }

        return null;
      }

      const validModelKeys = new Set<string>();

      for (const provider of response.data.providers) {
        for (const modelID of Object.keys(provider.models)) {
          validModelKeys.add(getModelKey(provider.id, modelID));
        }
      }

      cachedValidModelKeys = validModelKeys;
      modelCatalogCacheExpiresAt = Date.now() + MODEL_CATALOG_CACHE_TTL_MS;

      logger.debug(
        `[ModelManager] Model catalog refreshed: providers=${response.data.providers.length}, models=${validModelKeys.size}`,
      );

      return cachedValidModelKeys;
    } catch (err) {
      logger.warn("[ModelManager] Error refreshing model catalog:", err);

      if (cachedValidModelKeys) {
        logger.warn("[ModelManager] Using stale model catalog cache after refresh exception");
        return cachedValidModelKeys;
      }

      return null;
    } finally {
      modelCatalogFetchInFlight = null;
    }
  })();

  return modelCatalogFetchInFlight;
}

function normalizeFavoriteModels(state: OpenCodeModelState): FavoriteModel[] {
  if (!Array.isArray(state.favorite)) {
    return [];
  }

  return state.favorite
    .filter(
      (model): model is { providerID: string; modelID: string } =>
        typeof model?.providerID === "string" &&
        model.providerID.length > 0 &&
        typeof model.modelID === "string" &&
        model.modelID.length > 0,
    )
    .map((model) => ({
      providerID: model.providerID,
      modelID: model.modelID,
    }));
}

function normalizeRecentModels(state: OpenCodeModelState): FavoriteModel[] {
  if (!Array.isArray(state.recent)) {
    return [];
  }

  return state.recent
    .filter(
      (model): model is { providerID: string; modelID: string } =>
        typeof model?.providerID === "string" &&
        model.providerID.length > 0 &&
        typeof model.modelID === "string" &&
        model.modelID.length > 0,
    )
    .map((model) => ({
      providerID: model.providerID,
      modelID: model.modelID,
    }));
}

function getOpenCodeModelStatePath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;

  if (xdgStateHome && xdgStateHome.trim().length > 0) {
    return path.join(xdgStateHome, "opencode", "model.json");
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".local", "state", "opencode", "model.json");
}

/**
 * Get favorite and recent models from OpenCode local state file.
 * Config model is always treated as favorite.
 */
export async function getModelSelectionLists(): Promise<ModelSelectionLists> {
  const envDefaultModel = getEnvDefaultModel();

  try {
    const fs = await import("fs/promises");

    const stateFilePath = getOpenCodeModelStatePath();
    const content = await fs.readFile(stateFilePath, "utf-8");
    const state = JSON.parse(content) as OpenCodeModelState;

    const rawFavorites = normalizeFavoriteModels(state);
    const rawRecent = normalizeRecentModels(state);
    const shouldValidateWithCatalog = rawFavorites.length > 0 || rawRecent.length > 0;
    const validModelKeys = shouldValidateWithCatalog ? await getValidModelKeys() : null;

    const validatedFavorites = filterModelsByCatalog(rawFavorites, validModelKeys);
    const validatedRecent = filterModelsByCatalog(rawRecent, validModelKeys);

    const favorites = envDefaultModel
      ? dedupeModels([...validatedFavorites, envDefaultModel])
      : validatedFavorites;

    if (rawFavorites.length === 0 && envDefaultModel) {
      logger.info(
        `[ModelManager] No favorites in ${stateFilePath}, using config model as favorite`,
      );
    }

    if (favorites.length === 0) {
      logger.warn(`[ModelManager] No favorites in ${stateFilePath}`);
    }

    const filteredOutFavorites = rawFavorites.length - validatedFavorites.length;
    const filteredOutRecent = rawRecent.length - validatedRecent.length;

    if (filteredOutFavorites > 0 || filteredOutRecent > 0) {
      logger.info(
        `[ModelManager] Filtered unavailable models from OpenCode state: favoritesRemoved=${filteredOutFavorites}, recentRemoved=${filteredOutRecent}`,
      );
    }

    const favoriteKeys = new Set(
      favorites.map((model) => getModelKey(model.providerID, model.modelID)),
    );
    const recent = dedupeModels(validatedRecent).filter(
      (model) => !favoriteKeys.has(getModelKey(model.providerID, model.modelID)),
    );

    logger.debug(
      `[ModelManager] Loaded model selection lists from ${stateFilePath}: favorites=${favorites.length}, recent=${recent.length}`,
    );

    return { favorites, recent };
  } catch (err) {
    if (envDefaultModel) {
      logger.warn(
        "[ModelManager] Failed to load OpenCode model state, using config model as favorite:",
        err,
      );
      return {
        favorites: [envDefaultModel],
        recent: [],
      };
    }

    logger.error("[ModelManager] Failed to load OpenCode model state:", err);
    return {
      favorites: [],
      recent: [],
    };
  }
}

/**
 * Validate stored selected model against OpenCode providers catalog.
 * If selected model is unavailable, fallback to env default model.
 */
export async function reconcileStoredModelSelection(): Promise<void> {
  const currentModel = getCurrentModel();

  if (!currentModel?.providerID || !currentModel.modelID) {
    return;
  }

  const validModelKeys = await getValidModelKeys();

  if (!validModelKeys) {
    logger.warn("[ModelManager] Skipping stored model validation: model catalog unavailable");
    return;
  }

  const currentModelKey = getModelKey(currentModel.providerID, currentModel.modelID);

  if (validModelKeys.has(currentModelKey)) {
    return;
  }

  const envDefaultModel = getEnvDefaultModel();
  if (!envDefaultModel) {
    logger.warn(
      `[ModelManager] Stored model ${currentModelKey} is unavailable and env default model is missing`,
    );
    return;
  }

  const fallbackKey = getModelKey(envDefaultModel.providerID, envDefaultModel.modelID);
  logger.warn(
    `[ModelManager] Stored model ${currentModelKey} is unavailable, falling back to ${fallbackKey}`,
  );

  setCurrentModel({
    providerID: envDefaultModel.providerID,
    modelID: envDefaultModel.modelID,
    variant: "default",
  });
}

export function __resetModelCatalogCacheForTests(): void {
  cachedValidModelKeys = null;
  modelCatalogCacheExpiresAt = 0;
  modelCatalogFetchInFlight = null;
  cachedProviderModelData = null;
  providerModelDataCacheExpiresAt = 0;
  providerModelDataFetchInFlight = null;
}

/**
 * Get list of favorite models from OpenCode local state file
 * Falls back to env default model if file is unavailable or empty
 */
export async function getFavoriteModels(): Promise<FavoriteModel[]> {
  const { favorites } = await getModelSelectionLists();
  return favorites;
}

/**
 * Get all available providers and their models from both API and config files
 * @returns Array of providers with their models, or null if unavailable
 */
export async function getAllProvidersWithModels(): Promise<Array<{ 
  providerID: string; 
  models: string[]; 
  source: "api" | "config";
}> | null> {
  return getAllProvidersAndModels();
}

/**
 * Get a simplified list of all providers (just provider IDs)
 * @returns Array of provider IDs, or null if unavailable
 */
export async function getAllProviderIDs(): Promise<string[] | null> {
  const providersData = await getAllProvidersAndModels();
  if (!providersData) {
    return null;
  }
  
  return providersData.map(provider => provider.providerID);
}

/**
 * Get all models for a specific provider
 * @param providerID Provider ID to get models for
 * @returns Array of model IDs, or null if provider not found or unavailable
 */
export async function getModelsForProvider(providerID: string): Promise<string[] | null> {
  const providersData = await getAllProvidersAndModels();
  if (!providersData) {
    return null;
  }
  
  const provider = providersData.find(p => p.providerID === providerID);
  return provider?.models ?? null;
}

/**
 * Get current model from settings or fallback to config
 * @returns Current model info
 */
export function fetchCurrentModel(): ModelInfo {
  return getStoredModel();
}

/**
 * Select model and persist to settings
 * @param modelInfo Model to select
 */
export function selectModel(modelInfo: ModelInfo): void {
  logger.info(`[ModelManager] Selected model: ${modelInfo.providerID}/${modelInfo.modelID}`);
  setCurrentModel(modelInfo);
}

/**
 * Get stored model from settings (synchronous)
 * ALWAYS returns a model - fallback to config if not found
 * @returns Current model info
 */
export function getStoredModel(): ModelInfo {
  const storedModel = getCurrentModel();

  if (storedModel) {
    // Ensure variant is set (default to "default")
    if (!storedModel.variant) {
      storedModel.variant = "default";
    }
    return storedModel;
  }

  // Fallback to model from config (environment variables)
  if (config.opencode.model.provider && config.opencode.model.modelId) {
    logger.debug("[ModelManager] Using model from config");
    return {
      providerID: config.opencode.model.provider,
      modelID: config.opencode.model.modelId,
      variant: "default",
    };
  }

  // This should not happen if config is properly set
  logger.warn("[ModelManager] No model found in settings or config, returning empty model");
  return {
    providerID: "",
    modelID: "",
    variant: "default",
  };
}

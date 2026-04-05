import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, writeFileSync, readFileSync } from "node:fs";

const STT_REQUEST_TIMEOUT_MS = 60_000;

function convertToWav(audioBuffer: Buffer, filename: string): Buffer {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "wav" || ext === "wave") {
    return audioBuffer;
  }

  const inputPath = join(tmpdir(), `stt_input_${Date.now()}.${ext}`);
  const outputPath = join(tmpdir(), `stt_output_${Date.now()}.wav`);

  try {
    writeFileSync(inputPath, audioBuffer);
    execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -f wav "${outputPath}"`, {
      stdio: "pipe",
    });
    return readFileSync(outputPath);
  } finally {
    try {
      unlinkSync(inputPath);
    } catch {}
    try {
      unlinkSync(outputPath);
    } catch {}
  }
}

export interface SttResult {
  text: string;
}

/**
 * Returns true if STT is configured (API URL and API key are set).
 */
export function isSttConfigured(): boolean {
  return Boolean(config.stt.apiUrl && config.stt.apiKey);
}

/**
 * Transcribes an audio buffer using a Whisper-compatible API (OpenAI / Groq / etc.).
 *
 * Sends a multipart/form-data POST to `{STT_API_URL}/audio/transcriptions`.
 *
 * @param audioBuffer - Raw audio file bytes (ogg, mp3, wav, m4a, webm, etc.)
 * @param filename    - Original filename with extension (used by the API to detect format)
 * @returns Transcribed text
 * @throws Error if STT is not configured, the request fails, or the response is invalid
 */
export async function transcribeAudio(audioBufferInput: Buffer, filename: string): Promise<SttResult> {
  if (!isSttConfigured()) {
    throw new Error("STT is not configured: STT_API_URL and STT_API_KEY are required");
  }

  const url = `${config.stt.apiUrl}/audio/transcriptions`;

  const audioBuffer = convertToWav(audioBufferInput, filename);
  const wavFilename = filename.replace(/\.[^.]+$/, ".wav");

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(audioBuffer)]), wavFilename);
  if (config.stt.model) {
    formData.append("model", config.stt.model);
  }
  formData.append("response_format", "json");

  if (config.stt.language) {
    formData.append("language", config.stt.language);
  }

  logger.debug(
    `[STT] Sending transcription request: url=${url}, model=${config.stt.model}, filename=${filename}, size=${audioBuffer.length} bytes`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.stt.apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `STT API returned HTTP ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const data = (await response.json()) as { text?: string };

    if (typeof data.text !== "string") {
      throw new Error("STT API response does not contain a text field");
    }

    logger.debug(`[STT] Transcription result: ${data.text.length} chars`);

    return { text: data.text };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`STT request timed out after ${STT_REQUEST_TIMEOUT_MS}ms`);
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

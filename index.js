import "dotenv/config";
import { FfmpegExtractor } from "./src/misc/extractor.js";
import { DownloadUtil } from "./src/misc/downloader.js";
import { SonioxSTT } from "./src/stt/soniox-stt.js";
import { GeminiVTT } from "./src/vtt/gemini-vtt.js";
import { TranscriptCompiler } from "./src/transcript-compiler.js";
import { getLogger } from "./src/misc/logger.js";

const log = getLogger("CloudFunctions");

function createServices() {
    const base = "/tmp";
    return {
        downloadUtils: new DownloadUtil({ tmpDir: `${base}/temp-download` }),
        extractor: new FfmpegExtractor({ tmpDir: `${base}/temp-extract` }),
        stt: new SonioxSTT(),
        vtt: new GeminiVTT(),
        compiler: new TranscriptCompiler(),
    };
}

/**
 * HTTP Cloud Function
 */
export async function vidscriber(req, res) {
    try {
        const path = new URL(req.url, `http://${req.headers.host}`).pathname;
        if (path === "/health") {
            return health(req, res);
        } else if (path === "/transcribeFile") {
            return transcribeFile(req, res);
        } else {
            res.status(404).send("Not Found, Expected /transcribeFile or /health");
        }
    } catch (err) {
        log.error("Unhandled error:", err);
        res.status(500).json({ ok: false, error: err?.message || "Internal Error" });
    }
}

/**
 * Runs the whole pipeline for a single media file.
 * Body: { uri: string, context?: string }
 * Runs the full pipeline and returns each step's result.
 */
export async function transcribeFile(req, res) {
    try {
        if (req.method !== "POST") {
            res.status(405).send("Method Not Allowed");
            return;
        }

        const { uri, context } = req.query || {};
        if (!uri) {
            res.status(400).json({ error: "Field 'uri' is required" });
            return;
        }

        // Create services
        const { downloadUtils, extractor, stt, vtt, compiler } = await log.infoSpan("creating services", createServices());

        // Download
        const localPath = await log.infoSpan("downloading media", () => downloadUtils.getLocalPath(uri));

        // Extract
        const { audioPath, videoPath } = await log.infoSpan("extracting/normalizing media", () => extractor.extract(localPath));

        // STT and VTT in parallel
        const [sttResult, vttResult] = await Promise.all([
            log.infoSpan("speech transcription",
                () => stt.transcribe(audioPath, {
                    enable_language_identification: true,
                    enable_speaker_diarization: true,
                    context: { text: context || "" },
                })),

            log.infoSpan("video transcription", () => vtt.transcribe(videoPath, { context: context }))
        ]);

        // Compile
        const compiledResult = await log.infoSpan("compiling results", compiler.compile(sttResult, vttResult));


        res.status(200).json({
            ok: true,
            steps: {
                stt: sttResult,
                vtt: vttResult,
                compiler: compiledResult,
            },
            result: compiledResult,
        });
    } catch (err) {
        console.error("processTranscription error:", err);
        res.status(500).json({ ok: false, error: err?.message || "Internal Error" });
    }
}

/**
 * Health check endpoint
 */
export async function health(req, res) {
    res.status(200).json({
        status: "Running",
        message: "The service is healthy.",
        timestamp: new Date().toISOString(),
    });
}

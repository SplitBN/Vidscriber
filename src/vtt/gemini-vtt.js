import "dotenv/config";
import { GoogleGenAI } from '@google/genai';
import { Storage } from "@google-cloud/storage";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { getLogger } from "../misc/logger.js";
import { fileTypeFromStream } from "file-type";
import {
    PHASE_1_INSTRUCTIONS_GPT,
    PHASE_2_INSTRUCTIONS_GPT
} from "./vtt-instructions.js";
import vttSchema from './vtt-schema.json' with { type: 'json' };
import {Ajv} from 'ajv'

const log = getLogger("GeminiVTT");
const validateVttSchema = new Ajv().compile(vttSchema);

export class GeminiVTT {

    constructor(opts = {}) {

        this.project = process.env.GOOGLE_CLOUD_PROJECT;
        this.location = process.env.GOOGLE_CLOUD_LOCATION;
        this.bucketID = process.env.GOOGLE_CLOUD_BUCKET_ID;
        this.filePrefix = process.env.GOOGLE_CLOUD_BUCKET_FILE_PREFIX;

        // this.vertex = new VertexAI({ project: this.project, location: this.location });
        this.client = new GoogleGenAI({ project: this.project, location: this.location, vertexai: true });
        // this.model = this.vertex.getGenerativeModel({ model: "gemini-2.5-flash" });

        this.storage = new Storage({ projectId: this.project });
        this.bucket = this.storage.bucket(this.bucketID);

        this._readyPromise = (async () => {
            // Async init stuff
            const [exists] = await this.bucket.exists();
            if (!exists)
                throw new Error(`Bucket ${this.bucketID} does not exist`);
            else
                log.debug("Bucket exists");
        })();
    }

    async transcribe(videoPath, opts = {}) {
        await this._awaitReady();

        const { context } = opts;

        const { bucketFile: videoFile, mime } = await this._getBucketFile(videoPath); // File that exists and ready to use
        const gcsUri = `gs://${this.bucket.name}/${videoFile.name}`;
        log.debug(`gcsUri: ${gcsUri}`);

        let finalPhase = "phase1";

        // - Call Phase 1
        const phase1Resp = await log.infoSpan("Coarse Analysis (Phase 1)", this._callGemini({
            parts: [
                {
                    text: "VIDEO_CONTEXT: " + (context || "No context provided")
                },
                {
                    fileData: { fileUri: gcsUri, mimeType: mime },
                    videoMetadata: { fps: 2 }
                }
            ],
            instructions: PHASE_1_INSTRUCTIONS_GPT,
            resolution: "LOW"
        }));
        // -

        // Extract from phase 1 api response
        const phase1 = this._extractFromResp(phase1Resp);

        // Validate Schema
        this._validateAgainstSchema(phase1);

        // - Extract timestamps for refinement
        const timestampsToRefine = [];

        const scanNodeForAccurateProcessing = (node) => {
            if (node.accurate_processing?.needed && node.start_ms && node.end_ms) {
                timestampsToRefine.push({
                    start_ms: node.start_ms,
                    end_ms: node.end_ms,
                    reason: node.accurate_processing.reason
                });
            }
            if (node.children)
                for (let child of node.children)
                    scanNodeForAccurateProcessing(child);
        }

        for (let node of phase1.transcription?.timeline || [])
            scanNodeForAccurateProcessing(node);
        // -

        // Check if Phase 2 is needed TODO add a toggle for this
        let phase2 = {};
        if (timestampsToRefine.length > 0) {
            log.info(`Found ${timestampsToRefine.length} timestamps to refine (Total ${timestampsToRefine.reduce((sum, n) => sum + (n.end_ms - n.start_ms), 0)} ms), Calling refiner (phase 2)`);
            log.debug("Timestamps to refine: " + timestampsToRefine.map(t => `(${t.start_ms}-${t.end_ms}) [${t.reason}]`).join("  ,  "));

            // - Call Phase 2
            const parts = [];
            for (let ts of timestampsToRefine) {
                const s = `${(Number(ts.start_ms) / 1000).toFixed(1)}s`; // Convert to "10.4s" format
                const e = `${(Number(ts.end_ms) / 1000).toFixed(1)}s`;
                parts.push({
                    fileData: { fileUri: gcsUri, mimeType: mime },
                    videoMetadata: { fps: 10, startOffset: s, endOffset: e }
                });
            }

            const phase2Resp = await log.infoSpan("Refined Analysis (Phase 2)", this._callGemini({
                parts: [
                    {
                        text: "FULL_VIDEO_CONTEXT (may refer to parts you dont see in video form): " + (context || "No context provided")
                    },
                    {
                        text: "COARSE_TRANSCRIPTION: " + JSON.stringify(phase1.transcription)
                    },
                    ...parts
                ],
                instructions: PHASE_2_INSTRUCTIONS_GPT,
                resolution: "MEDIUM"
            }));

            // Extract from phase 2 api response
            phase2 = this._extractFromResp(phase2Resp);

            // Validate Schema
            this._validateAgainstSchema(phase2);
            finalPhase = "phase2";
        }
        // -
        else
            log.info("No timestamps to refine, skipping phase 2");


        return { finalPhase: finalPhase, phase1: phase1, phase2: phase2 };
    }

    async _awaitReady() {
        await this._readyPromise;
    }

    async _callGemini(opts) {
        const {
            parts,
            instructions,
            resolution
        } = opts;
        log.debug(`Calling Gemini with parts: `+JSON.stringify(parts, null, 2));

        /** @type {import('@google/genai').GenerateContentParameters} */
        const config = {
            model: "gemini-2.5-flash",
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: `OUTPUT_SCHEMA: ${JSON.stringify(vttSchema)}` // Including schema cuz responseJsonSchema sucks
                        },
                        ...parts
                    ]
                }
            ],
            config: {
                seed: 0, // Same response every time
                responseMimeType: "application/json",
                // responseJsonSchema: vttSchema, // Seems just broken for complex schemas
                systemInstruction: instructions,
                thinkingConfig: {
                    includeThoughts: true
                },
                temperature: 0,
                topK: 1,
                topP: 1, // Apparently shouldn't be changed if temperature is changed
                frequencyPenalty: -2, // None at all
                candidateCount: 1,
                mediaResolution: "MEDIA_RESOLUTION_" + resolution, // LOW = 66 tokens  |  MEDIUM = 258 tokens
                audioTimestamp: parts.length <= 1 // Not allowed if there is more than one clip
            }
        }

        // Estimate tokens
        const countResponse = await this.client.models.countTokens(config);
        const estimateTokens = countResponse.totalTokens;
        log.info("Token Estimate: "+estimateTokens)

        // if (estimateTokens > 100000) {
        //     log.info("Estimated tokens exceed 100k, Using 1M context window model");
        //     // config.model = config.model + "-long";
        // }
        // else
        //     log.info("Estimated tokens within 100k, Using standard model");

        // Call gemini
        return await this.client.models.generateContent(config)
    }

    /**
     * Gets bucket file for the given file, uploads if missing.
     * Always sets customTime metadata to now.
     */
    async _getBucketFile(videoPath) {
        const fileName = await log.debugSpan("Hashing file", () => this._uniqueFileNameForBucket(videoPath));
        log.debug(`generated fileName: ${fileName}`);

        const bucketFile = await this.bucket.file(fileName);
        const mime = await log.debugSpan("detectMime", this._detectMime(videoPath));
        log.debug(`detected mime: ${mime}`);


        const [exists] = await bucketFile.exists();
        if (! exists) {
            log.debug("File does not exist, uploading");
            await log.debugSpan("upload", new Promise((res, rej) => {
                    createReadStream(videoPath)
                        .pipe(bucketFile.createWriteStream({metadata: { contentType: mime, customTime: new Date().toISOString() }}))
                        .on("finish", res)
                        .on("error", rej);
                })
            );
        }
        else {
            log.debug("File exists, skipping upload");
            await log.debugSpan("Setting customTime to now", () => bucketFile.setMetadata({ customTime: new Date().toISOString() }));
        }

        return { bucketFile, mime };
    }

    /**
     * Generates a unique file name for the given file and attaches the bucket prefix.
     */
    async _uniqueFileNameForBucket(path) {
        const hash = await createHash("sha256");
        await new Promise((res, rej) => {
            createReadStream(path)
                .on("data", chunk => hash.update(chunk))
                .on("end", res)
                .on("error", rej);
        });
        return this.filePrefix + hash.digest("hex");
    }

    /**
     * Detects mime type;
     */
    async _detectMime(path) {
        const stream = await createReadStream(path, { start: 0, end: 8191 });
        const info = await fileTypeFromStream(stream);
        return info?.mime || "application/octet-stream";
    }

    _extractFromResp(resp) {
        log.debug(`Extracting from response: `+JSON.stringify(resp, null, 2));
        const result = {};
        for (let part of resp.candidates[0].content?.parts || []) {
            if (part.thought)
                result.thoughts = part.text;
            else if (result.schema)
                log.warn("Multiple none thought parts received from gemini, ignoring the rest");
            else
                result.transcription = JSON.parse(part.text);
        }

        result.usageMetadata = resp.usageMetadata;
        return result;
    }

    _validateAgainstSchema(o) {
        if (!validateVttSchema(o.transcription))
            throw new Error(`
            Invalid VTT schema: ${JSON.stringify(o.transcription, null, 2)}
            Schema Errors: ${JSON.stringify(validateVttSchema.errors, null, 2)}
            `);
    }
}
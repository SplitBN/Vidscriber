import "dotenv/config";
import { GoogleGenAI } from '@google/genai';
import { Storage } from "@google-cloud/storage";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { getLogger } from "../logger.js";
import { fileTypeFromStream } from "file-type";
import { PHASE_1_INSTRUCTIONS } from "./vtt-instructions.js";
import vttSchema from './vtt-schema.json' with { type: 'json' };

const log = getLogger("GeminiVTT");

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

        const { bucketFile: videoFile, mime } = await this._getBucketFile(videoPath); // File that exists and ready to use
        const gcsUri = `gs://${this.bucket.name}/${videoFile.name}`;
        log.debug(`gcsUri: ${gcsUri}`);

        // TODO this is working great, perhaps add that lib to verify the schema, then make phase two, dont forget to fix the instructions

        const phase1Resp = await log.infoSpan("Coarse Analysis",
            this._callGemini({
                parts: [
                    {
                      text: `OUTPUT_SCHEMA: ${JSON.stringify(vttSchema)}` // Including schema cuz responseJsonSchema sucks
                    },
                    {
                        fileData: { fileUri: gcsUri, mimeType: mime },
                        videoMetadata: { fps: 1 }
                    }
                ],
                instructions: PHASE_1_INSTRUCTIONS,
                resolution: "LOW"
            })
        );

        log.debug(`phase1Resp: ${JSON.stringify(phase1Resp, null, 2)}`);


        return { test: "test", version: "asd" };
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
        return await this.client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    role: "user",
                    parts: parts
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
                // topP: 1, Apparently shouldn't be changed if temperature is changed
                frequencyPenalty: -2, // None at all
                candidateCount: 1,
                mediaResolution: "MEDIA_RESOLUTION_" + resolution // LOW = 66 tokens  |  MEDIUM = 258 tokens
            }
        })
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
}
import "dotenv/config";
import {VertexAI} from "@google-cloud/vertexai";
import { Storage } from "@google-cloud/storage";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import {getLogger} from "./logger.js";
import { fileTypeFromStream } from "file-type";


const log = getLogger("GeminiVTT");

const PHASE_1_INSTRUCTIONS = `
ROLE  
You are a video transcriber.  
Your job is to describe what happens in the video — both visually and audibly — in structured JSON form.  
Do not filter. Do not prioritize.  
Just report what’s visible and audible, so a Director AI can decide what to use later.

---

PRIMARY GOAL  

Fully describe the video’s visual and audio content in two structured lists:  
1) 'events': concrete, visible actions or changes  
2) 'moments': semantically meaningful segments (scene shifts, crew interaction, instructions, etc.)

Your output should provide **complete observational coverage** — not summaries, not highlights.  
Only mark segments as 'should-cut' if they are **objectively unusable** (e.g. crew gives instructions, clear blunder, false starts).

---

RULES & INTELLIGENCE

- ✅ Include all observable actions — gestures, product handling, scene changes, speaker movement, camera motion
- ✅ Capture all speech, crew chatter, or off-screen instructions as moments (use 'Cameraman speaks' etc.)
- ✅ Include timestamps in milliseconds: 'start_ms', 'end_ms', make them as accurate as you can, never invent timestamps
- ✅ If someone is clearly speaking or reacting, include 'speaker': 'host', 'guest', etc.
- ✅ If a visual emphasizes the spoken word (e.g. pointing while naming), include that as an event
- ✅ Do **not** hallucinate or guess — only include what’s clearly supported by video/audio

❌ Do **not** assign 'importance' levels unless it's 'should-cut'  
❌ Do **not** label segments as high/medium/low — leave that to the Director AI  
❌ Do **not** suggest what should stay or go  
❌ Do **not** quote or fabricate dialogue

---

EVENTS

Each 'event' should describe something visually concrete.  
Structure:

- 'start_ms': integer
- 'end_ms': integer
- 'action': short verb phrase (e.g. 'points to whiteboard', 'walks forward')
- 'detail': optional extra (e.g. 'while holding product')
- 'peak_ms': optional peak visual emphasis
- 'speaker': optional (if known)
- 'importance': ONLY include 'should-cut' if clearly a mistake

---

MOMENTS

Each 'moment' marks a narrative or semantic segment.  
Structure:

- 'start_ms': integer
- 'end_ms': integer
- 'label': short title (e.g. 'Hook', 'Product reveal', 'Crew instruction')
- 'detail': optional description
- 'modality': 'visual' | 'audio' | 'both'
- 'speaker': optional
- 'importance': ONLY include 'should-cut' if the moment is clearly unusable

Use moments for:
- Segment labels (if obvious)
- Emotional tone shifts
- Blunders, confusion, or retakes
- Crew speech or cameraman instructions
- Off-script reactions

---

VALIDATION RULES

- Output only valid JSON — no comments, no prose
- All timestamps are integer milliseconds - aim for ~100ms precision
- Do not include empty or undefined fields
- Do not use 'importance' unless it is 'should-cut'
- Order all items chronologically by start_ms
`;
const PHASE_2_INSTRUCTIONS = ``;


export class GeminiVTT {

    constructor(opts = {}) {

        this.project = process.env.GOOGLE_CLOUD_PROJECT;
        this.location = process.env.GOOGLE_CLOUD_LOCATION;
        this.bucketID = process.env.GOOGLE_CLOUD_BUCKET_ID;
        this.filePrefix = process.env.GOOGLE_CLOUD_BUCKET_FILE_PREFIX;

        this.vertex = new VertexAI({ project: this.project, location: this.location });
        this.model = this.vertex.getGenerativeModel({ model: "gemini-2.5-flash" });

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

        // TODO wrap up schema (looks good), load with url like [https://your-domain/schemas/vtt.hierarchy.v1.json]
        // TODO make the phases

        const phase1Resp = await log.infoSpan("Coarse Analysis",
            this._callGemini({
                instructions: PHASE_1_INSTRUCTIONS,
                resolution: "LOW",
                fps: 10,
                gcsUri,
                mime
            })
        );

        log.info(`phase1Resp: ${JSON.stringify(phase1Resp, null, 2)}`);


        return { test: "test", version: "asd" };
    }

    async _awaitReady() {
        await this._readyPromise;
    }

    async _callGemini(opts) {
        const {
            instructions,
            resolution,
            fps,
            startOffset,
            endOffset,
            gcsUri,
            mime
        } = opts;
        return await this.model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            fileData: { fileUri: gcsUri, mimeType: mime },
                            videoMetadata: { fps: fps, startOffset: startOffset, endOffset: endOffset }
                        }
                    ]
                }
            ],
            systemInstruction: instructions,
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0,
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

const VTT_HIERARCHY_V1_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "vtt.hierarchy.v1.min.json",
    title: "Hierarchical",
    type: "object",
    required: ["version", "summary", "timeline"],
    additionalProperties: true,

    properties: {
        version: { const: "vtt.hierarchy.v1" },
        summary: { type: "string" },

        timeline: {
            type: "array",
            items: { $ref: "#/$defs/node" }
        }
    },

    $defs: {
        base: {
            type: "object",
            required: ["id", "kind", "label"],
            additionalProperties: true,
            properties: {
                id: { type: "string" },
                kind: { enum: ["state", "span", "moment"] },
                label: { type: "string" },
                description: { type: "string" },
                conf: { type: "number", minimum: 0, maximum: 1 },
                entityIds: { type: "array", items: { type: "string" } },
                bbox: {
                    type: "array",
                    items: { type: "number", minimum: 0, maximum: 1 },
                    minItems: 4,
                    maxItems: 4
                },
                text: { type: "string" },

                tags: { type: "array", items: { type: "string" } },
                children: {
                    type: "array",
                    items: { $ref: "#/$defs/node" }
                }
            }
        },

        state: {
            allOf: [
                { $ref: "#/$defs/base" },
                {
                    type: "object",
                    required: ["start_ms", "end_ms"],
                    properties: {
                        kind: { const: "state" },
                        start_ms: { type: "integer", minimum: 0 },
                        end_ms: { type: "integer", minimum: 1 }
                    }
                }
            ]
        },

        span: {
            allOf: [
                { $ref: "#/$defs/base" },
                {
                    type: "object",
                    required: ["start_ms", "end_ms"],
                    properties: {
                        kind: { const: "span" },
                        start_ms: { type: "integer", minimum: 0 },
                        end_ms: { type: "integer", minimum: 1 }
                    }
                }
            ]
        },

        moment: {
            allOf: [
                { $ref: "#/$defs/base" },
                {
                    type: "object",
                    required: ["t_ms"],
                    properties: {
                        kind: { const: "moment" },
                        t_ms: { type: "integer", minimum: 0 }
                    }
                }
            ]
        },

        node: {
            oneOf: [
                { $ref: "#/$defs/state" },
                { $ref: "#/$defs/span" },
                { $ref: "#/$defs/moment" }
            ]
        }
    }
};

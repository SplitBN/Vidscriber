import "dotenv/config";
import fs from "node:fs";
import axios from "axios";
import FormData from "form-data";
import { getLogger } from "../misc/logger.js";

const log = getLogger("SonioxSTT");
const API  = "https://api.soniox.com/v1";

export class SonioxSTT {

    constructor(opts = {}) {
        this.apiKey = opts.apiKey || process.env.SONIOX_API_KEY;
        this.model = opts.model || "stt-async-v3";

        if (!this.apiKey) throw new Error("Missing SONIOX_API_KEY");
    }

    async transcribe(audioPath, opts = {}) {

        try {
            const sz = fs.statSync(audioPath).size;
            log.debug(`audio file size: ${sz} bytes`);
        } catch {}

        const fileId = await log.infoSpan("soniox: upload file", () => this._uploadFile(audioPath));

        const config = {
            ...opts,
            model: this.model,
            file_id: fileId,
        };

        return await log.infoSpan("transcribing", async () => {
            const id = await log.debugSpan("soniox: create transcription", () =>
                this._createTranscription(config)
            );

            await log.debugSpan("soniox: wait until done", () =>
                this._waitUntilDone(id)
            );

            const resp = await log.debugSpan("soniox: get transcript", () =>
                this._getTranscript(id)
            );

            log.debug(`soniox api response: ${JSON.stringify(resp)}`);

            await log.debugSpan("soniox: delete uploaded file", () =>
                this._deleteFile(fileId)
            );

            return await log.debugSpan("soniox: process response", () =>
                this._processResponse(resp)
            );
        });

    }

    async _uploadFile(filePath) {
        const form = new FormData();
        form.append("file", fs.createReadStream(filePath));
        const { data } = await axios.post(`${API}/files`, form, {
            headers: { Authorization: `Bearer ${this.apiKey}`, ...form.getHeaders() },
        });
        return data.id;
    }

    async _createTranscription(config) {
        const { data } = await axios.post(
            `${API}/transcriptions`,
            config,
            { headers: { Authorization: `Bearer ${this.apiKey}` } }
        );
        return data.id;
    }

    async _waitUntilDone(id, intervalMs = 2000) {
        for (;;) {
            const { data } = await axios.get(`${API}/transcriptions/${id}`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });
            if (data.status === "completed") return;
            if (data.status === "error") throw new Error(data.error_message || "Failed");
            await new Promise(r => setTimeout(r, intervalMs));
        }
    }

    async _getTranscript(id) {
        const { data } = await axios.get(`${API}/transcriptions/${id}/transcript`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        return data;
    }

    async _deleteFile(fileId) {
        const { data } = await axios.delete(`${API}/files/${fileId}`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        return data;
    }

    // Combines tokens into words by checking for spaces at the beginning of end of words
    async _processResponse(resp) {
        // log.debug(`resp: ${JSON.stringify(resp, null, 2)}`);

        const formatted = {};
        formatted.apiInfo = resp.id;
        formatted.text = resp.text;
        formatted.words = [];

        // Combine tokens
        if (!resp.tokens)
            return formatted;

        const memPerSpeaker = new Map();
        const getSpeakerMem = (speaker) => {
            if (!memPerSpeaker[speaker]) {
                memPerSpeaker[speaker] = {
                    word: "",
                    wordStart: -1,
                    lastTokenEnd: -1,
                    speaker: speaker,
                    language: ""
                };
            }
            return memPerSpeaker[speaker];
        };

        resp.tokens.forEach(token => {
            // Skip non speech
            if (token.is_audio_event === true || !token.text)
                return;

            let text = token.text;
            const speaker = token.speaker;
            const mem = getSpeakerMem(speaker);

            // Check if this is the first token in a word
            if (mem.wordStart === -1) {
                mem.wordStart = token.start_ms;
                mem.language = token.language;
            }

            // This means this token is the beginning of a word
            if (text.startsWith(" ")) {
                if (mem.word && mem.word.length > 0 && mem.lastTokenEnd !== -1)
                    formatted.words.push({
                        text: mem.word,
                        start_ms: mem.wordStart,
                        end_ms: mem.lastTokenEnd,
                        speaker: speaker,
                        language: mem.language
                    });
                text = text.slice(1);
                mem.word = "";
                mem.wordStart = token.start_ms;
            }

            // This means this token is the end of a word
            if (text.endsWith(" ")) {
                formatted.words.push({
                    text: mem.word + text.slice(0, -1),
                    start_ms: mem.wordStart,
                    end_ms: token.end_ms,
                    speaker: speaker,
                    language: mem.language
                });
                mem.word = "";
                mem.wordStart = -1;
                text = "";
            }

            mem.word += text;
            mem.lastTokenEnd = token.end_ms;
        });

        for (const mem of Object.values(memPerSpeaker)) {
            if (mem.wordStart !== -1 && mem.word.length > 0 && mem.lastTokenEnd !== -1)
                formatted.words.push({
                    text: mem.word,
                    start_ms: mem.wordStart,
                    end_ms: mem.lastTokenEnd,
                    speaker: mem.speaker,
                    language: mem.language
                });
        }

        formatted.words.sort((a, b) => a.start_ms - b.start_ms);

        // TODO should change this into segments with words being in each segment's metadata

        return formatted;
    }

}

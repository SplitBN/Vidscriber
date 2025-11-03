import "dotenv/config";
import fs from "node:fs";
import axios from "axios";
import FormData from "form-data";

const API  = "https://api.soniox.com/v1";

export class SonioxSTTTranscriber {

    constructor(opts = {}) {
        this.apiKey = opts.apiKey || process.env.SONIOX_API_KEY;
        this.model = opts.model || "stt-async-v3";

        if (!this.apiKey) throw new Error("Missing SONIOX_API_KEY");
    }

    async transcribe(audioPath, opts = {}) {
        const fileId = await this._uploadFile(audioPath);

        const config = {
            ...opts,
            model: this.model,
            file_id: fileId,
        };

        const id = await this._createTranscription(config);
        await this._waitUntilDone(id);
        const resp = await this._getTranscript(id);
        await this._deleteFile(fileId);

        JSON.stringify(resp, null, 2);
        return resp;
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

}

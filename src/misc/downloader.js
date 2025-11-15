import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {getLogger} from "./logger.js";

const log = getLogger("Downloader");

/**
 * Utility for accessing files from URIs
 */
export class DownloadUtil {
    constructor(opts = {}) {
        this.temp = opts.tmpDir || os.tmpdir();
    }

    isHttp(s) {
        return /^https?:\/\//i.test(String(s || ""));
    }

    extFromUrl(u) {
        try {
            const p = new URL(u).pathname;
            const ext = path.extname(decodeURIComponent(p));
            return ext || ".bin";
        } catch {
            return ".bin";
        }
    }

    tempPathFor(url) {
        const id = crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 12);
        return path.join(this.temp, `dl-${id}${this.extFromUrl(url)}`);
    }

    async downloadToTemp(url) {
        const outPath = this.tempPathFor(url);
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);

        await fsp.mkdir(path.dirname(outPath), { recursive: true });

        if (res.body) {
            const ws = fs.createWriteStream(outPath);
            await pipeline(Readable.fromWeb(res.body), ws);
        } else {
            throw new Error("No response body for url " + url + " - cannot download");
        }

        log.debug(`Downloaded ${url} to ${outPath}`);

        return outPath;
    }

    async getLocalPath(pathOrUrl) {
        if (!this.isHttp(pathOrUrl))
            return path.resolve(pathOrUrl);
        return this.downloadToTemp(pathOrUrl);
    }
}

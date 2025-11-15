import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";

const ensureDir = async p => fsp.mkdir(p, { recursive: true });
const readJson  = async p => JSON.parse(await fsp.readFile(p, "utf8"));
const writeJsonAtomic = async (p, obj) => {
    const dir = dirname(p);
    await ensureDir(dir);
    const tmp = join(dir, `.${basename(p)}.${process.pid}.${Date.now()}.tmp`);
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2));
    await fsp.rename(tmp, p); // atomic on same volume
};

export class Pipeline {
    constructor(cacheRoot = "./.cache", recomputeFrom = "", definedSteps = []) {
        this.cacheRoot = resolve(cacheRoot);
        this.recomputeFrom = recomputeFrom || "";
        this.definedSteps = definedSteps;
        this.timings = {};
        this._stepStats = [];     // [{ id, ms, mode }]
        this._startedAt = null;
        this._endedAt = null;
    }

    async init() {
        await ensureDir(this.cacheRoot);
        this._startedAt = performance.now();
    }

    _path(stepId) { return join(this.cacheRoot, `${stepId}.json`); }

    _shouldCompute(stepId, outPath) {
        const exists = fs.existsSync(outPath);
        if (!this.recomputeFrom) return !exists;
        const fromIdx = this.definedSteps.indexOf(this.recomputeFrom);
        const stepIdx = this.definedSteps.indexOf(stepId);
        if (fromIdx === -1 || stepIdx === -1) return !exists;
        return stepIdx >= fromIdx || !exists;
    }

    async call(stepId, supplier, preview) {
        const outPath = this._path(stepId);
        const doCompute = this._shouldCompute(stepId, outPath);

        console.log(`\x1b[1m\x1b[36m→ Running ${stepId}...\x1b[0m`);
        const t0 = performance.now();

        let data;
        if (doCompute) {
            data = await supplier();               // run your step
            await writeJsonAtomic(outPath, data);  // write cache immediately (atomic)
        } else {
            data = await readJson(outPath);
        }

        if (preview) { try { preview(data); } catch {} }
        const ms = performance.now() - t0;
        this.timings[stepId] = ms;
        this._stepStats.push({ id: stepId, ms, mode: doCompute ? "compute" : "cache" });
        this._endedAt = performance.now();
        console.log(`\x1b[1m\x1b[32m✓ Finished running ${stepId} in ${ms.toFixed(1)} ms\x1b[0m`);
        return data;
    }

    summary() {
        const total = Object.values(this.timings).reduce((a,b)=>a+b, 0);
        const wall  = this._endedAt && this._startedAt ? (this._endedAt - this._startedAt) : total;
        console.log("\n=== Pipeline Summary ===");
        for (const s of this._stepStats) {
            console.log(`  ${s.id.padEnd(10)} ${s.ms.toFixed(1)} ms  (${s.mode})`);
        }
        console.log(`  total(ms)  ${total.toFixed(1)} ms`);
        console.log(`  wall(ms)   ${wall.toFixed(1)} ms`);
    }
}

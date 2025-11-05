// logger.js
import winston from "winston";

export const nowNs = () => process.hrtime.bigint();
export const nsToMs = (ns) => Number(ns) / 1e6;

const fmtSystem = (s) => (s ? `(\x1b[90m\x1b[4m${s}\x1b[0m) ` : "");

const LEVEL_COLORS = {
    ERROR: "\x1b[31m",
    WARN:  "\x1b[33m",
    INFO:  "\x1b[32m",
    DEBUG: "\x1b[34m",
};

const RAW_LEVEL = Symbol.for("level");

function formatLine(info) {
    const raw = info[RAW_LEVEL] || info.level || "info";
    const label = String(raw).toUpperCase();
    const color = LEVEL_COLORS[label] || "";
    const sys = info.system ?? "";
    const msg = typeof info.message === "string" ? info.message : "";
    return `${color}${label}\x1b[0m: ${fmtSystem(sys)}\x1b[37m${msg}\x1b[0m`;
}

const root = winston.createLogger({
    level: "debug",
    format: winston.format.printf(formatLine),
    transports: [new winston.transports.Console({ stderrLevels: ["error"] })]
});

export function setLogLevel(level) {
    root.level = level;
}

export function getLogger(system) {
    const log = root.child(system ? { system } : {});
    const span = async (label, fn, level = "debug") => {
        const t0 = nowNs();
        log.log(level, `${label} start`);
        try {
            const out = typeof fn === "function" ? await fn() : await fn;
            const ms = nsToMs(nowNs() - t0).toFixed(1);
            log.log(level, `${label} done in ${ms}ms`);
            return out;
        } catch (err) {
            const ms = nsToMs(nowNs() - t0).toFixed(1);
            log.error(`${label} ${ms}ms fail: ${err?.message || err}`);
            throw err;
        }
    };
    log.debugSpan = (l, f) => span(l, f, "debug");
    log.infoSpan = (l, f) => span(l, f, "info");
    log.span = span;
    return log;
}

import {FfmpegExtractor} from "./extractor.js";
import {DownloadUtil} from "./downloader.js";
import {Pipeline} from "./pipeline.js";
import {SonioxSTT} from "./soniox-stt.js";
import {GeminiVTT} from "./vtt/gemini-vtt.js";

// https://files.catbox.moe/r1ijks.mp4 bahaa bicep
// https://files.catbox.moe/dxh2op.mp4 zest
// https://files.catbox.moe/ops2f9.mp4 Random buff dude 1
// https://files.catbox.moe/8zdpox.mp4 trimmed buff dude
// D:\VideoMagics\long-zonot.mp4 long buff dude
// https://storage.googleapis.com/test-uploads-1/DealCameraMan.mp4 Good deal

// == Input ==
// const uri = "D:\\VideoMagics\\raw\\Weight-1.mp4";
const uri = "https://storage.googleapis.com/test-uploads-1/DealCameraMan.mp4";
const context = ""

// == Pipeline ==
const RECOMPUTE_FROM = "vtt";
const STEP_ORDER = ["download", "extract", "stt", "vtt"];
const pipe = new Pipeline("./.cache", RECOMPUTE_FROM, STEP_ORDER);
await pipe.init();

// == Services ==
const downloadUtils = new DownloadUtil({ tmpDir: "./temp-download" });
const extractor = new FfmpegExtractor({ tmpDir: "./temp-extract" });
const stt = new SonioxSTT();
const vtt = new GeminiVTT();

// == Steps ==
const localPath = await pipe.call("download", async () =>
    await downloadUtils.getLocalPath(uri));

const { audioPath, videoPath } = await pipe.call("extract", async () =>
    await extractor.extract(localPath));

// const speech = await pipe.call("stt", async () =>
//     await stt.transcribe(audioPath, {
//     enable_language_identification: true,
//     enable_speaker_diarization: true,
//     context: {text: context}
// }));

const vttResp = await pipe.call("vtt", async () =>
    await vtt.transcribe(videoPath, {}));

pipe.summary();


import {FfmpegExtractor} from "./extractor.js";
import {DownloadUtil} from "./download-utils.js";
import {Pipeline} from "./pipeline.js";
import {SonioxSTTTranscriber} from "./soniox-transcriber.js";


// https://files.catbox.moe/r1ijks.mp4 bahaa bicep
// https://files.catbox.moe/dxh2op.mp4 zest
// https://files.catbox.moe/ops2f9.mp4 Random buff dude 1
// https://files.catbox.moe/3ck3s5.mov Hookah
// https://storage.googleapis.com/test-uploads-1/DealCameraMan.mp4 Good deal

// == Input ==
const uri = "https://storage.googleapis.com/test-uploads-1/DealCameraMan.mp4";
const context = "A video in hebrew about how to close a good deal"



// == Pipeline ==
const RECOMPUTE_FROM = "stt";
const STEP_ORDER = ["download", "extract", "stt"];
const pipe = new Pipeline("./.cache", RECOMPUTE_FROM, STEP_ORDER);
await pipe.init();

// == Services ==
const downloadUtils = new DownloadUtil({ tmpDir: "./temp-download" })
const extractor = new FfmpegExtractor({ tmpDir: "./temp-extract" });
const stt = new SonioxSTTTranscriber();

// == Steps ==
const localPath = await pipe.call("download", async () => await downloadUtils.getLocalPath(uri));

const { audioPath, videoPath } = await pipe.call("extract", async () => await extractor.extract(localPath));

const speech = await pipe.call("stt", async () => await stt.transcribe(audioPath, {
    enable_language_identification: true,
    enable_speaker_diarization: true,
    context: {text: context}
}));

pipe.summary();


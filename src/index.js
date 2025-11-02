import {FfmpegExtractor} from "./extractor.js";
import {DownloadUtil} from "./download-utils.js";


// https://files.catbox.moe/r1ijks.mp4 bahaa bicep
// https://files.catbox.moe/dxh2op.mp4 zest
// https://files.catbox.moe/ops2f9.mp4 Random buff dude 1
// https://files.catbox.moe/3ck3s5.mov Hookah
// https://storage.googleapis.com/test-uploads-1/DealCameraMan.mp4 Good deal

const uri = "https://storage.googleapis.com/test-uploads-1/DealCameraMan.mp4";

const downloadUtils = new DownloadUtil({ tmpDir: "./temp-download" })
const extractor = new FfmpegExtractor({ tmpDir: "./temp-extract" });

// Download video
console.time("Download")
const localPath = await downloadUtils.getLocalPath(uri);
console.timeEnd("Download")

// Extract and normalize audio and video for transcription
console.time("Extraction")
const extracted = await extractor.extract(localPath);
console.timeEnd("Extraction")

console.log(JSON.stringify(extracted, null, 2))



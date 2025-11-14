import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import os from "os";
import fs from "fs";
import { getLogger } from "./logger.js";

const log = getLogger("Extractor");

/**
 * Extracts and normalizes audio and video from a URI using ffmpeg
 */
export class FfmpegExtractor {

    constructor(opts = {}) {

        this.tmpDir = opts.tmpDir || os.tmpdir();

        try {
            fs.mkdirSync(this.tmpDir, { recursive: true });
        } catch {}

        ffmpeg.setFfmpegPath(ffmpegPath);
    }
    
    
    async extract(inputUrl) {
        const audioPath = `${this.tmpDir}/audio.flac`;
        const videoPath = `${this.tmpDir}/video.mp4`;
        
        await log.infoSpan("extracting audio and video", async () => {
            await Promise.all([
                log.infoSpan("ffmpeg: extract audio", new Promise((resolve, reject) => {
                    ffmpeg(inputUrl)
                        .noVideo()
                        .audioCodec('flac') // Flac is lossless and compressed
                        .audioChannels(1) // Mono
                        .audioFrequency(24000) // Or 16000
                        .on("error", reject)
                        .on("end", resolve)
                        .save(audioPath);
                })),

                log.infoSpan("ffmpeg: extract video", new Promise((resolve, reject) => {
                    ffmpeg(inputUrl)
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .format('mp4')
                        .fps(30)
                        .size('720x?')
                        .outputOptions([
                            '-crf 23',                       // Constant Rate Factor: Standard quality/size balance
                            '-preset fast',                  // Encoding speed: Fast local processing
                            '-g 30',                         // Keyframe interval: Helps AI analysis
                            '-movflags +faststart',          // Optimize for web streaming/quick analysis
                            '-vsync cfr'                     // Force Constant Frame Rate
                        ])
                        .on("error", reject)
                        .on("end", resolve)
                        .save(videoPath);
                }))
            ]);
        });

        try {
            const aSize = fs.statSync(audioPath).size;
            const vSize = fs.statSync(videoPath).size;
            log.debug(`extracted audio size: ${aSize} bytes`);
            log.debug(`extracted video size: ${vSize} bytes`);
        } catch {}

        return { audioPath, videoPath };
    }
}

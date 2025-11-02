import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import os from "os";
import fs from "fs";

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
        const proxyPath = `${this.tmpDir}/proxy.mp4`;

        await Promise.all([
            new Promise((resolve, reject) => {
                ffmpeg(inputUrl)
                    .noVideo()
                    .audioCodec('flac') // Flac is lossless and compressed
                    .audioChannels(1) // Mono
                    .audioFrequency(24000) // Or 16000
                    .on("error", reject)
                    .on("end", resolve)
                    .save(audioPath);
            }),

            new Promise((resolve, reject) => {
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
                    .save(proxyPath);
            })
        ]);

        return { audioPath, proxyPath };
    }
}

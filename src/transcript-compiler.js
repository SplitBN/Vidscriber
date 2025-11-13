
/**
 * **Temporarily made by GPT**
 * Produces two timelines for speech and for video, linking the two together.
 */
export class TranscriptCompiler {
    constructor() {}

    compile(stt, vtt, opts = {}) {
        const transcription =
            vtt &&
            vtt.finalPhase &&
            vtt[vtt.finalPhase] &&
            vtt[vtt.finalPhase].transcription
                ? vtt[vtt.finalPhase].transcription
                : null;

        const speechTimelineRaw = this._buildSpeechTimeline(stt, {
            gapThresholdMs: typeof opts.gapThresholdMs === "number" ? opts.gapThresholdMs : 500,
            minWordsPerSegment: typeof opts.minWordsPerSegment === "number" ? opts.minWordsPerSegment : 2,
            minDurationMs: typeof opts.minDurationMs === "number" ? opts.minDurationMs : 800,
            maxDurationMs: typeof opts.maxDurationMs === "number" ? opts.maxDurationMs : 5000,
            maxWordsPerSegment: typeof opts.maxWordsPerSegment === "number" ? opts.maxWordsPerSegment : 10
        });

        const videoTimelineRaw = this._buildVideoTimeline(transcription);

        this._linkSpeechAndVideo(speechTimelineRaw, videoTimelineRaw);

        const speechTimeline = this._compactSpeechTimeline(speechTimelineRaw, videoTimelineRaw);
        const videoTimeline = this._compactVideoTimeline(videoTimelineRaw);

        return {
            version: "vidscriber.v1",
            summary: transcription && transcription.summary ? transcription.summary : null,
            speech_timeline: speechTimeline,
            video_timeline: videoTimeline
        };
    }

    _buildSpeechTimeline(stt, cfg) {
        const words = Array.isArray(stt && stt.words) ? [...stt.words] : [];
        words.sort((a, b) => (a.start_ms || 0) - (b.start_ms || 0));

        const segments = [];
        if (words.length === 0) return segments;

        let current = null;
        let currentWords = [];

        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            const start = typeof w.start_ms === "number" ? w.start_ms : 0;
            const end = typeof w.end_ms === "number" ? w.end_ms : start;
            const speaker = w.speaker || null;
            const language = w.language || null;
            const text = w.text || "";

            if (!current) {
                current = {
                    id: "utt_0",
                    start_ms: start,
                    end_ms: end,
                    speaker,
                    language
                };
                currentWords = [];
            } else {
                const prev = currentWords[currentWords.length - 1];
                const prevEnd = prev ? (typeof prev.end_ms === "number" ? prev.end_ms : prev.start_ms) : current.start_ms;
                const gap = start - prevEnd;
                const speakerChange = current.speaker !== speaker;
                const languageChange = current.language !== language;
                const prevText = prev ? prev.text || "" : "";
                const punctuationBreak = /[.?!…?!]$/.test(prevText);

                const currentDuration = current.end_ms - current.start_ms;
                const currentWordCount = currentWords.length;

                let shouldSplit = false;

                if (gap > cfg.gapThresholdMs) shouldSplit = true;
                if (speakerChange || languageChange) shouldSplit = true;
                if (
                    punctuationBreak &&
                    (currentWordCount >= cfg.minWordsPerSegment || currentDuration >= cfg.minDurationMs)
                ) {
                    shouldSplit = true;
                }
                if (currentDuration >= cfg.maxDurationMs) shouldSplit = true;
                if (currentWordCount >= cfg.maxWordsPerSegment) shouldSplit = true;

                if (shouldSplit) {
                    segments.push(this._finalizeSpeechSegment(current, currentWords));
                    const idx = segments.length;
                    current = {
                        id: `utt_${idx}`,
                        start_ms: start,
                        end_ms: end,
                        speaker,
                        language
                    };
                    currentWords = [];
                } else {
                    if (end > current.end_ms) current.end_ms = end;
                }
            }

            currentWords.push({
                text,
                start_ms: start,
                end_ms: end
            });
        }

        if (current) {
            segments.push(this._finalizeSpeechSegment(current, currentWords));
        }

        return segments;
    }

    _finalizeSpeechSegment(meta, words) {
        const text = words.map(w => w.text).join(" ").trim();

        return {
            id: meta.id,
            start_ms: meta.start_ms,
            end_ms: meta.end_ms,
            speaker: meta.speaker,
            language: meta.language,
            text,
            words,
            video_nodes: []
        };
    }

    _buildVideoTimeline(transcription) {
        if (!transcription || !Array.isArray(transcription.timeline)) return [];

        const timeline = [];
        let stateCount = 0;

        for (let i = 0; i < transcription.timeline.length; i++) {
            const state = transcription.timeline[i];
            const stateId = `state_${stateCount++}`;

            const stateNode = {
                id: stateId,
                kind: state.kind || "state",
                label: state.label || null,
                tags: Array.isArray(state.tags) ? state.tags.slice() : [],
                start_ms: typeof state.start_ms === "number" ? state.start_ms : 0,
                end_ms: typeof state.end_ms === "number" ? state.end_ms : 0,
                children: []
            };

            if (Array.isArray(state.children)) {
                for (let j = 0; j < state.children.length; j++) {
                    const span = state.children[j];
                    const spanId = `${stateId}.span_${j}`;

                    const spanNode = {
                        id: spanId,
                        kind: span.kind || "span",
                        label: span.label || null,
                        tags: Array.isArray(span.tags) ? span.tags.slice() : [],
                        start_ms: typeof span.start_ms === "number" ? span.start_ms : 0,
                        end_ms: typeof span.end_ms === "number" ? span.end_ms : 0,
                        children: []
                    };

                    stateNode.children.push(spanNode);
                }
            }

            timeline.push(stateNode);
        }

        return timeline;
    }

    _linkSpeechAndVideo(speechTimeline, videoTimeline) {
        const visitNode = (node, cb) => {
            cb(node);
            if (Array.isArray(node.children)) {
                for (let i = 0; i < node.children.length; i++) {
                    visitNode(node.children[i], cb);
                }
            }
        };

        for (let i = 0; i < speechTimeline.length; i++) {
            const seg = speechTimeline[i];
            const segStart = seg.start_ms;
            const segEnd = seg.end_ms;

            for (let t = 0; t < videoTimeline.length; t++) {
                visitNode(videoTimeline[t], node => {
                    const nodeStart = node.start_ms;
                    const nodeEnd = node.end_ms;

                    const localStart = Math.max(segStart, nodeStart);
                    const localEnd = Math.min(segEnd, nodeEnd);

                    if (localEnd > localStart) {
                        seg.video_nodes.push({
                            node_id: node.id,
                            local_start_ms: localStart,
                            local_end_ms: localEnd
                        });
                    }
                });
            }
        }
    }

    _compactSpeechTimeline(segments, videoTimeline) {
        const nodeMap = {};
        const visitNode = node => {
            nodeMap[node.id] = node;
            if (Array.isArray(node.children)) {
                for (let i = 0; i < node.children.length; i++) {
                    visitNode(node.children[i]);
                }
            }
        };
        for (let i = 0; i < videoTimeline.length; i++) {
            visitNode(videoTimeline[i]);
        }

        return segments.map(seg => {
            const videoNodes = seg.video_nodes.map(vn => {
                const node = nodeMap[vn.node_id];
                const label = node && node.label ? ` (${node.label})` : "";
                return `${vn.node_id}${label} ${this._timeRangeString(vn.local_start_ms, vn.local_end_ms)}`;
            });

            const words = seg.words.map(w =>
                `${this._timeRangeString(w.start_ms, w.end_ms)} ${w.text}`
            );

            return {
                id: seg.id,
                time: this._timeRangeString(seg.start_ms, seg.end_ms),
                speaker: seg.speaker,
                language: seg.language,
                text: seg.text,
                video_nodes: videoNodes,
                words
            };
        });
    }

    _compactVideoTimeline(nodes) {
        const compactNode = node => {
            return {
                id: node.id,
                kind: node.kind,
                time: this._timeRangeString(node.start_ms, node.end_ms),
                label: node.label,
                tags: node.tags,
                children: (node.children || []).map(compactNode)
            };
        };

        return nodes.map(compactNode);
    }

    _msToSec(ms) {
        return (ms / 1000).toFixed(3);
    }

    _timeRangeString(startMs, endMs) {
        return `[${this._msToSec(startMs)}->${this._msToSec(endMs)}]`;
    }
}

# Purpose
Produces an LLM friendly JSON/Toon transcription of a video for editing tasks.

# Plan (steps)
1) Normalze video and audio quality
2) Use ASR model to transcribe and diarize speech (and maybe other sound events)
3) User a Video Understanding model to transcribe events and visuals.
4) Combine outputs into a single timeline
5) Translate JSON timeline into Toon format

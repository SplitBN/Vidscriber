# Purpose
Produces an LLM friendly JSON/~~Toon~~ transcription of a video for editing tasks.

# Plan (steps)
1) Normalze video and audio quality
2) Use ASR model to transcribe and diarize speech (and maybe other sound events).
3) User a Video Understanding model to transcribe events and visuals.
4) Combine outputs into a single timeline.
5) ~~Translate JSON timeline into Toon format.~~ (Not doing since the transcription structure is too complex for Toon to be beneficial)
6) Define index.js functions for google cloud functions.


# How To Run:
* Set up .env following [.env.example](https://github.com/SplitBN/Vidscriber/blob/master/.env.example).
* You can run the tool in your IDE using the [index.js](https://github.com/SplitBN/Vidscriber/blob/master/src/index.js) file:
  * Assign a video link or a file path to the `uri` field.
  * Describe the video's context in the `context` field (Optional, to make transcription more accurate).
  * Insure the `RECOMPUTE_FROM` field is set to `"download"` for new files.
  * Run the file.
  * You can see the output of each step in the ./cache folder.

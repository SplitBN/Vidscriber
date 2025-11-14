Please grant a star if you found this repo helpful :)

# Purpose
Produces an LLM friendly JSON/~~Toon~~ transcription of a video for editing tasks.

# About the Project
This tool focuses on creating structured, machine-readable transcriptions of video content for editing workflows. It combines audio transcription and video-to-text analysis using tools such as **Soniox** for speech recognition and a **two-phase Gemini Video-to-Text (VTT) transcription** system for video analysis.

### Audio Transcription
The **Soniox ASR tool** is used to process speech, generating both diarized speaker transcriptions and timestamps.

### Video Transcription (Two-Phase Gemini VTT)
**Gemini VTT** splits video analysis to a **two-phase process**:
- **Phase 1 (Coarse Analysis):** Processes the video at 2 fps using a low token count per frame (~66 tokens). This phase identifies general timeline events and marks video segments requiring further refinement.
- **Phase 2 (Refined Analysis):** Uses the marked output from Phase 1 to process only the highlighted segments. It runs at 10 fps with a high token count per frame (~258 tokens), focusing on fine-grained analysis for critical sections of the video, ensuring both precision and efficiency.

These tools work together to produce a unified timeline, which includes transcribed speech, speaker information, and visual events. This structured JSON output makes it easier to understand, index, or process video content.

# Example:
- **Video**: https://www.pinterest.com/pin/448600812903681285/
- **Context**: `"A talking head video, of a guy talking about motivation and inspiration."`
- **Full Output**: https://pastebin.com/JTARvpxb
- **Output Snippet**:
```javascript 
{
  "version": "vidscriber.v1",
  // Top level summary of the video
  "summary": "A man in a black hoodie speaks directly to the camera about the importance of setting reminders for goals, emphasizing that it's about the 'next logical step' rather than constant motivation. He suggests physical notebooks or digital apps as reminder tools and concludes by stressing the importance of celebrating each step completed.",
  // Array of utterances and their associated video nodes
  "speech_timeline": [
    {
      "id": "utt_0",
      "time": "[0.300->2.400]", // Start and end time of the utterance
      "speaker": "1", // ID of the speaker
      "language": "en", 
      "text": "Next, this is huge, and this is set reminders.",
      // Video nodes that contain this utterance
      "video_nodes": [
        "state_0 (Speaker discusses goal reminders and celebrating progress) [0.300->2.400]",
        "state_0.span_0 (Introduction to setting reminders) [0.300->2.400]"
      ],
      // Array of words in the utterance with accurate timestamps
      "words": [
        "[0.300->0.480] Next,",
        "[0.540->0.600] this",
        "[0.660->0.720] is",
        "[0.840->1.140] huge,",
        "[1.140->1.200] and",
        "[1.320->1.380] this",
        "[1.440->1.500] is",
        "[1.620->1.680] set",
        "[1.920->2.400] reminders."
      ]
    },
    ... Rest of the the utterances
  ],
  // Array of video nodes
  "video_timeline": [
    {
      "id": "state_0",
      "kind": "state", // Type of node
      "time": "[0.000->46.900]", // Start and end time of the node
      "label": "Speaker discusses goal reminders and celebrating progress", // General title
      // Tags that describe the node
      "tags": [
        "presentation",
        "speaker:onscreen",
        "gaze:camera",
        "object:microphone",
        "background:shelves"
      ],
      // Child nodes that are inside this node
      "children": [
        {
          "id": "state_0.span_0",
          "kind": "span",
          "time": "[0.000->4.900]",
          "label": "Introduction to setting reminders",
          "tags": [
            "topic:reminders",
            "emotion:serious",
            "emotion:smiling",
            "gesture:touching_face"
          ]
        },
        ... Rest of the child nodes
      ]
    }
    ... Rest of the top level nodes (In this case there is only one)
  ]
}
```


# How To Run:
* Set up .env following [.env.example](https://github.com/SplitBN/Vidscriber/blob/master/.env.example).
* You can run the tool in your IDE using the [index.js](https://github.com/SplitBN/Vidscriber/blob/master/src/index.js) file:
  * Assign a video link or a file path to the `uri` field.
  * Describe the video's context in the `context` field (Optional, to make transcription more accurate).
  * Insure the `RECOMPUTE_FROM` field is set to `"download"` for new files.
  * Run the file.
  * You can see the output of each step in the ./cache folder.


# Steps
1) Normalze video and audio quality
2) Use ASR model to transcribe and diarize speech (and maybe other sound events).
3) User a Video Understanding model to transcribe events and visuals.
4) Combine outputs into a single timeline.
5) ~~Translate JSON timeline into Toon format.~~ (Not doing since the transcription structure is too complex for Toon to be beneficial)
6) Define functions for google cloud functions integration.

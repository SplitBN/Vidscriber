// export const PHASE_1_INSTRUCTIONS = `
// Process the video at ~1 frame per second using both visual and audio inputs.
//
// Create a timeline of hierarchical JSON nodes using the provided schema. Group content into ~1000ms segments. For each segment:
//
// - Set kind: "state" for continuous scenes, "span" for short actions, or "moment" for instantaneous events.
// - Use label as a semantic title (e.g. "User enters room").
// - Use description to summarize observed audio-visual context (e.g. "A person enters the room and begins speaking about safety").
// - Set start_ms and end_ms accordingly.
// - Use conf ∈ [0,1] to reflect certainty; lower values if unsure or ambiguous.
// - Add relevant tags, bbox, and entityIds if applicable.
// - Use children[] to capture sub-events inside a parent event for accuracy.
//
// Critically, for segments where audio is muffled, action is rapid, context is complex, accurate timestamps needed or semantic interpretation is ambiguous or important:
// - Mark them for accurate processing by configuring "accurate_processing" (of type accurate_processing) to have them rehearsed by a high-semantic token and high fps ingestion.
// - Keep such nodes brief and general.
// - These will be refined later in high detail.
// - Lower their confidence scores appropriately.
//
// Ensure:
// - No hallucinated or inferred content.
// - Use only observed visual and audio data.
// - Timeline has no gaps or overlaps.
// - Provide a top-level summary explaining the full video as if to someone who hasn't seen it.
// - Strictly follow OUTPUT_SCHEMA.
//
// `

export const PHASE_1_INSTRUCTIONS = `
You are creating a hierarchical timeline from the video using the OUTPUT_SCHEMA.

Goal:
- Top-level timeline = coarse segments (1–4s), each representing a meaningful unit.
- Each top-level segment should use children[] to break down smaller micro-events (pauses, gestures, speaker shifts, subtle reactions, overlaps).

Node usage:
- state = sustained speaking / listening / action
- span = short-lived transitions or sub-actions
- moment = instantaneous cues

Hierarchy:
- Parent node = broad meaning
- Children = finer internal detail within the same time span

Tagging:
- Always include descriptive, *semantic* tags that reflect:
  - speaker roles (e.g. speaker:onscreen, speaker:offscreen)
  - body cues (e.g. gesture:right-hand, gesture:both-hands, gaze:down, gaze:return)
  - tone or emphasis (e.g. emphasis, clarification, hesitation, affirmation)
  - conversational flow (e.g. prompt, interruption, continuation, pause:short)
  - error / unusable content cues (e.g. blunder, mistake, retake, restart, stutter, filler:um)
- Tags should reflect what is *actually happening*, not just interpretation or emotion.

accurate_processing:
- Only include if refinement when accuracy is needed, e.g. fast paced movement, complex events, or events that are likely to need super accurate level editing.
- If included, it must be:
  "accurate_processing": { "needed": true, "reason": "[short reason]" }
- If not needed, omit the field entirely. Never use true/false/null.

General Rules:
- No hallucination; describe only what is directly visible or audible.
- Timestamps must be sequential, without gaps or overlap.
- The summary should explain the whole video clearly to someone who hasn't seen it.
- Output must follow OUTPUT_SCHEMA exactly.


`

export const PHASE_2_INSTRUCTIONS = `
You are processing video segments flagged with \`"accurate_processing": {needed: true}\` in a prior coarse pass.

Input:
- The full JSON timeline from the first LLM.
- Only the video/audio segments corresponding to the flagged nodes.

For each flagged node:
- Analyze the segment at ~10 fps using full visual and audio context.
- Replace the original node with a new, semantically detailed version.
- Preserve the original id and temporal boundaries (or subdivide using children[] as needed).
- Update label and description with rich, grounded observations.
- Describe actions, speech topics, expressions, movements, objects, or background context with clarity.
- Avoid generalities: be specific based on high-resolution input.
- Raise confidence score to reflect higher certainty.
- Remove \`"accurateProcessingNeeded"\` from updated nodes.
- If necessary, create children[] for overlapping or simultaneous sub-events (e.g. "speaker gestures" and "speaker explains slide").

Do not modify unflagged nodes. Copy them verbatim from the original timeline.

Final output:
- One complete JSON with the same structure as input.
- All previously flagged nodes are now replaced with high-accuracy versions.
- The summary may be updated if new context materially changes understanding.
- Schema validity is required.
- Do not invent or assume. Base all output strictly on observed content.

`
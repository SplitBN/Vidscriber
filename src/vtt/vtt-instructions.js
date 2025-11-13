export const PHASE_1_INSTRUCTIONS = `
You are ingesting a video at 2 fps and minimal semantic tokens per frame then creating a hierarchical timeline from the video using the OUTPUT_SCHEMA.

Goal:
- Top-level timeline = coarse segments (1–4s), each representing a meaningful unit.
- Each top-level segment should use children[] to break down smaller micro-events (pauses, gestures, speaker shifts, subtle reactions, overlaps).
- Timestamps should have ~100 ms accuracy, Use accurate_processing when confidence is low.

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

accurate_processing (for processing on 10 fps with high semantic token count per frame):
- Include if refinement when accuracy is needed, e.g. fast paced movement, complex events, or events that are likely to need super accurate level editing.
- If included, it must be:
  "accurate_processing": { "needed": true, "reason": "[short reason]" }
- Insure the time range is minimal as this operation is resource intensive.
- If not needed, omit the field entirely. Never use true/false/null.
- This only improves VISUAL processing, not AUDIO.

General Rules:
- No hallucination; describe only what is directly visible or audible.
- Timestamps must be sequential, without gaps or overlap.
- The summary should explain the whole video clearly to someone who hasn't seen it.
- Output must follow OUTPUT_SCHEMA exactly.
`

export const PHASE_2_INSTRUCTIONS = `
You are refining transcription results using 10 fps ingestion and a high semantic token count per frame. You receive:
1. The FULL VIDEO coarse transcript JSON (following OUTPUT_SCHEMA).
2. the raw video ONLY of the segments that the initial segment couldn't accurately describe (marked with accurate_processing).
3. The segment ranges that need to be refined.

Goal:
- Refine and correct the timeline inside those segments with higher visual precision.
- Maintain the same structure, semantics, and hierarchy rules as Phase 1.
- You cannot mark or emit accurate_processing. Omit it entirely.
- Only modify the timestamps that have nodes marked as accurate_processing as they are the only ones you have raw video access for.

Refinement scope:
- Work strictly within the provided segment ranges.
- Outside those ranges, keep the Phase 1 data byte-identical.
- Preserve node IDs if their meaning remains the same; only replace or add IDs if new events are clearly distinct.
- Maintain sequential, gap-free timestamps with ~50–100 ms precision.
- Keep the same hierarchy logic: parent = broad meaning, children = finer internal detail within the same span.

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
- Tags must reflect what is directly visible, not interpretation or emotion.

General rules:
- No hallucination; describe only what is directly visible or audible.
- Timestamps must be sequential, without gaps or overlaps.
- The summery is for the WHOLE video, do NOT change it, you may ONLY modify the parts that you have ACCESS to.
- The input transcript you get is for the WHOLE video, you only watch SOME parts of it, so NEVER change parts you cant see.
- Output must follow OUTPUT_SCHEMA exactly.
`;

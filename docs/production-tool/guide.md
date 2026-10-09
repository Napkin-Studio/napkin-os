# Napkin Production Tool: user guide

Make a short ad from a sketch: create your characters, storyboard a script, and turn the frames into
video clips. This guide is for participants and organisers. Anything not built yet is marked
**Planned**.

## Quick start

1. **Sign in** with the event code from the organisers and your name.
2. **Canvas:** draw or drop a picture of your character, press **Generate**, then **Name** the result
   (for example `maya_front`) and press **Make the other views**.
3. **Storyboard:** write a few lines of script using your names (*"@maya opens her umbrella and
   grins."*), press **Plan shots**, then **Draw frame 1** and **Draw the rest**.
4. **Video:** press **Make clips**, leave notes on any clip to improve it, then **Render ad** and
   **Download**.

## Contents

- [What it does](#what-it-does)
- [Signing in](#signing-in)
- [Stage 1: Canvas](#stage-1-canvas)
- [Naming references](#naming-references)
- [Stage 2: Storyboard](#stage-2-storyboard)
- [Stage 3: Video](#stage-3-video)
- [Choosing a model when you regenerate](#choosing-a-model-when-you-regenerate)
- [Your keys (your own fal or HeyGen account)](#your-keys-your-own-fal-or-heygen-account)
- [Costs and limits](#costs-and-limits)
- [What the job states and errors mean](#what-the-job-states-and-errors-mean)

## What it does

You make an ad in three stages:

1. **Canvas**: draw, write or drop pictures, and generate characters and objects from them.
2. **Storyboard**: write a short script. The tool plans the shots and draws a frame for each one.
3. **Video**: turn each frame into a clip, leave notes to improve them, then render the ad.

Behind the scenes, the tool sends each step to an image or video service: fal, Runway or HeyGen. The organisers choose which service does which step.

## Signing in

Enter the **event code** from the organisers and **your name**, then press **Start**. Organiser codes get higher daily limits (see [Costs and limits](#costs-and-limits)).

## Stage 1: Canvas

The canvas shows three hints: **Make**, **Generate**, **Name**.

1. **Make.** Draw, write notes or drop pictures anywhere on the canvas.
2. **Generate.** Select any mix of drawings, pictures, earlier results and notes, then press **Generate**.
   - Type what you want.
   - Press **Place…** and click where the result should land. It arrives as a new image you can use again.
   - **Generate** is disabled while one of the selected images is still being made.
3. **Name.** Select an image you want to keep and press **Name…**. Give it two parts (see [Naming references](#naming-references)):
   - **who or what it is**, e.g. `maya`;
   - **what this picture shows**, e.g. `front` or `laughing`.

Other canvas actions:

| Button | What it does |
|---|---|
| **Set as front** | Makes this picture the front of a character or object. A character needs a front before you can use its bare name (e.g. `@maya`). |
| **Make the other views** | On a front: makes the three-quarter, side and back views. The References panel's **Make views** fills in only the missing ones. |
| **Remove name** | Un-names the picture. It stays on the canvas. |
| 🗑 | Deletes the selection. You can undo for a few seconds, or with Ctrl+Z. |
| **References** panel | Every named character or object, with its pictures. Tap a name to add it to your words. The role menu says what a key is: character, shape, texture, colour, feel, pose, prop or other. |
| **Publish** | Shares a character or object with your team as a numbered version (`Publish v2`, …). |
| **Team library** | Imports what your team published. Importing makes a copy, so later changes to the original don't change yours. |
| **Clean up** | Removes pictures nothing uses any more. It asks first, and it clears the undo history. |
| **Go to Storyboard →** | Enabled once at least one image has a name. |

## Naming references

A name has the form **`key_variant`**:

| Part | Rule | Examples |
|---|---|---|
| key: who or what | 2–24 lower-case letters or digits, starting with a letter | `maya`, `brolly`, `lamp` |
| variant: what this picture shows | lower case, words joined by hyphens, up to 32 characters | `front`, `laughing`, `three-quarter`, `red` |

What you can write in an instruction, a shot's action or a script:

- **`@maya_laughing`**: that one picture.
- **`@maya`**: the bare key means the **whole character**. It sends the front, then up to three more pictures: the three-quarter, side and back views first, then other named pictures. The key **must have a front**; if it doesn't, you're asked to set one.
- A name that no picture has is an error you can fix (e.g. "Shot 2 uses @maya_jumping, but no image has that name").

Two technical details:
- **Long names:** services accept names of at most 16 characters, so a longer name is shortened automatically for the service. You always see and type your own names.
- **Unnamed inputs:** anything you didn't name is called `in_1`, `in_2`, … in what the tool sends.

**Honest limit: a named pose is a hint, not a guarantee.** On some services, a picture like `@maya_jumping` steers the result rather than fixing it:
- On fal, the extra pictures of a character are sent as identity references, so the pose isn't enforced.
- The director may leave a pose picture out when a service's reference limit is full.
- The shot's action text can override the pose.

**Planned:** named poses and expressions that are always sent and always followed.

## Stage 2: Storyboard

1. **Script.** Write what happens in your ad (up to 600 characters). Use your names, e.g. *"@maya opens @brolly_red and grins."*
2. **Length and format.** Pick the ad length (10, 15 or 20 s) and the shape (9:16, 1:1 or 16:9).
3. **Plan shots.** The tool splits the script into 2–8 shots whose lengths add up to your target. Each shot has:
   - a composition (wide, medium, close…);
   - an action;
   - a camera move;
   - a length in seconds;
   - the references it shows.

   You can edit every field, add shots (**+ Add shot**, up to 8) and delete them. **Plan again** replans the script.
4. **Draw frame 1.** Frame 1 sets the place, the light and the style for every frame after it.
5. **Draw the rest.** Draws each remaining shot in turn, each one following the one before. **Next frame →** draws just the next one.
6. **Improve a frame.** Each frame card has a text box and a few controls:
   - **Regenerate**: type a change, or leave the box empty, and press **Regenerate** for a new version. Use ‹ › to move between versions, and **↶ Revert** to go back to the version a frame came from.
   - **Box / Brush / Click**: mark part of the frame, type what should change there, and press **Change the box**. Brush appears only when the routed service takes masks; Click only when it can select by clicking.
   - **Model menu**: appears beside Regenerate once the frame exists. See [Choosing a model](#choosing-a-model-when-you-regenerate).
7. **Lock storyboard → Video.** Available once every shot has a frame.

A frame marked **Out of date** was drawn before something it depends on changed, such as an earlier frame. Consider redrawing it.

## Stage 3: Video

One clip is made per frame.

| Control | What it does |
|---|---|
| **Make clips** | A clip for every shot that has none. |
| **Make clip** | A clip for this shot. |
| **New take** | Makes this shot again from its frame, with the **Model menu** beside it. |
| **Notes** | Pause the clip anywhere and type a note. It sticks to that moment. **Make a new version (N notes)** sends the open notes as one change. |
| **v1, v2…** | Pick which take is used. 🗑 deletes a take, but you can't delete the last one. |
| **Render ad** | Joins the chosen takes into one ad with the end card. |
| **Download** | Saves the rendered ad. |

These are switched off by the organisers today, so you may not see them:
- **Change the feel**: small, noticeable or big changes (Adhere / Flex / Reimagine).
- **Box on a paused frame**: region edits on video.

## Choosing a model when you regenerate

Every model, its price and what each service accepts are listed in the [provider reference](provider-reference.md).

Your first draw and your first clip always use the event's default model. The defaults are chosen for keeping characters consistent: Nano Banana Pro for characters and frames, Kling v3 Pro for clips (the clip model that takes your named characters). Veo 3.1 has the best motion but ignores character references, so it is offered rather than used by default. When you **regenerate a frame** or make a **New take** (or a new version from notes), a **Model** menu lets you pick another vetted model. The menu starts on the model that made the version you're replacing.

| Step | Default | Other choices | Approx. cost per job |
|---|---|---|---|
| Storyboard frame | Nano Banana Pro (fal) | Kling O3 (fal), Nano Banana 2 (fal) | ~$0.15 / ~$0.028 / ~$0.08 |
| Clip | Kling v3 Pro (fal) | Veo 3.1 Fast (fal), Veo 3.1 (fal), HeyGen Video 1 | ~$0.56 / ~$0.90 / ~$2.40 / price not published |

Notes:
- **Veo ignores character references.** It works from the frame only, as its menu note says. For clips where exact characters matter, stay on Kling v3 Pro.
- **Prices are estimates** from the services' price lists. The Veo prices are an upper bound.
- **Runway is never offered.** It's the event's safety net. If the service you picked can't take the job, the tool makes it with Runway's default model instead. Hover the version or take afterwards: the tooltip names the model, and in that case says something like *"Veo 3.1 (runway), because fal could not take Veo 3.1 Fast"*.
- **The menu isn't on the canvas** (Generate, views, region edits).

## Your keys (your own fal or HeyGen account)

When the organisers switch it on, a **Your keys** button appears in the top bar. Enter a fal key ("For pictures, frames and clip edits") and/or a HeyGen key ("For clips"), then **Save**.

- **What runs on your key:**
  - Steps your keys cover run on your account and are billed to you. Everything else runs on the event's account.
  - Clips go to HeyGen first.
  - A fal key on its own doesn't take clips. With a HeyGen key as well, fal takes a clip HeyGen can't.
- **No fallback to the event's account.** If your key is refused, you'll see *"Your fal key was refused…"*. If your account is busy, the step fails rather than running on the event's money.
- **No daily quota and no event spend** for steps on your own key. The limit on jobs running at once still applies.
- **Where the keys live:**
  - Only in this browser tab . Closing the tab forgets them, and **Forget my keys** clears them.
  - They're never saved in your document or its export.
  - They're sent to the relay only when a job is submitted.
  - The relay stores the key a job needs encrypted (AES-GCM), and never logs it, returns it or stores it readable.

## Costs and limits

These are the usual event settings. The organisers can change them at any time.

| Limit | Value |
|---|---|
| Daily quota per participant | 40 image jobs, 6 video jobs, 3 renders. Organisers get 10×. |
| Jobs running at once, per person | 2. More are queued and sent automatically, shown as **In the queue**. |
| Event spend cap | $1,300. Generating stops with "The event's generation budget is used up." |
| Job time limits | 3 min for images, 10 min for video |

Estimated cost per job with the default models:

| Step | fal | Runway (fallback) | HeyGen |
|---|---|---|---|
| Canvas generate | $0.15 (Nano Banana Pro) | $0.20 (Gemini 3 Pro) | — |
| View (turnaround) | $0.035 (Qwen multi-angle) | $0.20 (Gemini 3 Pro) | — |
| Storyboard frame | $0.15 (Nano Banana Pro) | $0.20 (Gemini 3 Pro) | — |
| Region edit | $0.06 (Ideogram v4.5) | $0.20 (Gemini 3 Pro) | — |
| Clip | $0.56 (Kling v3 Pro, 5 s) | $1.20 (Veo 3.1, 6 s) | not published |
| Clip edit | $0.72 (Luma Ray 3.2) | $1.40 (aleph2) | — |

A typical ad (one character with 3 views, 8 frames, 6 clips and one clip edit) comes to about $5.54 with the default models.

## What the job states and errors mean

A job card moves through **Sending… → In the queue → Making it… → Almost there…** and then shows the result.

| You see | Meaning | What to do |
|---|---|---|
| **In the queue** | Waiting for a free slot: your 2-at-once limit, or the service's. | Nothing; it starts by itself. |
| **Checking with the provider…** | The service may already have the job but didn't confirm it. Napkin never sends it twice, so you're never charged twice. | Wait. If it stays, report it. **Known issue:** it can keep spinning; a fix is on the way. |
| **Retry** | The job failed in a way that trying again may fix (service busy or down, a network blip). | Press **Retry**. |
| An error **without Retry** | Trying again won't help as is, e.g. a name with no picture, or content the service refused. | Change the input, or **Clear** the card. |
| Content refused (moderated) | The service's safety filter refused the prompt or picture. It's never retried automatically, and some services still bill it. | Change the words or pictures. |
| **Report** | Sends the error and the job ID to the organisers. | Use it for anything unexpected. |
| **Clear** | Removes the failed card. | — |
| **Cancel** | Stops a running job. HeyGen has no cancel, so the clip still runs on their side and is billed; the tool just ignores the result. | — |

**Whose fault is it?** Every failure from a service now records who has to act:

| Source | Meaning |
|---|---|
| **provider** | The service had an outage or hit a limit. |
| **network** | The service couldn't be reached. |
| **napkin** | A Napkin bug, or a problem with our own storage. |
| **input** | Your content or request. |

For example, a HeyGen outage now falls back to Runway instead of getting stuck, and a service that may already have the job is never sent it again. The wording you'll see on screen for these cases is **Planned**. Examples are "this isn't a Napkin problem" and "Napkin is making this with Runway instead". Until it ships, the error card shows the service's own message and code.

---

Running the tool yourself or working on its code: see the [developer guide](developer-guide.md).

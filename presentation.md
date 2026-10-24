# Lifeline OS: Demo Flow

About 8–10 minutes.

## Before the demo (5 min)

1. Start the backend. 5× speed lets trips finish during the demo:
   ```bash
   cd ~/Desktop/lifeline && SIM_SPEED=5 ENGINE_V2=true npm run dev:api
   ```
2. Start the frontend:
   ```bash
   cd ~/Desktop/lifeline && npx --yes serve lifeline-os -l 5173
   ```
3. Open http://localhost:5173 in a wide browser window, so the Action History table sits beside the action cards.
4. Start clean: choose **Emergency Coordinator**, pick any scenario, click **Simulate** once (this clears old test data), then go back to the role screen.

## Demo flow

### 1. Role screen (30 sec)
"Lifeline has two users: the emergency coordinator, and residents who need help." Click **Emergency Coordinator**.

### 2. Overview: start the disaster (1.5 min)
- Pick **Earthquake** in the Disaster dropdown (or Wildfire or Flood) and click **Simulate Disaster Event**.
- The screen shakes and a series of status popups play, followed by a "Backend simulation applied: N interventions" popup.
- Point to the **Priority Queue**: these are survival clocks. For example, the Pharmacy A fridge is failing, so the insulin there has about 40 minutes left.
- Talking point: *"Lifeline doesn't wait for someone to call. It predicts which resources will fail and when."*

### 3. Network tab (1 min)
- Every facility has a status, its key resource, its power source and a time to failure.
- Scroll down to the volunteers. They show **Assigned**, because Lifeline has already lined each one up for a proposed trip.
- Talking point: *"This is the live state of the community: resources and people."*

### 4. Actions tab (2 min): the core of the demo
- Each card is a recommendation: what to move, from where to where, which driver, the ETA, and **why**, with the date and time at the top right.
- Talking point: *"The AI proposes and a human approves. Nothing is dispatched without a coordinator."*
- Click **Approve** on the top insulin card. You'll see a celebration, the card leaves the queue, and an **Approved** row appears in the **Action History** table on the right.
- Click **Decline** on a low-priority card. It leaves the queue and is logged as **Declined**.
- Optional: click **Find Alternative** on a card. Lifeline proposes the next-best option, or says none is available.

### 5. Network tab again (30 sec)
The volunteer you approved now shows **Busy · En route**, with the trip and an arrival countdown. *"Volunteer status updates in real time and is stored in the database."*

### 6. Resident view (1.5 min)
- Click **Resident view** at the top.
- Type: *"My grandmother needs insulin and our power is out."* Then submit.
- The resident immediately sees what Lifeline understood: need, priority, number of people, power. They also see whether a volunteer was matched or the request is queued.
- Talking point: *"Residents just write in plain language. No forms."*

### 7. Back to the coordinator (1.5 min)
- Click **Coordinator view**, then **Actions**.
- The resident's request appears either as a new card labeled **"Requested &lt;time&gt;"**, or under **Waiting Requests** with the reason, such as "all volunteers are busy". Both are good talking points: *"Nothing gets lost. If we can't serve it yet, the coordinator sees exactly why."*
- Open the **Requests** tab. **Incoming Requests · Priority Ranked** lists every resident request, most urgent first, with a timestamp and status.

### 8. Closing (1 min)
- Optional: if at least a few minutes have passed at 5× speed, show that the approved trip now has a **Completed** row in Action History and the volunteer is free again.
- Optional: stop the backend with Ctrl+C, start it again, and refresh the page. Everything is still there: *"State is saved to a database, so nothing is lost on a restart."*
- Finish on the **Impact** tab.

## What's real and what's display-only

**Real** (calculated by the engine and saved in the database):
- simulated disasters (5 types)
- survival clocks
- proposals and their reasons
- Approve, Decline and Find Alternative
- volunteer status
- Action History
- resident requests and how they're understood
- waiting requests
- timestamps

**Display-only** (don't present these as working features):
- **Impact tab:** the numbers are fixed demo numbers, not calculated from what you did.
- **Disconnect Cloud / Edge Mode:** only changes the look; it doesn't actually switch modes. "Synchronizing 7 events" is scripted text.
- **The "Amazon Bedrock Analysis" label:** locally, requests are understood by the built-in keyword rules (`source: rules`). Real Bedrock (Nova) only runs when the backend has `USE_BEDROCK=true` and AWS credentials. Test this before the demo if you want to say "Bedrock".
- **Status popups during Simulate:** the narration is scripted. The cards and clocks that follow are real.
- **Mission clock in the top bar and the scrolling ticker:** decorative only.

## Backup tips

- If a card or request doesn't show up, look for the small dot next to "Cloud Online" at the top. If it says the backend is offline, the page has fallen back to its built-in demo cards. Restart the backend and refresh.
- With only 5 volunteers, the third or fourth resident request may end up under **Waiting Requests**. That's normal; declining a low-priority card frees a volunteer.
- To reset at any time, just click **Simulate** again.
- Use requests the parser understands. It looks for one of five needs: insulin/medicine, water, food, blankets. Some good ones:
  - "There are 3 kids here and we are hungry."
  - "Power is out and my elderly dad is freezing, he needs blankets."
  - "Family of 4, we have no clean water."

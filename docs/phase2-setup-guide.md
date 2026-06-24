# Phase 2 Setup Guide — Meta WhatsApp Templates + Exotel DID

Complete both sections in parallel. Meta template approval takes 24h+, so submit it first.

---

## Part A — Meta WhatsApp Template Submission

### Where to submit
1. Go to [business.facebook.com](https://business.facebook.com)
2. Navigate to: **WhatsApp Manager → Account Tools → Message Templates → Create Template**

---

### Template 1: `missed_call_recovery`
*Sent immediately after a missed call (within ~90 seconds)*

| Field | Value |
|---|---|
| Template Name | `missed_call_recovery` |
| Category | **Utility** (not Marketing) |
| Language | English |

**Header (optional — skip for now)**
*(Leave blank for faster approval)*

**Body:**
```
Hi! We noticed you called us and we couldn't pick up. We're sorry we missed you! 🙏

Reply to this message and we'll help you right away — or call us back at {{1}}.

We're available Monday to Saturday, 9 AM – 7 PM.
```

**Variable mapping:**
- `{{1}}` = clinic's DID / callback number (e.g. 044-XXXX-XXXX)

**Footer (optional):**
```
Medixum CGE — Clinic Care
```

**Buttons (optional but recommended):**
- Type: **Quick Reply**
- Button 1 text: `Book Appointment`
- Button 2 text: `Talk to Us`

---

### Template 2: `missed_call_followup`
*Sent 24 hours later if the patient hasn't replied*

| Field | Value |
|---|---|
| Template Name | `missed_call_followup` |
| Category | **Utility** |
| Language | English |

**Body:**
```
Hi! We tried reaching you yesterday after you called our clinic. We'd still love to help you. 😊

Reply here or call us at {{1}}.

We're available Monday to Saturday, 9 AM – 7 PM.
```

**Variable mapping:**
- `{{1}}` = clinic's DID / callback number

---

### Tamil versions (submit separately for Tamil Nadu clinics)

**`missed_call_recovery` — Tamil body:**
```
வணக்கம்! நீங்கள் எங்களை அழைத்தீர்கள், ஆனால் நாங்கள் எடுக்க முடியவில்லை. மன்னிக்கவும்! 🙏

இந்த செய்திக்கு பதில் அனுப்புங்கள் அல்லது {{1}} என்ற எண்ணில் திரும்ப அழைக்கவும்.

திங்கள் முதல் சனி வரை, காலை 9 மணி முதல் மாலை 7 மணி வரை கிடைக்கிறோம்.
```

**`missed_call_followup` — Tamil body:**
```
வணக்கம்! நேற்று நீங்கள் எங்களை அழைத்தீர்கள், நாங்கள் உதவ விரும்புகிறோம். 😊

இங்கே பதில் அனுப்புங்கள் அல்லது {{1}} என்ற எண்ணில் அழைக்கவும்.

திங்கள் முதல் சனி வரை, காலை 9 மணி — மாலை 7 மணி.
```

---

### Meta approval tips
- **Category = Utility** gets approved faster than Marketing
- Avoid words like "offer", "discount", "free" — they trigger Marketing classification
- If rejected, Meta gives a reason — usually just rephrase and resubmit
- Approval typically takes 2–24 hours

### After approval — what you need
Note down these values for `.env.local`:
- `META_PHONE_NUMBER_ID` — from WhatsApp Manager → Phone Numbers
- `META_WHATSAPP_TOKEN` — from your Meta App → WhatsApp → API Setup → Temporary or Permanent token
- `META_APP_SECRET` — from Meta App → Settings → Basic → App Secret
- `META_WEBHOOK_VERIFY_TOKEN` — you choose this (any random string, e.g. `cge_verify_2026`)

---

## Part B — Exotel DID + Passthru Applet

### Step 1: Get a DID (Virtual Number)
1. Log in to [my.exotel.com](https://my.exotel.com)
2. Go to: **Phone Numbers → Buy Number**
3. Select: **India → Tamil Nadu** (for local presence)
4. Buy one DID — note the number (e.g. `04422XXXXXX`)

### Step 2: Create the Passthru Applet
1. Go to: **App Bazaar → Create New App**
2. Select applet type: **Passthru**
3. Configure:
   - **Name:** `CGE Missed Call Recovery`
   - **URL:** `https://medixumcge.vercel.app/api/webhooks/exotel`
   - **Method:** POST
   - **Encoding:** application/x-www-form-urlencoded
4. Under **Call settings:**
   - Ring time: 30 seconds (before marking as missed)
   - If unanswered: trigger the Passthru URL

### Step 3: Assign the applet to your DID
1. Go to: **Phone Numbers → [your DID] → Edit**
2. Under "When a call comes in" → select the Passthru app you just created
3. Save

### Step 4: Get API credentials
From **Settings → API Credentials**, note:
- Account SID
- Auth Token ← this goes into `EXOTEL_WEBHOOK_SECRET`

### Step 5: Configure the webhook URL in .env.local
```
EXOTEL_WEBHOOK_SECRET=<your auth token>
EXOTEL_WEBHOOK_URL=https://medixumcge.vercel.app/api/webhooks/exotel
```

---

## Part C — Register the WhatsApp Inbound Webhook

Do this after the Meta app is set up.

1. Go to: **Meta Developer Console → Your App → WhatsApp → Configuration**
2. Under **Webhook**:
   - Callback URL: `https://medixumcge.vercel.app/api/webhooks/whatsapp`
   - Verify Token: same value as your `META_WEBHOOK_VERIFY_TOKEN` in `.env.local`
3. Click **Verify and Save** — Meta will send a GET request to your URL with a challenge
4. Subscribe to the **messages** field

> ⚠️ The webhook verification (GET) only works once your app is deployed to Vercel with the env vars set.

---

## Phase 2 Checklist

- [ ] `missed_call_recovery` template submitted to Meta
- [ ] `missed_call_followup` template submitted to Meta
- [ ] Tamil versions submitted (optional but recommended for TN clinics)
- [ ] Exotel DID purchased (Tamil Nadu number)
- [ ] Passthru applet created and pointed at webhook URL
- [ ] Exotel auth token noted for `.env.local`
- [ ] Meta credentials noted (`PHONE_NUMBER_ID`, `TOKEN`, `APP_SECRET`)
- [ ] WhatsApp inbound webhook registered (after Vercel deploy)

**Phase 2 is done when:** both templates are submitted AND the Exotel DID is provisioned. You don't need approval yet to continue to Phase 3/4 testing.

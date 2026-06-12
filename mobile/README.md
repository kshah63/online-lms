# MathVision Global — mobile app

A native (Expo / React Native) companion app for everything **except** the live
lesson. Lessons — video, the shared notebook — stay on iPad/laptop in the web
app; tapping **Join** here opens the lesson in the browser. Everything else is
native: dashboards, lessons, homework (view, mark, grade), reports, follow-ups,
booking, and push notifications.

It talks to the **same Supabase project** as the web app. Row Level Security
enforces who sees what, so the anon key is safe to ship. The service-role key is
never in the app.

## Setup

```bash
cd mobile
npm install          # or: pnpm install
cp .env.example .env # then fill in the values
npx expo start       # press i (iOS), a (Android), or scan the QR in Expo Go
```

`.env` values:

| Variable | What |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Same as the web app (Supabase → Settings → API) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same as the web app's anon/public key |
| `EXPO_PUBLIC_WEB_URL` | Your deployed web app, e.g. `https://online-lms-blush.vercel.app` — used to open lessons and to call the booking API |

If a dependency version warns on start, run `npx expo install --fix` to align
everything to the Expo SDK.

## What works directly vs. via the web API

Most reads/writes go straight to Supabase under RLS (sign-in, dashboards,
lessons, reports, homework viewing, **teacher grading**, **student marking**,
**enrollment requests**, push-token registration).

**Booking / reschedule / cancel** need the service role (RLS keeps session
writes admin/teacher-only), so they call the web app's bearer-authenticated
endpoint `POST /api/mobile/sessions` with the signed-in user's Supabase access
token. That's why `EXPO_PUBLIC_WEB_URL` is required for booking.

## Biometric unlock

More tab → **Biometric unlock** (shown only on devices with Face ID /
fingerprint enrolled). When on, the app locks on every cold start until the
device authenticates; the Supabase session itself stays signed in. The
preference is stored in the device's secure enclave (expo-secure-store).

## Push notifications

The app registers each device's Expo push token in the `push_tokens` table; the
web server's notify dispatcher pushes to it alongside WhatsApp (booking
confirmations, report-ready, lesson reminders).

To mint tokens you need an EAS project:

```bash
npx eas init      # sets extra.eas.projectId in app.json
```

Push only works on a physical device (not the simulator). Without an EAS
project id the app still runs — it just skips token registration.

## Run the database migration

The push feature needs `supabase/migrations/0013_push_tokens.sql` applied to the
Supabase project (run it in the SQL editor alongside the others).

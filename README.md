# Swap Row

A buy-and-sell marketplace for students in Greek life. Only verified students can join, and each student only sees listings from their own university.

- **University of Alabama** students sign in with **myBama**: Swap Row sends them to Microsoft, which hands `@crimson.ua.edu` accounts to UA's own login page. Swap Row never sees their password.
- **Other universities** sign in with a 6-digit code sent to their school email.
- **The database enforces the student-only rule**, so the website can't be bypassed. Sign-ups from any email outside the approved school domains are rejected before the account is created. Staff `@ua.edu` addresses are rejected too, because only `@crimson.ua.edu` counts for UA.

## What's in here

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The website. Plain HTML/CSS/JavaScript, no build step. |
| `config.js` | Your Supabase project URL and public key. |
| `supabase/schema.sql` | Database tables, the student-only rules, and the list of universities. |

## Setup (about 30 minutes)

### 1. Create the database

1. Make a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key into `config.js`.

### 2. Turn on email codes (all schools, and the backup for UA)

1. **Authentication → Sign In / Providers → Email**: keep it enabled.
2. **Authentication → Email Templates → Magic Link**: add the code to the email body, for example:
   `<p>Your Swap Row code is <strong>{{ .Token }}</strong></p>`
   Do the same for the **Confirm signup** template.
3. Supabase's built-in email sender only sends a few emails an hour. Before launch, connect a real sender under **Authentication → Emails → SMTP Settings** (Resend and Postmark both have free tiers).

### 3. Turn on myBama sign-in for UA

UA student accounts live in UA's Microsoft directory, which hands sign-in to UA's own login page. Swap Row uses Supabase's Microsoft (Azure) sign-in, locked to UA's directory, so only real UA accounts can get through.

1. Find UA's directory ID by opening
   `https://login.microsoftonline.com/crimson.ua.edu/v2.0/.well-known/openid-configuration`
   in a browser. The `issuer` value looks like `https://login.microsoftonline.com/<directory-id>/v2.0`. Copy the `<directory-id>` part.
2. In the [Azure portal](https://portal.azure.com), sign in with any personal Microsoft account. Go to **Microsoft Entra ID → App registrations → New registration**:
   - **Name:** Swap Row
   - **Supported account types:** *Accounts in any organizational directory (Multitenant)*
   - **Redirect URI:** Web, `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
3. In the new app:
   - **Certificates & secrets → New client secret**. Copy the **Value**.
   - **Token configuration → Add optional claim → ID → `email`** and **`xms_edov`**.
4. In Supabase, go to **Authentication → Sign In / Providers → Azure** and turn it on:
   - **Application (client) ID:** from the app's Overview page
   - **Secret value:** from step 3
   - **Azure Tenant URL:** `https://login.microsoftonline.com/<directory-id>` (the UA directory ID from step 1)
5. Test it with your own `@crimson.ua.edu` account.

**If you see "Need admin approval":** UA's IT office has to approve third-party apps before students can sign in to them. Contact UA OIT and ask them to grant admin consent for the "Swap Row" app, giving them its Application ID. Until then, UA students can still join with the **"Use an email code instead"** link, which sends a code to their `@crimson.ua.edu` inbox. Either way, only students get in.

### 4. Put it online

The site is static files, so any static host works:

- **Netlify:** drag the folder onto [app.netlify.com/drop](https://app.netlify.com/drop).
- **Vercel:** `npx vercel` in this folder.
- **GitHub Pages:** push this folder to a repo and turn on Pages.

Then, in Supabase, go to **Authentication → URL Configuration**. Set **Site URL** to your live address and add it under **Redirect URLs**.

To try it on your computer first, run `npx serve .` in this folder and add `http://localhost:3000` to the Redirect URLs.

## Managing it

**Add a university.** Run this in the SQL Editor:

```sql
insert into public.universities (id, name, short_name, email_domains)
values ('tamu', 'Texas A&M University', 'Texas A&M', '{tamu.edu}');
```

Double-check each school's *student* email domain before adding it. Some schools use a separate one for students, like `crimson.ua.edu` or `go.olemiss.edu`. The domains in `schema.sql` for schools other than UA are best guesses, so confirm them before you open sign-ups at those schools.

**Change the featured school.** Set `priority = 0` on the school that should appear as the big button, and a higher number on the rest.

**Remove a listing or a user.** Use **Table Editor → listings** or **Authentication → Users** in Supabase.

## Upgrading to UA's Okta directly

A deeper integration registers Swap Row as an app in UA's own Okta. This would let the UA login screen show "Swap Row" by name and let UA turn access off centrally. It needs UA OIT to set up the app on their side and Supabase's SAML single sign-on, which is on the Pro plan. The Microsoft route above gets students the same myBama login screen without either of those.
